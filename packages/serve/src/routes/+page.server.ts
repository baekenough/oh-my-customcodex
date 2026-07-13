import type { PageServerLoad } from './$types';
import { countServeAgents } from '$lib/server/agent-files';
import { getAnalytics, type AnalyticsData } from '$lib/server/analytics';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { detectServeProjectLayout } from '$lib/server/runtime-layout';

interface ProjectDetail {
	agentCount: number;
	skillCount: number;
	guideCount: number;
	ruleCount: number;
}

async function countSkillDirectories(dir: string): Promise<number> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		let count = 0;

		for (const entry of entries) {
			const child = join(dir, entry.name);
			if (entry.isDirectory()) {
				const childEntries = await readdir(child, { withFileTypes: true });
				if (childEntries.some((nested) => nested.isFile() && nested.name === 'SKILL.md')) {
					count++;
				} else {
					count += await countSkillDirectories(child);
				}
			}
		}

		return count;
	} catch {
		return 0;
	}
}

async function getProjectDetail(root: string): Promise<ProjectDetail> {
	const layout = await detectServeProjectLayout(root);

	const count = async (dir: string, pattern?: string) => {
		try {
			const entries = await readdir(dir);
			return pattern ? entries.filter((e) => e.endsWith(pattern)).length : entries.length;
		} catch {
			return 0;
		}
	};

	const skillCount = await countSkillDirectories(join(root, layout.skillsDir));

	return {
		agentCount: await countServeAgents(root),
		skillCount,
		guideCount: await count(join(root, 'guides')),
		ruleCount: await count(join(root, layout.rulesDir), '.md')
	};
}

export const load: PageServerLoad = async ({ parent }) => {
	const { root, selectedProject } = await parent();

	// Analytics loaded separately so a failure doesn't break the entire page
	let analytics: AnalyticsData | null = null;
	try {
		analytics = await getAnalytics(root);
		// Treat zero-invocation data as "no analytics yet" so the UI can show
		// an appropriate empty state rather than zeros everywhere.
		if (analytics.totalInvocations === 0 && analytics.sessions.thisMonth === 0) {
			analytics = null;
		}
	} catch {
		analytics = null;
	}

	const projectDetail = await getProjectDetail(root);

	return {
		root,
		selectedProject,
		analytics,
		projectDetail
	};
};
