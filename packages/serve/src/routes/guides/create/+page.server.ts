import { fail, redirect } from '@sveltejs/kit';
import { writeFile, mkdir, access } from 'fs/promises';
import { join, resolve } from 'path';
import type { Actions, PageServerLoad } from './$types';
import { getProjectRoot, getGuides } from '$lib/server/data';
import { parseGuideNaturalLanguage, sanitizeGuideName } from '$lib/server/guide-generator';
import {
	generateArtifact,
	getGenerationProviderStatus
} from '$lib/server/generation-provider';

export const load: PageServerLoad = async ({ parent }) => {
	const { root } = await parent();
	const guides = await getGuides(root);
	const generationProviders = await getGenerationProviderStatus();
	return {
		guideNames: guides.map((g) => g.name),
		generationProviders
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
		const generated = parseGuideNaturalLanguage(input);
		const generation = await generateArtifact('guide', input, root, {
			keywordFallback: () => generated.body,
			validateContent: validateGeneratedGuide
		});

		return {
			success: true,
			mode: generation.mode,
			diagnostics: generation.diagnostics,
			name: generated.name,
			body: generation.content
		};
	},

	// Save guide file
	save: async ({ request }) => {
		const data = await request.formData();
		const rawName = String(data.get('name') ?? '').trim();
		const body = String(data.get('body') ?? '').trim();

		// Sanitize name — kebab-case only
		const name = sanitizeGuideName(rawName);

		if (!name) {
			return fail(400, { error: 'Guide name is required' });
		}
		if (!body) {
			return fail(400, { error: 'Guide content is required' });
		}

		// Validate name format (single-char names must also pass regex)
		if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name) && name.length >= 1) {
			return fail(400, { error: `Invalid guide name: "${name}". Use kebab-case (e.g., react-hooks)` });
		}

		const root = await getProjectRoot();
		const allowedDir = resolve(root, 'guides');
		const guideDir = join(allowedDir, name);
		const guidePath = join(guideDir, 'README.md');

		// Path containment check — prevent directory traversal
		if (!resolve(guideDir).startsWith(allowedDir + '/') && resolve(guideDir) !== allowedDir) {
			return fail(400, { error: 'Invalid path' });
		}

		// Check for existing directory
		try {
			await access(guideDir);
			// Directory exists
			return fail(409, { error: `Guide "${name}" already exists. Choose a different name.` });
		} catch {
			// Directory does not exist — safe to create
		}

		// Create directory and write file
		await mkdir(guideDir, { recursive: true });
		await writeFile(guidePath, body + '\n', 'utf-8');

		throw redirect(303, `/guides/${name}`);
	}
};

function validateGeneratedGuide(content: string): void {
	if (!/^#\s+\S/m.test(content) || content.trimStart().startsWith('---')) {
		throw new Error('generated guide must be frontmatter-free markdown with a title');
	}
}
