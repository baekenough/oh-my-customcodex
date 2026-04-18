import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTargetIssuePayload,
  buildUpstreamIssueMarker,
  extractChangelogSection,
  extractReferencedIssueNumbers,
  extractUpstreamIssueMarker,
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

test('marker helpers round-trip marker values', () => {
  const marker = buildUpstreamIssueMarker('baekenough/oh-my-customcode', 264);
  assert.equal(marker, '<!-- upstream-release-issue: baekenough/oh-my-customcode#264 -->');
  assert.equal(
    extractUpstreamIssueMarker(`${marker}\n\nBody`),
    'baekenough/oh-my-customcode#264',
  );
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
    '- omcustom namespace prefix (Closes #264)\n- docs sync (#328, #329)',
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
    '[baekenough/oh-my-customcode] Port #264: omcustom namespace prefix convention',
  );
  assert.match(payload.body, /upstream-release-issue: baekenough\/oh-my-customcode#264/);
  assert.match(payload.body, /Release: \[v0\.34\.0]/);
  assert.match(payload.body, /Need to rename command namespace to omcustom\./);
});
