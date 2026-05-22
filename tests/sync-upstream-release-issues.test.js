import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import {
  buildTargetIssuePayload,
  buildUpstreamIssueMarker,
  extractChangelogSection,
  extractReferencedIssueNumbers,
  extractUpstreamIssueMarker,
  run,
} from '../scripts/sync-upstream-release-issues.js';

test('extractReferencedIssueNumbers deduplicates refs and ignores explicit PR refs', () => {
  const releaseNotes = `
## What's Changed
- omcustom namespace prefix (Closes #264)
- Docs fixes (#328, #329)
- README sync (PR #308)
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

test('marker helpers round-trip marker values', () => {
  const marker = buildUpstreamIssueMarker('baekenough/oh-my-customcode', 264);
  assert.equal(marker, '<!-- upstream-release-issue: baekenough/oh-my-customcode#264 -->');
  assert.equal(extractUpstreamIssueMarker(`${marker}\n\nBody`), 'baekenough/oh-my-customcode#264');
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
