import type { PageServerLoad } from './$types';
import { getRules } from '$lib/server/data';

export const load: PageServerLoad = async ({ parent }) => {
	const { root } = await parent();
	const rules = await getRules(root);
	return { rules };
};
