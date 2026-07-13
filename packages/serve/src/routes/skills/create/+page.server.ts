import { fail, redirect } from '@sveltejs/kit';
import { writeFile, mkdir, access } from 'fs/promises';
import { join, resolve } from 'path';
import type { Actions, PageServerLoad } from './$types';
import { getProjectRoot, getSkills } from '$lib/server/data';
import { parseSkillNaturalLanguage, buildSkillMarkdown, sanitizeSkillName } from '$lib/server/skill-generator';
import { parseFrontmatter } from '$lib/server/frontmatter';
import {
	generateArtifact,
	getGenerationProviderStatus
} from '$lib/server/generation-provider';
import { detectServeProjectLayout } from '$lib/server/runtime-layout';

export const load: PageServerLoad = async ({ parent }) => {
	const { root } = await parent();
	const layout = await detectServeProjectLayout(root);
	const skillSaveDir =
		layout.surface === 'codex-installed' ? `${layout.skillsDir}/general` : layout.skillsDir;
	const skills = await getSkills(root);
	const generationProviders = await getGenerationProviderStatus();
	return {
		skillNames: skills.map((s) => s.name),
		generationProviders,
		skillSaveDir
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
		const generated = parseSkillNaturalLanguage(input);
		const markdown = buildSkillMarkdown(generated);
		const generation = await generateArtifact('skill', input, root, {
			keywordFallback: () => markdown,
			validateContent: validateGeneratedSkill
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
			scope: cliGenerated ? String(frontmatter.scope ?? 'core') : generated.scope,
			contextFork: cliGenerated ? frontmatter.context === 'fork' : generated.contextFork,
			body: cliGenerated ? body : generated.body,
			raw: generation.content
		};
	},

	// Save skill file
	save: async ({ request }) => {
		const data = await request.formData();
		const rawName = String(data.get('name') ?? '').trim();
		const content = String(data.get('content') ?? '').trim();

		// Sanitize name — kebab-case only
		const name = sanitizeSkillName(rawName);

		if (!name) {
			return fail(400, { error: 'Skill name is required' });
		}
		if (!content) {
			return fail(400, { error: 'Skill content is required' });
		}

		// Validate name format (single-char names must also pass regex)
		if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name) && name.length >= 1) {
			return fail(400, { error: `Invalid skill name: "${name}". Use kebab-case (e.g., react-best-practices)` });
		}

		const root = await getProjectRoot();
		const layout = await detectServeProjectLayout(root);
		const saveDir =
			layout.surface === 'codex-installed'
				? join(layout.skillsDir, 'general')
				: layout.skillsDir;
		const allowedDir = resolve(root, saveDir);
		const skillDir = join(allowedDir, name);
		const skillPath = join(skillDir, 'SKILL.md');

		// Path containment check — prevent directory traversal
		if (!resolve(skillDir).startsWith(allowedDir + '/') && resolve(skillDir) !== allowedDir) {
			return fail(400, { error: 'Invalid path' });
		}

		// Check for existing file
		try {
			await access(skillPath);
			// File exists
			return fail(409, { error: `Skill "${name}" already exists. Choose a different name.` });
		} catch {
			// File does not exist — safe to write
		}

		// Create skill directory
		await mkdir(skillDir, { recursive: true });
		await writeFile(skillPath, content + '\n', 'utf-8');

		throw redirect(303, `/skills/${name}`);
	}
};

function validateGeneratedSkill(content: string): void {
	const { frontmatter } = parseFrontmatter(content);
	if (!String(frontmatter.name ?? '').trim() || !String(frontmatter.description ?? '').trim()) {
		throw new Error('generated skill is missing required frontmatter');
	}
}
