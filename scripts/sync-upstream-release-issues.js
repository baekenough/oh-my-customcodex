import { pathToFileURL } from 'node:url';

const DEFAULT_API_BASE = 'https://api.github.com';
const DEFAULT_UPSTREAM_REPO = 'baekenough/oh-my-customcode';
const DEFAULT_UPSTREAM_REPOS = ['openai/codex', 'Yeachan-Heo/oh-my-codex', DEFAULT_UPSTREAM_REPO];
const USER_AGENT = 'oh-my-customcodex-release-sync';
const MAX_RELEASE_NOTES_LENGTH = 6000;
const MAX_ISSUE_BODY_LENGTH = 12000;

class GitHubRequestError extends Error {
  constructor({ method, path, status, statusText, responseBody }) {
    super(`GitHub API ${method} ${path} failed: ${status} ${statusText}\n${responseBody}`);
    this.name = 'GitHubRequestError';
    this.method = method;
    this.path = path;
    this.status = status;
  }
}

export function extractReferencedIssueNumbers(text = '') {
  if (!text.trim()) {
    return [];
  }

  const candidates = new Set();
  const addCandidate = (rawIssueNumber) => {
    const issueNumber = Number(rawIssueNumber);
    if (Number.isSafeInteger(issueNumber) && issueNumber > 0) {
      candidates.add(issueNumber);
    }
  };
  const sanitized = text
    .replace(/\bPR\s+#\d+\b/gi, '')
    .replace(/\bpull request\s+#\d+\b/gi, '')
    .replace(/\bin\s+#\d+\b/gi, '');

  for (const match of sanitized.matchAll(/#(\d+)\b/g)) {
    addCandidate(match[1]);
  }

  for (const match of sanitized.matchAll(/\/issues\/(\d+)\b/gi)) {
    addCandidate(match[1]);
  }

  return [...candidates].sort((left, right) => left - right);
}

export function extractExplicitIssueNumbers(text = '') {
  if (!text.trim()) {
    return [];
  }

  const candidates = new Set();
  const addCandidate = (rawIssueNumber) => {
    const issueNumber = Number(rawIssueNumber);
    if (Number.isSafeInteger(issueNumber) && issueNumber > 0) {
      candidates.add(issueNumber);
    }
  };

  for (const match of text.matchAll(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|references?)\s+#(\d+)\b/gi
  )) {
    addCandidate(match[1]);
  }

  for (const match of text.matchAll(/\/issues\/(\d+)\b/gi)) {
    addCandidate(match[1]);
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

export function buildUpstreamReleaseMarker(upstreamRepo, releaseTag) {
  return `<!-- upstream-release: ${upstreamRepo}@${releaseTag} -->`;
}

export function extractUpstreamReleaseMarker(body = '') {
  const match = body.match(/<!--\s*upstream-release:\s*([^\s]+)\s*-->/i);
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
  const labels =
    Array.isArray(issue.labels) && issue.labels.length > 0
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

export function buildReleaseUpdatePayload({ upstreamRepo, release }) {
  const marker = buildUpstreamReleaseMarker(upstreamRepo, release.tag_name);
  const releaseNotes = truncate(release.body || '(no release notes)', MAX_RELEASE_NOTES_LENGTH);
  const releaseTitle = release.name?.trim() || release.tag_name;

  return {
    title: `[${upstreamRepo}] Track upstream release ${release.tag_name}`,
    body: `${marker}

## Upstream Release
- Repository: \`${upstreamRepo}\`
- Release: [${releaseTitle}](${release.html_url})
- Tag: \`${release.tag_name}\`
- Published: \`${release.published_at || release.created_at || 'unknown'}\`

## Release Notes
${releaseNotes}

## Porting Note
This issue was auto-created because a dependency upstream published a release without referenced GitHub issues in its release notes or changelog. Review the release and decide whether oh-my-customcodex needs compatibility updates.`,
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
    throw new GitHubRequestError({
      method,
      path,
      status: response.status,
      statusText: response.statusText,
      responseBody: errorText,
    });
  }

  return response.status === 204 ? null : response.json();
}

function isMissingUpstreamIssue(error, upstreamRepo, issueNumber) {
  return (
    error instanceof GitHubRequestError &&
    error.method === 'GET' &&
    error.status === 404 &&
    error.path === `/repos/${upstreamRepo}/issues/${issueNumber}`
  );
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
    throw new Error(
      `GitHub API GET ${path} failed: ${response.status} ${response.statusText}\n${errorText}`
    );
  }

  return response.text();
}

function isInsideReleaseWindow(release, releaseWindowDays, now = new Date()) {
  if (!releaseWindowDays || releaseWindowDays <= 0) {
    return true;
  }

  const timestamp = release.published_at || release.created_at;
  if (!timestamp) {
    return true;
  }

  const publishedAt = new Date(timestamp);
  if (Number.isNaN(publishedAt.valueOf())) {
    return true;
  }

  const windowMs = releaseWindowDays * 24 * 60 * 60 * 1000;
  return now.valueOf() - publishedAt.valueOf() <= windowMs;
}

async function listReleases({
  upstreamRepo,
  token,
  releaseTag,
  releaseWindowDays,
  includePrereleases,
  apiBase,
}) {
  if (releaseTag) {
    const release = await githubRequest(
      `/repos/${upstreamRepo}/releases/tags/${encodeURIComponent(releaseTag)}`,
      {
        token,
        apiBase,
      }
    );
    return release.draft ? [] : [release];
  }

  const releases = await githubRequest(`/repos/${upstreamRepo}/releases?per_page=100`, {
    token,
    apiBase,
  });

  return releases
    .filter((release) => !release.draft)
    .filter((release) => includePrereleases || !release.prerelease)
    .filter((release) => isInsideReleaseWindow(release, releaseWindowDays))
    .sort(
      (left, right) =>
        new Date(left.published_at || left.created_at) -
        new Date(right.published_at || right.created_at)
    );
}

async function listExistingMarkers({ targetRepo, token, apiBase }) {
  const markers = new Set();
  let page = 1;

  while (true) {
    const items = await githubRequest(
      `/repos/${targetRepo}/issues?state=all&per_page=100&page=${page}`,
      {
        token,
        apiBase,
      }
    );

    addMarkersFromIssueList(markers, items);

    if (items.length < 100) {
      break;
    }

    page += 1;
  }

  return markers;
}

function addMarkersFromIssueList(markers, items) {
  for (const item of items) {
    if (item.pull_request) {
      continue;
    }

    addMarkerIfPresent(markers, extractUpstreamIssueMarker(item.body || ''));
    addMarkerIfPresent(markers, extractUpstreamReleaseMarker(item.body || ''));
  }
}

function addMarkerIfPresent(markers, marker) {
  if (marker) {
    markers.add(marker);
  }
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

function toDefaultTrueBoolean(value) {
  return String(value ?? 'true').toLowerCase() !== 'false';
}

function toPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function parseRepoList(value) {
  return String(value || '')
    .split(',')
    .map((repo) => repo.trim())
    .filter(Boolean);
}

export function getRunConfig(env) {
  const token = env.GITHUB_TOKEN;
  const targetRepo = env.TARGET_REPO || env.GITHUB_REPOSITORY;
  const upstreamRepos =
    parseRepoList(env.UPSTREAM_REPOS).length > 0
      ? parseRepoList(env.UPSTREAM_REPOS)
      : env.UPSTREAM_REPO
        ? [env.UPSTREAM_REPO]
        : DEFAULT_UPSTREAM_REPOS;
  const releaseTag = env.RELEASE_TAG || '';
  const dryRun = toBoolean(env.DRY_RUN || 'false');
  const createReleaseUpdateIssues = toDefaultTrueBoolean(env.CREATE_RELEASE_UPDATE_ISSUES);
  const releaseWindowDays = toPositiveNumber(env.UPSTREAM_RELEASE_WINDOW_DAYS || '0');
  const includePrereleases = toBoolean(env.UPSTREAM_INCLUDE_PRERELEASES || 'false');

  return {
    token,
    targetRepo,
    upstreamRepos,
    releaseTag,
    dryRun,
    createReleaseUpdateIssues,
    releaseWindowDays,
    includePrereleases,
  };
}

function validateRunConfig({ token, targetRepo }) {
  if (!token) {
    throw new Error('GITHUB_TOKEN is required.');
  }

  if (!targetRepo) {
    throw new Error('TARGET_REPO or GITHUB_REPOSITORY is required.');
  }
}

function shouldUseBroadIssueRefs(upstreamRepo) {
  return !['openai/codex', 'Yeachan-Heo/oh-my-codex'].includes(upstreamRepo);
}

function getCandidateIssueNumbersForRelease(release, changelogText, upstreamRepo) {
  const changelogSection = extractChangelogSection(changelogText, release.tag_name);
  const candidateText = [release.name || '', release.body || '', changelogSection].join('\n');
  return shouldUseBroadIssueRefs(upstreamRepo)
    ? extractReferencedIssueNumbers(candidateText)
    : extractExplicitIssueNumbers(candidateText);
}

async function createOrPlanIssue({
  dryRun,
  targetRepo,
  token,
  upstreamRepo,
  release,
  issue,
  existingMarkers,
  apiBase,
  logger,
}) {
  const marker = `${upstreamRepo}#${issue.number}`;
  if (existingMarkers.has(marker)) {
    logger.log(`Skipping #${issue.number}: already mirrored.`);
    return { created: 0, planned: 0, skipped: 1 };
  }

  const payload = buildTargetIssuePayload({
    upstreamRepo,
    release,
    issue,
  });

  if (dryRun) {
    logger.log(`[dry-run] Would create issue: ${payload.title}`);
    existingMarkers.add(marker);
    return { created: 0, planned: 1, skipped: 0 };
  }

  const createdIssue = await createIssue({
    targetRepo,
    token,
    payload,
    apiBase,
  });
  logger.log(`Created target issue #${createdIssue.number}: ${createdIssue.html_url}`);
  existingMarkers.add(marker);
  return { created: 1, planned: 0, skipped: 0 };
}

async function createOrPlanReleaseUpdateIssue({
  dryRun,
  targetRepo,
  token,
  upstreamRepo,
  release,
  existingMarkers,
  apiBase,
  logger,
}) {
  const marker = `${upstreamRepo}@${release.tag_name}`;
  if (existingMarkers.has(marker)) {
    logger.log(`Skipping ${release.tag_name}: release already tracked.`);
    return { created: 0, planned: 0, skipped: 1 };
  }

  const payload = buildReleaseUpdatePayload({
    upstreamRepo,
    release,
  });

  if (dryRun) {
    logger.log(`[dry-run] Would create release update issue: ${payload.title}`);
    existingMarkers.add(marker);
    return { created: 0, planned: 1, skipped: 0 };
  }

  const createdIssue = await createIssue({
    targetRepo,
    token,
    payload,
    apiBase,
  });
  logger.log(`Created release update issue #${createdIssue.number}: ${createdIssue.html_url}`);
  existingMarkers.add(marker);
  return { created: 1, planned: 0, skipped: 0 };
}

async function processRelease({
  release,
  changelogText,
  upstreamRepo,
  targetRepo,
  token,
  dryRun,
  createReleaseUpdateIssues,
  existingMarkers,
  apiBase,
  logger,
}) {
  const candidateIssueNumbers = getCandidateIssueNumbersForRelease(
    release,
    changelogText,
    upstreamRepo
  );

  if (candidateIssueNumbers.length === 0) {
    logger.log(`Release ${release.tag_name} has no referenced issues.`);
    if (createReleaseUpdateIssues) {
      return createOrPlanReleaseUpdateIssue({
        dryRun,
        targetRepo,
        token,
        upstreamRepo,
        release,
        existingMarkers,
        apiBase,
        logger,
      });
    }

    return { created: 0, planned: 0, skipped: 0 };
  }

  logger.log(
    `Release ${release.tag_name}: ${candidateIssueNumbers.length} referenced items detected.`
  );

  const totals = { created: 0, planned: 0, skipped: 0 };
  let sawNonPullIssue = false;

  for (const issueNumber of candidateIssueNumbers) {
    let issue;
    try {
      issue = await fetchIssue({
        upstreamRepo,
        issueNumber,
        token,
        apiBase,
      });
    } catch (error) {
      if (isMissingUpstreamIssue(error, upstreamRepo, issueNumber)) {
        totals.skipped += 1;
        logger.log(`Skipping #${issueNumber}: upstream issue was not found.`);
        continue;
      }

      throw error;
    }

    if (issue.pull_request) {
      totals.skipped += 1;
      logger.log(`Skipping #${issueNumber}: upstream reference is a pull request.`);
      continue;
    }

    sawNonPullIssue = true;
    const result = await createOrPlanIssue({
      dryRun,
      targetRepo,
      token,
      upstreamRepo,
      release,
      issue,
      existingMarkers,
      apiBase,
      logger,
    });
    totals.created += result.created;
    totals.planned += result.planned;
    totals.skipped += result.skipped;
  }

  if (!sawNonPullIssue && createReleaseUpdateIssues) {
    const result = await createOrPlanReleaseUpdateIssue({
      dryRun,
      targetRepo,
      token,
      upstreamRepo,
      release,
      existingMarkers,
      apiBase,
      logger,
    });
    totals.created += result.created;
    totals.planned += result.planned;
    totals.skipped += result.skipped;
  }

  return totals;
}

export async function run({
  env = process.env,
  logger = console,
  apiBase = DEFAULT_API_BASE,
} = {}) {
  const {
    token,
    targetRepo,
    upstreamRepos,
    releaseTag,
    dryRun,
    createReleaseUpdateIssues,
    releaseWindowDays,
    includePrereleases,
  } = getRunConfig(env);

  validateRunConfig({ token, targetRepo });

  logger.log(
    `Syncing upstream releases from ${upstreamRepos.join(', ')} into ${targetRepo}${releaseTag ? ` for ${releaseTag}` : ''}.`
  );

  const existingMarkers = await listExistingMarkers({
    targetRepo,
    token,
    apiBase,
  });

  let created = 0;
  let planned = 0;
  let skipped = 0;
  let scannedReleases = 0;

  for (const upstreamRepo of upstreamRepos) {
    const releases = await listReleases({
      upstreamRepo,
      token,
      releaseTag,
      releaseWindowDays,
      includePrereleases,
      apiBase,
    });

    if (releases.length === 0) {
      logger.log(`No releases to process for ${upstreamRepo}.`);
      continue;
    }

    const changelogText = await fetchChangelog({
      upstreamRepo,
      token,
      apiBase,
    });

    for (const release of releases) {
      const totals = await processRelease({
        release,
        changelogText,
        upstreamRepo,
        targetRepo,
        token,
        dryRun,
        createReleaseUpdateIssues,
        existingMarkers,
        apiBase,
        logger,
      });
      created += totals.created;
      planned += totals.planned;
      skipped += totals.skipped;
    }

    scannedReleases += releases.length;
  }

  logger.log(
    `Done. ${dryRun ? `Planned ${planned}` : `Created ${created}`} issue(s), skipped ${skipped} item(s), scanned ${scannedReleases} release(s).`
  );
  return {
    created,
    planned,
    skipped,
    scannedReleases,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
