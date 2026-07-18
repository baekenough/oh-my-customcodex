import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyTriageDraft,
  hasExactMarkerLine,
  milestoneRequestPayload,
  triageCommentMarker,
  validateTriageDraft,
} from '../scripts/apply-triage-draft.mjs';

function snapshot(overrides = {}) {
  return {
    state: 'OPEN',
    labels: ['verify-ready'],
    assignees: [],
    milestoneNumber: 29,
    ...overrides,
  };
}

function commentPayload(actionId = 'issue-1643-comment') {
  const body = Buffer.from(
    `Reviewed triage comment.\n\n<!-- triage-action:${actionId} -->\n`,
    'utf8'
  );
  return {
    body,
    bodyBytes: body.byteLength,
    bodySha256: createHash('sha256').update(body).digest('hex'),
  };
}

function commentAction(bodyFile, overrides = {}) {
  const payload = commentPayload();
  return {
    id: 'issue-1643-comment',
    kind: 'issue.comment',
    rationale: 'Record the reviewed automation transition.',
    evidenceRefs: ['issue-1643-live'],
    issue: 1643,
    precondition: snapshot(),
    idempotencyKey: '<!-- triage-action:issue-1643-comment -->',
    bodyFile,
    bodyBytes: payload.bodyBytes,
    bodySha256: payload.bodySha256,
    ...overrides,
  };
}

function draft(actionOverrides = {}) {
  return {
    schemaVersion: 1,
    repository: 'baekenough/oh-my-customcodex',
    evidenceJoined: true,
    evidenceSources: [
      {
        id: 'issue-1643-live',
        kind: 'github-issue',
        source: 'https://github.com/baekenough/oh-my-customcodex/issues/1643',
        observedAt: '2026-07-16T00:00:00.000Z',
      },
    ],
    reviewed: true,
    reviewedAt: '2026-07-16T00:00:00.000Z',
    actions: [
      {
        id: 'issue-1643-start',
        kind: 'issue.update',
        rationale: 'Mark the evidence-backed release scope as in progress.',
        evidenceRefs: ['issue-1643-live'],
        issue: 1643,
        precondition: snapshot(),
        desired: snapshot({
          labels: ['in-progress', 'verify-ready'],
          assignees: ['baekenough'],
        }),
        ...actionOverrides,
      },
    ],
  };
}

function milestoneAction({
  title = 'v1.0.26',
  precondition = null,
  desired = { state: 'open', description: `Release ${title}`, dueOn: null },
} = {}) {
  return {
    id: `milestone-${title}`,
    kind: 'milestone.ensure',
    rationale: 'Keep the release milestone aligned with reviewed evidence.',
    evidenceRefs: ['issue-1643-live'],
    title,
    precondition,
    desired,
  };
}

function milestoneMetadata(dueOn, description = 'Release v1.0.26') {
  return { state: 'open', description, dueOn };
}

function createClient(initial = snapshot(), resources = {}) {
  let current = structuredClone(initial);
  let label = structuredClone(resources.label ?? null);
  let milestone = structuredClone(resources.milestone ?? null);
  let commentExists = resources.commentExists ?? false;
  return {
    reads: 0,
    writes: 0,
    async readIssue() {
      this.reads += 1;
      return structuredClone(current);
    },
    async updateIssue(_issue, desired) {
      this.writes += 1;
      current = structuredClone(desired);
    },
    async readLabel() {
      return structuredClone(label);
    },
    async ensureLabel(_name, desired) {
      this.writes += 1;
      label = structuredClone(desired);
    },
    async readMilestone() {
      return structuredClone(milestone);
    },
    async ensureMilestone(_title, desired) {
      this.writes += 1;
      milestone = structuredClone(desired);
    },
    async hasComment() {
      return commentExists;
    },
    async addComment(_issue, body) {
      await resources.onAddComment?.(body);
      this.writes += 1;
      commentExists = true;
    },
  };
}

test('rejects an unreviewed or unjoined mutation draft', () => {
  assert.throws(() => validateTriageDraft({ ...draft(), reviewed: false }), /reviewed/i);
  assert.throws(
    () => validateTriageDraft({ ...draft(), evidenceJoined: false }),
    /evidence.*join/i
  );
});

test('rejects stale preconditions before any write', async () => {
  const client = createClient(snapshot({ labels: ['decision-needed'] }));

  await assert.rejects(applyTriageDraft(draft(), { client }), /precondition.*1643/i);
  assert.equal(client.writes, 0);
});

test('preflights a stale second issue before writing the first issue', async () => {
  const input = draft();
  input.actions.push({
    ...structuredClone(input.actions[0]),
    id: 'issue-1662-start',
    issue: 1662,
  });
  const issues = new Map([
    [1643, snapshot()],
    [1662, snapshot({ labels: ['decision-needed'] })],
  ]);
  const client = {
    writes: 0,
    async readIssue(issue) {
      return structuredClone(issues.get(issue));
    },
    async updateIssue(issue, desired) {
      this.writes += 1;
      issues.set(issue, structuredClone(desired));
    },
  };

  await assert.rejects(applyTriageDraft(input, { client }), /precondition.*1662/i);
  assert.equal(client.writes, 0);
  assert.deepEqual(issues.get(1643), snapshot());
});

test('treats an already matching desired state as idempotent success', async () => {
  const desired = draft().actions[0].desired;
  const client = createClient(desired);

  const result = await applyTriageDraft(draft(), { client });

  assert.equal(result.skipped, 1);
  assert.equal(result.applied, 0);
  assert.equal(client.writes, 0);
  assert.ok(client.reads >= 1);
});

test('applies a reviewed issue update and performs direct readback', async () => {
  const client = createClient();

  const result = await applyTriageDraft(draft(), { client });

  assert.equal(result.applied, 1);
  assert.equal(result.failed, 0);
  assert.equal(client.writes, 1);
  assert.ok(client.reads >= 2);
});

test('rejects a stale multi-action issue sequence before the first write', async () => {
  const input = draft();
  input.actions = [input.actions[0], commentAction('/unused/in/sequence/test.md')];
  const client = createClient();

  await assert.rejects(
    applyTriageDraft(input, { client }),
    /action sequence.*stale precondition.*1643/i
  );
  assert.equal(client.writes, 0);
});

test('applies a lifecycle comment before an update that shares its observed snapshot', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'triage-comment-sequence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bodyFile = join(directory, 'comment.md');
  await writeFile(bodyFile, commentPayload().body);
  const input = draft();
  input.actions = [commentAction(bodyFile), input.actions[0]];
  const client = createClient();

  const result = await applyTriageDraft(input, { client });

  assert.equal(result.applied, 2);
  assert.equal(result.failed, 0);
  assert.equal(client.writes, 2);
});

test('rejects unknown actions instead of inventing a mutation', () => {
  const input = draft({ kind: 'issue.delete' });
  assert.throws(() => validateTriageDraft(input), /unsupported.*issue\.delete/i);
});

test('ensures a label once and verifies its direct readback', async () => {
  const input = draft();
  input.actions = [
    {
      id: 'label-in-progress',
      kind: 'label.ensure',
      rationale: 'The lifecycle requires the in-progress label.',
      evidenceRefs: ['issue-1643-live'],
      name: 'in-progress',
      precondition: null,
      desired: { color: 'FBCA04', description: 'Work in progress' },
    },
  ];
  const client = createClient();

  const result = await applyTriageDraft(input, { client });

  assert.equal(result.applied, 1);
  assert.equal(client.writes, 1);
});

test('ensures a milestone once and verifies its direct readback', async () => {
  const input = draft();
  input.actions = [milestoneAction({ title: 'v1.0.24' })];
  const client = createClient();

  const result = await applyTriageDraft(input, { client });

  assert.equal(result.applied, 1);
  assert.equal(client.writes, 1);
});

test('rejects unsupported milestone due-date clearing before any earlier write', async () => {
  const currentMilestone = milestoneMetadata('2026-07-31T00:00:00Z');
  const input = draft();
  input.actions.push(
    milestoneAction({
      precondition: currentMilestone,
      desired: { ...currentMilestone, dueOn: null },
    })
  );
  const client = createClient(snapshot(), { milestone: currentMilestone });

  await assert.rejects(
    applyTriageDraft(input, { client }),
    /milestone v1\.0\.26 cannot clear.*due date.*unsupported/i
  );
  assert.equal(client.writes, 0);
});

test('preserves supported milestone due-date transitions', async () => {
  const cases = [
    {
      name: 'null to null update',
      current: milestoneMetadata(null, 'Old description'),
      desired: milestoneMetadata(null),
      expectedStatus: 'applied',
      expectedWrites: 1,
    },
    {
      name: 'non-null unchanged',
      current: milestoneMetadata('2026-07-31T00:00:00Z'),
      desired: milestoneMetadata('2026-07-31T00:00:00Z'),
      expectedStatus: 'skipped',
      expectedWrites: 0,
    },
    {
      name: 'non-null to non-null update',
      current: milestoneMetadata('2026-07-31T00:00:00Z'),
      desired: milestoneMetadata('2026-08-01T00:00:00Z'),
      expectedStatus: 'applied',
      expectedWrites: 1,
    },
  ];

  for (const testCase of cases) {
    const input = draft();
    input.actions = [
      milestoneAction({
        precondition: testCase.current,
        desired: testCase.desired,
      }),
    ];
    const client = createClient(snapshot(), { milestone: testCase.current });

    const result = await applyTriageDraft(input, { client });

    assert.equal(result[testCase.expectedStatus], 1, testCase.name);
    assert.equal(client.writes, testCase.expectedWrites, testCase.name);
  }
});

test('omits a null milestone due date from GitHub API payloads', () => {
  const payload = milestoneRequestPayload('v1.0.26', {
    state: 'open',
    description: 'Release v1.0.26',
    dueOn: null,
  });

  assert.deepEqual(payload, {
    title: 'v1.0.26',
    state: 'open',
    description: 'Release v1.0.26',
  });
  assert.equal(Object.hasOwn(payload, 'due_on'), false);
});

test('preserves a non-null milestone due date in GitHub API payloads', () => {
  const payload = milestoneRequestPayload('v1.0.26', {
    state: 'open',
    description: 'Release v1.0.26',
    dueOn: '2026-07-31T00:00:00Z',
  });

  assert.equal(payload.due_on, '2026-07-31T00:00:00Z');
});

test('treats an existing idempotency comment marker as a skipped action', async () => {
  const input = draft();
  input.actions = [commentAction('/unused/in/idempotent/test.md')];
  const client = createClient(snapshot(), { commentExists: true });

  const result = await applyTriageDraft(input, { client });

  assert.equal(result.skipped, 1);
  assert.equal(client.writes, 0);
});

test('requires a complete issue precondition for comment actions', () => {
  const missingPrecondition = draft();
  missingPrecondition.actions = [commentAction('/tmp/comment.md')];
  delete missingPrecondition.actions[0].precondition;
  assert.throws(
    () => validateTriageDraft(missingPrecondition),
    /comment.*complete precondition|complete precondition.*comment/i
  );

  const incompletePrecondition = draft();
  incompletePrecondition.actions = [commentAction('/tmp/comment.md')];
  delete incompletePrecondition.actions[0].precondition.labels;
  assert.throws(() => validateTriageDraft(incompletePrecondition), /complete precondition/i);
});

test('requires reviewed comment byte-size and SHA-256 bindings', () => {
  const missingBytes = draft();
  missingBytes.actions = [commentAction('/tmp/comment.md')];
  delete missingBytes.actions[0].bodyBytes;
  assert.throws(() => validateTriageDraft(missingBytes), /bodyBytes.*positive integer/i);

  const missingDigest = draft();
  missingDigest.actions = [commentAction('/tmp/comment.md')];
  delete missingDigest.actions[0].bodySha256;
  assert.throws(() => validateTriageDraft(missingDigest), /bodySha256.*SHA-256/i);
});

test('rejects a stale comment precondition before reading or publishing the body', async () => {
  const input = draft();
  input.actions = [commentAction('/unused/in/stale/test.md')];
  const client = createClient(snapshot({ labels: ['decision-needed'] }));

  await assert.rejects(applyTriageDraft(input, { client }), /precondition.*1643/i);
  assert.equal(client.writes, 0);
});

test('rejects comment body files whose reviewed byte size or digest no longer matches', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'triage-comment-digest-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bodyFile = join(directory, 'comment.md');
  const reviewed = commentPayload();
  await writeFile(bodyFile, reviewed.body);
  const input = draft();
  input.actions = [commentAction(bodyFile)];

  validateTriageDraft(input);
  await writeFile(bodyFile, `${reviewed.body.toString('utf8')}tampered after review\n`);

  const client = createClient();
  await assert.rejects(applyTriageDraft(input, { client }), /byte size|sha-?256|digest/i);
  assert.equal(client.writes, 0);
});

test('preflights a later comment body binding before an earlier issue write', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'triage-comment-draft-preflight-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bodyFile = join(directory, 'comment.md');
  const reviewed = commentPayload();
  await writeFile(bodyFile, `${reviewed.body.toString('utf8')}tampered after review\n`);
  const input = draft();
  input.actions.push(
    commentAction(bodyFile, {
      precondition: structuredClone(input.actions[0].desired),
    })
  );
  const client = createClient();

  await assert.rejects(applyTriageDraft(input, { client }), /byte size|sha-?256|digest/i);
  assert.equal(client.writes, 0);
});

test('rejects same-size comment substitutions using the reviewed SHA-256 digest', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'triage-comment-hash-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bodyFile = join(directory, 'comment.md');
  const reviewed = commentPayload();
  const substituted = Buffer.from(reviewed.body);
  substituted[0] ^= 1;
  assert.equal(substituted.byteLength, reviewed.body.byteLength);
  await writeFile(bodyFile, substituted);
  const input = draft();
  input.actions = [commentAction(bodyFile)];
  const client = createClient();

  await assert.rejects(applyTriageDraft(input, { client }), /SHA-256.*reviewed draft/i);
  assert.equal(client.writes, 0);
});

test('rejects a symlink comment body without publishing it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'triage-comment-symlink-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'reviewed.md');
  const bodyFile = join(directory, 'comment.md');
  const reviewed = commentPayload();
  await writeFile(target, reviewed.body);
  await symlink(target, bodyFile);
  const input = draft();
  input.actions = [commentAction(bodyFile)];
  const client = createClient();

  await assert.rejects(applyTriageDraft(input, { client }), /symlink|regular file/i);
  assert.equal(client.writes, 0);
});

test('publishes the single reviewed body read instead of reopening the mutable path', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'triage-comment-stdin-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bodyFile = join(directory, 'comment.md');
  const reviewed = commentPayload();
  await writeFile(bodyFile, reviewed.body);
  const input = draft();
  input.actions = [commentAction(bodyFile)];
  let receivedBody;
  const client = createClient(snapshot(), {
    async onAddComment(body) {
      receivedBody = Buffer.from(body);
      await writeFile(bodyFile, 'changed while publishing\n');
    },
  });

  const result = await applyTriageDraft(input, { client });

  assert.equal(result.applied, 1);
  assert.deepEqual(receivedBody, reviewed.body);
  assert.equal(client.writes, 1);
});

test('requires timestamped evidence, rationale, and resolvable evidence references', () => {
  const noTimestamp = draft();
  delete noTimestamp.evidenceSources[0].observedAt;
  assert.throws(() => validateTriageDraft(noTimestamp), /observedAt/i);

  const noRationale = draft();
  delete noRationale.actions[0].rationale;
  assert.throws(() => validateTriageDraft(noRationale), /rationale/i);

  const missingEvidence = draft();
  missingEvidence.actions[0].evidenceRefs = ['not-observed'];
  assert.throws(() => validateTriageDraft(missingEvidence), /unknown evidence.*not-observed/i);

  const missingReviewTime = draft();
  delete missingReviewTime.reviewedAt;
  assert.throws(() => validateTriageDraft(missingReviewTime), /reviewedAt/i);

  const staleReview = draft();
  staleReview.evidenceSources[0].observedAt = '2026-07-16T00:00:01.000Z';
  assert.throws(() => validateTriageDraft(staleReview), /reviewedAt.*predate/i);
});

test('fails closed for unknown top-level and action fields', () => {
  assert.throws(
    () => validateTriageDraft({ ...draft(), inventedAuthorization: true }),
    /unsupported triage draft field.*inventedAuthorization/i
  );

  const unknownActionField = draft({ executeAnything: true });
  assert.throws(
    () => validateTriageDraft(unknownActionField),
    /unsupported triage action field.*executeAnything/i
  );

  const commentWithDesired = draft();
  commentWithDesired.actions = [
    commentAction('/tmp/comment.md', { desired: snapshot({ labels: ['in-progress'] }) }),
  ];
  assert.throws(
    () => validateTriageDraft(commentWithDesired),
    /unsupported triage action field.*desired/i
  );
});

test('comment idempotency requires the derived strict marker format', () => {
  const input = draft();
  input.actions = [
    commentAction('/tmp/comment.md', {
      idempotencyKey: 'triage-action:issue-1643-comment',
    }),
  ];

  assert.throws(() => validateTriageDraft(input), /idempotency marker.*<!-- triage-action/i);
});

test('exact marker-line matching rejects prefix and substring collisions', () => {
  const marker = triageCommentMarker('issue-1643-comment');
  assert.equal(hasExactMarkerLine(`heading\n${marker}\nbody`, marker), true);
  assert.equal(hasExactMarkerLine(`heading\r\n${marker}\r\nbody`, marker), true);
  assert.equal(hasExactMarkerLine(`prefix ${marker}`, marker), false);
  assert.equal(hasExactMarkerLine(`${marker}-suffix`, marker), false);
  assert.equal(
    hasExactMarkerLine('<!-- triage-action:issue-1643-comment-extra -->', marker),
    false
  );
});
