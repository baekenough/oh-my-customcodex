import { pathToFileURL } from 'node:url';

const DEFAULT_API_BASE = 'https://api.github.com';
const DEFAULT_UPSTREAM_REPO = 'baekenough/oh-my-customcode';
const USER_AGENT = 'oh-my-customcodex-release-sync';
const MAX_RELEASE_NOTES_LENGTH = 6000;
const MAX_ISSUE_BODY_LENGTH = 12000;

export function extractReferencedIssueNumbers(text = '') {
  if (!text.trim()) {
    return [];
  }

  const candidates = new Set();
  const sanitized = text
    .replace(/\bPR\s+#\d+\b/gi, '')
    .replace(/\bpull request\s+#\d+\b/gi, '');

  for (const match of sanitized.matchAll(/#(\d+)\b/g)) {
    candidates.add(Number(match[1]));
  }

  for (const match of sanitized.matchAll(/\/issues\/(\d+)\b/gi)) {
    candidates.add(Number(match[1]));
  }

  return [...candidates].sort((left, right) => left - right);
}

export function buildUpstreamIssueMarker(upstreamRepo, issueNumber) {
  return `<!-- upstream-release-issue: ${upstreamRepo}#${issueNumber} -->`;
}

export function extractUpstreamIssueMarker(body = '') {
  const match = body.match(/<!--\s*upstream-release-issue:\s*([^\s]+)\s*-->/i);
  return match ? match[1] : null;
}

export function extractChangelogSection(changelogText = '', releaseTag = '') {
  if (!changelogText.trim() || !releaseTag.trim()) {
    return '';
  }

  const version = releaseTag.replace(/^v/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^## \\[${version}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|\\Z)`, 'm');
  const match = changelogText.match(pattern);
  return match ? match[1].trim() : '';
}

function truncate(text, maxLength) {
  if (!text) {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 21).trimEnd()}\n\n...[truncated]`;
}

export function buildTargetIssuePayload({ upstreamRepo, release, issue }) {
  const marker = buildUpstreamIssueMarker(upstreamRepo, issue.number);
  const releaseNotes = truncate(release.body || '(no release notes)', MAX_RELEASE_NOTES_LENGTH);
  const originalBody = truncate(issue.body || '(no issue body)', MAX_ISSUE_BODY_LENGTH);
  const labels = Array.isArray(issue.labels) && issue.labels.length > 0
    ? issue.labels.map((label) => `\`${label.name}\``).join(', ')
    : '(none)';

  return {
    title: `[${upstreamRepo}] Port #${issue.number}: ${issue.title}`,
    body: `${marker}

## Upstream Source
- Release: [${release.tag_name}](${release.html_url})
- Original issue: [#${issue.number}](${issue.html_url})
- Original state: \`${issue.state}\`
- Labels: ${labels}

## Original Title
${issue.title}

## Original Description
${originalBody}

## Release Context
${releaseNotes}

## Porting Note
This issue was auto-created because the upstream release referenced this issue. Track the Codex-native port here.`,
  };
}

async function githubRequest(path, { token, method = 'GET', body, apiBase = DEFAULT_API_BASE }) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${response.statusText}\n${errorText}`);
  }

  return response.status === 204 ? null : response.json();
}

async function githubTextRequest(path, { token, apiBase = DEFAULT_API_BASE }) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      Accept: 'application/vnd.github.raw',
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
  });

  if (response.status === 404) {
    return '';
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API GET ${path} failed: ${response.status} ${response.statusText}\n${errorText}`);
  }

  return response.text();
}

async function listReleases({ upstreamRepo, token, releaseTag, apiBase }) {
  if (releaseTag) {
    const release = await githubRequest(`/repos/${upstreamRepo}/releases/tags/${encodeURIComponent(releaseTag)}`, {
      token,
      apiBase,
    });
    return release.draft ? [] : [release];
  }

  const releases = await githubRequest(`/repos/${upstreamRepo}/releases?per_page=100`, {
    token,
    apiBase,
  });

  return releases
    .filter((release) => !release.draft)
    .sort((left, right) => new Date(left.published_at || left.created_at) - new Date(right.published_at || right.created_at));
}

async function listExistingMarkers({ targetRepo, token, apiBase }) {
  const markers = new Set();
  let page = 1;

  while (true) {
    const items = await githubRequest(`/repos/${targetRepo}/issues?state=all&per_page=100&page=${page}`, {
      token,
      apiBase,
    });

    for (const item of items) {
      if (item.pull_request) {
        continue;
      }

      const marker = extractUpstreamIssueMarker(item.body || '');
      if (marker) {
        markers.add(marker);
      }
    }

    if (items.length < 100) {
      break;
    }

    page += 1;
  }

  return markers;
}

async function fetchChangelog({ upstreamRepo, token, apiBase }) {
  return githubTextRequest(`/repos/${upstreamRepo}/contents/CHANGELOG.md`, {
    token,
    apiBase,
  });
}

async function fetchIssue({ upstreamRepo, issueNumber, token, apiBase }) {
  return githubRequest(`/repos/${upstreamRepo}/issues/${issueNumber}`, {
    token,
    apiBase,
  });
}

async function createIssue({ targetRepo, token, payload, apiBase }) {
  return githubRequest(`/repos/${targetRepo}/issues`, {
    token,
    method: 'POST',
    body: payload,
    apiBase,
  });
}

function toBoolean(value) {
  return String(value).toLowerCase() === 'true';
}

export async function run({
  env = process.env,
  logger = console,
  apiBase = DEFAULT_API_BASE,
} = {}) {
  const token = env.GITHUB_TOKEN;
  const targetRepo = env.TARGET_REPO || env.GITHUB_REPOSITORY;
  const upstreamRepo = env.UPSTREAM_REPO || DEFAULT_UPSTREAM_REPO;
  const releaseTag = env.RELEASE_TAG || '';
  const dryRun = toBoolean(env.DRY_RUN || 'false');

  if (!token) {
    throw new Error('GITHUB_TOKEN is required.');
  }

  if (!targetRepo) {
    throw new Error('TARGET_REPO or GITHUB_REPOSITORY is required.');
  }

  logger.log(`Syncing upstream releases from ${upstreamRepo} into ${targetRepo}${releaseTag ? ` for ${releaseTag}` : ''}.`);

  const releases = await listReleases({
    upstreamRepo,
    token,
    releaseTag,
    apiBase,
  });

  if (releases.length === 0) {
    logger.log('No releases to process.');
    return { created: 0, skipped: 0, scannedReleases: 0 };
  }

  const existingMarkers = await listExistingMarkers({
    targetRepo,
    token,
    apiBase,
  });
  const changelogText = await fetchChangelog({
    upstreamRepo,
    token,
    apiBase,
  });

  let created = 0;
  let planned = 0;
  let skipped = 0;

  for (const release of releases) {
    const changelogSection = extractChangelogSection(changelogText, release.tag_name);
    const candidateIssueNumbers = extractReferencedIssueNumbers([
      release.name || '',
      release.body || '',
      changelogSection,
    ].join('\n'));

    if (candidateIssueNumbers.length === 0) {
      logger.log(`Release ${release.tag_name} has no referenced issues.`);
      continue;
    }

    logger.log(`Release ${release.tag_name}: ${candidateIssueNumbers.length} referenced items detected.`);

    for (const issueNumber of candidateIssueNumbers) {
      const issue = await fetchIssue({
        upstreamRepo,
        issueNumber,
        token,
        apiBase,
      });

      if (issue.pull_request) {
        skipped += 1;
        logger.log(`Skipping #${issueNumber}: upstream reference is a pull request.`);
        continue;
      }

      const marker = `${upstreamRepo}#${issue.number}`;
      if (existingMarkers.has(marker)) {
        skipped += 1;
        logger.log(`Skipping #${issue.number}: already mirrored.`);
        continue;
      }

      const payload = buildTargetIssuePayload({
        upstreamRepo,
        release,
        issue,
      });

      if (dryRun) {
        logger.log(`[dry-run] Would create issue: ${payload.title}`);
        planned += 1;
      } else {
        const createdIssue = await createIssue({
          targetRepo,
          token,
          payload,
          apiBase,
        });
        logger.log(`Created target issue #${createdIssue.number}: ${createdIssue.html_url}`);
        created += 1;
      }

      existingMarkers.add(marker);
    }
  }

  logger.log(
    `Done. ${dryRun ? `Planned ${planned}` : `Created ${created}`} issue(s), skipped ${skipped} item(s), scanned ${releases.length} release(s).`,
  );
  return {
    created,
    planned,
    skipped,
    scannedReleases: releases.length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
