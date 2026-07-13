import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { AgentFileConflictError, saveAgentMarkdown } from '$lib/server/agent-files';
import { getProjectRoot, getSkills } from '$lib/server/data';
import {
	parseNaturalLanguage,
	buildAgentMarkdown,
	getAgentModelOptions,
	NATIVE_REASONING_EFFORTS,
	sanitizeName
} from '$lib/server/agent-generator';
import { parseFrontmatter } from '$lib/server/frontmatter';
import {
	generateArtifact,
	getGenerationProviderStatus
} from '$lib/server/generation-provider';
import { detectServeProjectLayout } from '$lib/server/runtime-layout';

export const load: PageServerLoad = async ({ parent }) => {
	const { root } = await parent();
	const layout = await detectServeProjectLayout(root);
	const skills = await getSkills(root);
	const generationProviders = await getGenerationProviderStatus();
	return {
		skillNames: skills.map((s) => s.name),
		generationProviders,
		modelOptions: getAgentModelOptions(),
		reasoningEfforts: NATIVE_REASONING_EFFORTS,
		agentSaveDir: layout.agentsDir
	};
};

export const actions: Actions = {
	// Parse natural language and return structured data (no file write)
	analyze: async ({ request }) => {
		const data = await request.formData();
		const input = String(data.get('input') ?? '').trim();

		if (!input) {
			return fail(400, { error: 'Input is required' });
		}

		const root = await getProjectRoot();
		const generated = parseNaturalLanguage(input);
		const markdown = buildAgentMarkdown(generated);
		const generation = await generateArtifact('agent', input, root, {
			keywordFallback: () => markdown,
			validateContent: validateGeneratedAgent
		});
		const { frontmatter, body } = parseFrontmatter(generation.content);
		const cliGenerated = generation.provider !== null;

		return {
			success: true,
			mode: generation.mode,
			diagnostics: generation.diagnostics,
			name: cliGenerated ? String(frontmatter.name ?? '') : generated.name,
			description: cliGenerated
				? String(frontmatter.description ?? '')
				: generated.description,
			model: cliGenerated ? String(frontmatter.model ?? '') : generated.model,
			modelReasoningEffort: cliGenerated
				? String(frontmatter.model_reasoning_effort ?? 'medium')
				: generated.modelReasoningEffort,
			domain: cliGenerated ? String(frontmatter.domain ?? 'universal') : generated.domain,
			tools: cliGenerated ? arrayField(frontmatter.tools) : generated.tools,
			skills: cliGenerated ? arrayField(frontmatter.skills) : generated.skills,
			body: cliGenerated ? body : generated.body,
			raw: generation.content
		};
	},

	// Save agent file
	save: async ({ request }) => {
		const data = await request.formData();
		const rawName = String(data.get('name') ?? '').trim();
		const content = String(data.get('content') ?? '').trim();

		// Sanitize name — kebab-case only
		const name = sanitizeName(rawName);

		if (!name) {
			return fail(400, { error: 'Agent name is required' });
		}
		if (!content) {
			return fail(400, { error: 'Agent content is required' });
		}

		// Validate name format (single-char names must also pass regex)
		if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name) && name.length >= 1) {
			return fail(400, { error: `Invalid agent name: "${name}". Use kebab-case (e.g., my-agent-expert)` });
		}

		const root = await getProjectRoot();
		try {
			await saveAgentMarkdown(root, name, content);
		} catch (error) {
			if (error instanceof AgentFileConflictError) {
				return fail(409, { error: error.message });
			}
			return fail(400, {
				error: error instanceof Error ? error.message : String(error)
			});
		}

		throw redirect(303, `/agents/${name}`);
	}
};

function arrayField(val: unknown): string[] {
	if (Array.isArray(val)) return val.map(String);
	if (typeof val === 'string') return [val];
	return [];
}

function validateGeneratedAgent(content: string): void {
	const { frontmatter } = parseFrontmatter(content);
	if (!String(frontmatter.name ?? '').trim() || !String(frontmatter.description ?? '').trim()) {
		throw new Error('generated agent is missing required frontmatter');
	}
}
