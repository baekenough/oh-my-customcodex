import type { PageServerLoad } from './$types';
import { getRule } from '$lib/server/data';
import { renderMarkdown } from '$lib/server/markdown';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { root } = await parent();
	const rule = await getRule(root, params.name);

	if (!rule) {
		error(404, `Rule "${params.name}" not found`);
	}

	const renderedBody = renderMarkdown(rule.body);
	return { rule, renderedBody };
};
