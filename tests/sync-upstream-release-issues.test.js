import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  buildReleaseUpdatePayload,
  buildTargetIssuePayload,
  buildUpstreamIssueMarker,
  buildUpstreamReleaseMarker,
  countUnicodeCharacters,
  extractChangelogSection,
  extractExplicitIssueNumbers,
  extractReferencedIssueNumbers,
  extractUpstreamIssueMarker,
  extractUpstreamReleaseMarker,
  fitGitHubIssueBody,
  GITHUB_ISSUE_BODY_CHARACTER_LIMIT,
  getRunConfig,
  run,
} from '../scripts/sync-upstream-release-issues.js';

test('extractReferencedIssueNumbers deduplicates refs and ignores explicit PR refs', () => {
  const releaseNotes = `
## What's Changed
- omcustom namespace prefix (Closes #264)
- Docs fixes (#328, #329)
- README sync (PR #308)
- Dependency update by @contributor in #987
- Original issue URL: https://github.com/baekenough/oh-my-customcode/issues/264
`;

  assert.deepEqual(extractReferencedIssueNumbers(releaseNotes), [264, 328, 329]);
});

test('extractReferencedIssueNumbers ignores invalid zero issue references', () => {
  const releaseNotes = `
## What's Changed
- Placeholder reference should not be queried (#0)
- Placeholder URL should not be queried: https://github.com/baekenough/oh-my-customcode/issues/0
- Valid follow-up (#1203)
`;

  assert.deepEqual(extractReferencedIssueNumbers(releaseNotes), [1203]);
});

test('extractExplicitIssueNumbers ignores generated release PR references', () => {
  const releaseNotes = `
## What's Changed
- Bug fix (fixes #123)
- Dependency update by @contributor in #987
- Parenthetical PR reference (#988)
- Original issue URL: https://github.com/openai/codex/issues/321
`;

  assert.deepEqual(extractExplicitIssueNumbers(releaseNotes), [123, 321]);
});

test('marker helpers round-trip marker values', () => {
  const marker = buildUpstreamIssueMarker('baekenough/oh-my-customcode', 264);
  assert.equal(marker, '<!-- upstream-release-issue: baekenough/oh-my-customcode#264 -->');
  assert.equal(extractUpstreamIssueMarker(`${marker}\n\nBody`), 'baekenough/oh-my-customcode#264');

  const releaseMarker = buildUpstreamReleaseMarker('openai/codex', 'v0.64.0');
  assert.equal(releaseMarker, '<!-- upstream-release: openai/codex@v0.64.0 -->');
  assert.equal(extractUpstreamReleaseMarker(`${releaseMarker}\n\nBody`), 'openai/codex@v0.64.0');
});

test('extractChangelogSection returns only the requested release block', () => {
  const changelog = `
## [0.35.0] - 2026-03-14
- cost monitoring (#339)

## [0.34.0] - 2026-03-14
- omcustom namespace prefix (Closes #264)
- docs sync (#328, #329)

## [0.33.1] - 2026-03-13
- validate-docs fix (#325)
`;

  assert.equal(
    extractChangelogSection(changelog, 'v0.34.0'),
    '- omcustom namespace prefix (Closes #264)\n- docs sync (#328, #329)'
  );
});

test('buildTargetIssuePayload embeds upstream marker and release context', () => {
  const payload = buildTargetIssuePayload({
    upstreamRepo: 'baekenough/oh-my-customcode',
    release: {
      tag_name: 'v0.34.0',
      html_url: 'https://github.com/baekenough/oh-my-customcode/releases/tag/v0.34.0',
      body: '- omcustom namespace prefix (Closes #264)',
    },
    issue: {
      number: 264,
      title: 'omcustom namespace prefix convention',
      html_url: 'https://github.com/baekenough/oh-my-customcode/issues/264',
      state: 'closed',
      body: 'Need to rename command namespace to omcustom.',
      labels: [{ name: 'enhancement' }, { name: 'cli' }],
    },
  });

  assert.equal(
    payload.title,
    '[baekenough/oh-my-customcode] Port #264: omcustom namespace prefix convention'
  );
  assert.match(payload.body, /upstream-release-issue: baekenough\/oh-my-customcode#264/);
  assert.match(payload.body, /Release: \[v0\.34\.0]/);
  assert.match(payload.body, /Need to rename command namespace to omcustom\./);
});

test('buildReleaseUpdatePayload tracks upstream releases without issue references', () => {
  const payload = buildReleaseUpdatePayload({
    upstreamRepo: 'openai/codex',
    release: {
      tag_name: 'v0.64.0',
      name: 'Codex CLI 0.64.0',
      html_url: 'https://github.com/openai/codex/releases/tag/v0.64.0',
      published_at: '2026-05-29T00:00:00Z',
      body: '- improved model routing',
    },
  });

  assert.equal(payload.title, '[openai/codex] Track upstream release v0.64.0');
  assert.match(payload.body, /upstream-release: openai\/codex@v0\.64\.0/);
  assert.match(payload.body, /dependency upstream published a release/);
});

test('getRunConfig defaults to Codex and OMX dependency upstreams', () => {
  const config = getRunConfig({
    GITHUB_TOKEN: 'token',
    GITHUB_REPOSITORY: 'baekenough/oh-my-customcodex',
  });

  assert.deepEqual(config.upstreamRepos.slice(0, 2), ['openai/codex', 'Yeachan-Heo/oh-my-codex']);
  assert.equal(config.createReleaseUpdateIssues, true);
  assert.equal(config.includePrereleases, false);
});

test('run skips missing upstream issue references instead of failing the sync', async (t) => {
  const createdIssues = [];
  const requests = [];
  const writeJson = (response, payload, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
  };
  const routes = new Map([
    [
      'GET /repos/upstream/project/releases/tags/v1.0.0',
      (_request, response) =>
        writeJson(response, {
          tag_name: 'v1.0.0',
          name: 'v1.0.0',
          body: 'Valid work (#123) and stale placeholder (#999).',
          html_url: 'https://github.com/upstream/project/releases/tag/v1.0.0',
          draft: false,
        }),
    ],
    ['GET /repos/target/project/issues', (_request, response) => writeJson(response, [])],
    [
      'GET /repos/upstream/project/contents/CHANGELOG.md',
      (_request, response) => {
        response.setHeader('Content-Type', 'text/plain');
        response.end('');
      },
    ],
    [
      'GET /repos/upstream/project/issues/123',
      (_request, response) =>
        writeJson(response, {
          number: 123,
          title: 'Valid upstream issue',
          html_url: 'https://github.com/upstream/project/issues/123',
          state: 'closed',
          body: 'Ship the valid issue.',
          labels: [],
        }),
    ],
    [
      'GET /repos/upstream/project/issues/999',
      (_request, response) => writeJson(response, { message: 'Not Found' }, 404),
    ],
    [
      'POST /repos/target/project/issues',
      async (request, response) => {
        let body = '';
        for await (const chunk of request) {
          body += chunk;
        }

        const payload = JSON.parse(body);
        createdIssues.push(payload);
        writeJson(
          response,
          {
            number: 77,
            html_url: 'https://github.com/target/project/issues/77',
          },
          201
        );
      },
    ],
  ]);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const routeKey = `${request.method} ${url.pathname}`;
    requests.push(routeKey);

    const route = routes.get(routeKey);
    if (route) {
      await route(request, response);
      return;
    }

    writeJson(response, { message: 'unexpected route' }, 404);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const logs = [];
  const result = await run({
    apiBase: `http://127.0.0.1:${port}`,
    env: {
      GITHUB_TOKEN: 'test-token',
      TARGET_REPO: 'target/project',
      UPSTREAM_REPO: 'upstream/project',
      RELEASE_TAG: 'v1.0.0',
      DRY_RUN: 'false',
    },
    logger: {
      log: (message) => logs.push(message),
    },
  });

  assert.deepEqual(result, { created: 1, planned: 0, skipped: 1, scannedReleases: 1 });
  assert.equal(createdIssues.length, 1);
  assert.match(createdIssues[0].title, /Port #123/);
  assert.deepEqual(
    requests.filter((request) => request.includes('/repos/upstream/project/issues/999')),
    ['GET /repos/upstream/project/issues/999']
  );
  assert.ok(logs.includes('Skipping #999: upstream issue was not found.'));
});

test('run creates a release update issue when a dependency release only references PRs', async (t) => {
  const createdIssues = [];
  const server = http.createServer((request, response) =>
    handleReleaseSyncMockRequest(request, response, createdIssues)
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const result = await run({
    apiBase: `http://127.0.0.1:${port}`,
    env: {
      GITHUB_TOKEN: 'token',
      TARGET_REPO: 'target/repo',
      UPSTREAM_REPOS: 'openai/codex',
    },
    logger: { log() {} },
  });

  assert.equal(result.created, 1);
  assert.equal(result.scannedReleases, 1);
  assert.equal(createdIssues.length, 1);
  assert.equal(createdIssues[0].title, '[openai/codex] Track upstream release v0.64.0');
  assert.match(createdIssues[0].body, /upstream-release: openai\/codex@v0\.64\.0/);
});

test('run retries transient GitHub read failures before failing the release sync', async (t) => {
  const createdIssues = [];
  let releaseAttempts = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    const route = `${request.method} ${url.pathname}`;

    if (route === 'GET /repos/target/repo/issues') {
      sendJson(response, 200, []);
      return;
    }

    if (route === 'GET /repos/openai/codex/releases') {
      releaseAttempts += 1;
      if (releaseAttempts === 1) {
        sendJson(response, 504, { message: 'Gateway Timeout' });
        return;
      }

      sendJson(response, 200, [
        {
          tag_name: 'v0.64.0',
          name: 'Codex CLI 0.64.0',
          html_url: 'https://github.com/openai/codex/releases/tag/v0.64.0',
          published_at: '2026-05-29T00:00:00Z',
          draft: false,
          prerelease: false,
          body: '- improved model routing by @contributor in #987',
        },
      ]);
      return;
    }

    if (route === 'GET /repos/openai/codex/contents/CHANGELOG.md') {
      sendJson(response, 404, {});
      return;
    }

    if (route === 'POST /repos/target/repo/issues') {
      createdIssues.push(await readJsonBody(request));
      sendJson(response, 201, {
        number: 124,
        html_url: 'https://github.test/target/repo/issues/124',
      });
      return;
    }

    sendJson(response, 404, { message: `unexpected ${route}` });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const result = await run({
    apiBase: `http://127.0.0.1:${port}`,
    env: {
      GITHUB_TOKEN: 'token',
      TARGET_REPO: 'target/repo',
      UPSTREAM_REPOS: 'openai/codex',
    },
    logger: { log() {} },
  });

  assert.equal(releaseAttempts, 2);
  assert.equal(result.created, 1);
  assert.equal(result.scannedReleases, 1);
  assert.equal(createdIssues.length, 1);
});

async function handleReleaseSyncMockRequest(request, response, createdIssues) {
  const url = new URL(request.url || '/', 'http://localhost');
  const route = `${request.method} ${url.pathname}`;

  if (route === 'GET /repos/target/repo/issues') {
    sendJson(response, 200, []);
    return;
  }

  if (route === 'GET /repos/openai/codex/releases') {
    sendJson(response, 200, [
      {
        tag_name: 'rust-v0.131.0-alpha.22',
        name: 'Codex Rust alpha',
        html_url: 'https://github.com/openai/codex/releases/tag/rust-v0.131.0-alpha.22',
        published_at: '2026-05-29T00:00:00Z',
        draft: false,
        prerelease: true,
        body: '- alpha update by @contributor in #988',
      },
      {
        tag_name: 'v0.64.0',
        name: 'Codex CLI 0.64.0',
        html_url: 'https://github.com/openai/codex/releases/tag/v0.64.0',
        published_at: '2026-05-29T00:00:00Z',
        draft: false,
        prerelease: false,
        body: '- improved model routing by @contributor in #987',
      },
    ]);
    return;
  }

  if (route === 'GET /repos/openai/codex/contents/CHANGELOG.md') {
    sendJson(response, 404, {});
    return;
  }

  if (route === 'POST /repos/target/repo/issues') {
    createdIssues.push(await readJsonBody(request));
    sendJson(response, 201, {
      number: 123,
      html_url: 'https://github.test/target/repo/issues/123',
    });
    return;
  }

  sendJson(response, 404, { message: `unexpected ${route}` });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

test('GitHub issue body helper accepts the exact 65,536 ASCII-character boundary', () => {
  const body = 'a'.repeat(GITHUB_ISSUE_BODY_CHARACTER_LIMIT);
  const fitted = fitGitHubIssueBody(body, {
    sourceUrl: 'https://example.test/issues/1',
    sectionName: 'Original Description',
  });

  assert.equal(fitted, body);
  assert.equal(countUnicodeCharacters(fitted), 65_536);
});

test('GitHub issue body helper reduces the 65,537-character boundary explicitly', () => {
  const fitted = fitGitHubIssueBody('a'.repeat(GITHUB_ISSUE_BODY_CHARACTER_LIMIT + 1), {
    sourceUrl: 'https://example.test/issues/1',
    sectionName: 'Original Description',
  });

  assert.ok(countUnicodeCharacters(fitted) <= GITHUB_ISSUE_BODY_CHARACTER_LIMIT);
  assert.match(fitted, /content overflow/i);
  assert.match(fitted, /Original characters: 65537/);
  assert.match(fitted, /SHA-256:/);
  assert.doesNotMatch(fitted, /\.\.\.\[truncated\]/);
});

test('Unicode fitting counts code points separately from encoded JSON bytes', () => {
  const original = '🙂'.repeat(GITHUB_ISSUE_BODY_CHARACTER_LIMIT + 1);
  const fitted = fitGitHubIssueBody(original, {
    sourceUrl: 'https://example.test/issues/emoji',
    sectionName: 'Original Description',
  });

  assert.ok(countUnicodeCharacters(fitted) <= GITHUB_ISSUE_BODY_CHARACTER_LIMIT);
  assert.equal(fitted.includes('\uFFFD'), false);
  assert.ok(Buffer.byteLength(JSON.stringify({ body: fitted }), 'utf8') > fitted.length);
});

test('target payload preserves an original body above the former 12,000-character cap', () => {
  const originalBody = 'original-context-'.repeat(1_000);
  const payload = buildTargetIssuePayload({
    upstreamRepo: 'upstream/project',
    release: {
      tag_name: 'v1.2.3',
      html_url: 'https://github.com/upstream/project/releases/tag/v1.2.3',
      body: 'release notes',
    },
    issue: {
      number: 42,
      title: 'Preserve context',
      html_url: 'https://github.com/upstream/project/issues/42',
      state: 'closed',
      body: originalBody,
      labels: [],
    },
  });

  assert.match(payload.body, new RegExp(originalBody.slice(-200)));
  assert.doesNotMatch(payload.body, /\.\.\.\[truncated\]/);
});

test('target payload prioritizes original issue context and keeps markers/headings unindented', () => {
  const payload = buildTargetIssuePayload({
    upstreamRepo: 'upstream/project',
    release: {
      tag_name: 'v9.9.9',
      html_url: 'https://github.com/upstream/project/releases/tag/v9.9.9',
      body: 'secondary-release-notes-'.repeat(5_000),
    },
    issue: {
      number: 77,
      title: 'Large context',
      html_url: 'https://github.com/upstream/project/issues/77',
      state: 'closed',
      body: 'primary-issue-context-'.repeat(5_000),
      labels: [{ name: 'enhancement' }],
    },
  });

  assert.ok(countUnicodeCharacters(payload.body) <= GITHUB_ISSUE_BODY_CHARACTER_LIMIT);
  assert.match(payload.body, /Original issue: \[#77]/);
  assert.match(payload.body, /content overflow/i);
  const structuralLines = payload.body
    .split('\n')
    .filter(
      (line) => line.includes('upstream-release-issue:') || line.trimStart().startsWith('## ')
    );
  assert.ok(structuralLines.length > 0);
  assert.ok(structuralLines.every((line) => line === line.trimStart()));
});

test('release update payload fits large notes with explicit source evidence', () => {
  const payload = buildReleaseUpdatePayload({
    upstreamRepo: 'openai/codex',
    release: {
      tag_name: 'v9.9.9',
      name: 'Large release',
      html_url: 'https://github.com/openai/codex/releases/tag/v9.9.9',
      published_at: '2026-07-16T00:00:00Z',
      body: 'large-release-note-'.repeat(5_000),
    },
  });

  assert.ok(countUnicodeCharacters(payload.body) <= GITHUB_ISSUE_BODY_CHARACTER_LIMIT);
  assert.match(payload.body, /content overflow/i);
  assert.match(payload.body, /openai\/codex\/releases\/tag\/v9\.9\.9/);
  assert.match(payload.body, /SHA-256:/);
});
