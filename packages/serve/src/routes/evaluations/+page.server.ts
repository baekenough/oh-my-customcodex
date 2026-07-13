import type { PageServerLoad } from './$types';
import { getEvaluationDashboardData } from '$lib/server/eval-reader';

export const load: PageServerLoad = async () => {
	const { evaluations, sessions, diagnostics } = await getEvaluationDashboardData();
	return { evaluations, sessions, evalDiagnostics: diagnostics };
};
