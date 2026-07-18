#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const APPLY_TRIAGE_DRAFT_USAGE = [
  'Usage:',
  '  node scripts/apply-triage-draft.mjs --draft <path> --repo <owner/repo>',
  '',
  'Options:',
  '  --draft <path>        Reviewed triage draft JSON',
  '  --repo <owner/repo>   Target repository',
  '  --json                Emit JSON summary',
  '  --help                Show this help',
  '',
].join('\n');

const SUPPORTED_ACTIONS = new Set([
  'issue.update',
  'label.ensure',
  'milestone.ensure',
  'issue.comment',
]);
const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion',
  'repository',
  'evidenceJoined',
  'evidenceSources',
  'reviewed',
  'reviewedAt',
  'actions',
]);
const EVIDENCE_SOURCE_FIELDS = new Set(['id', 'kind', 'source', 'observedAt']);
const COMMON_ACTION_FIELDS = ['id', 'kind', 'rationale', 'evidenceRefs'];
const ACTION_FIELDS = {
  'issue.update': new Set([...COMMON_ACTION_FIELDS, 'issue', 'precondition', 'desired']),
  'label.ensure': new Set([...COMMON_ACTION_FIELDS, 'name', 'precondition', 'desired']),
  'milestone.ensure': new Set([...COMMON_ACTION_FIELDS, 'title', 'precondition', 'desired']),
  'issue.comment': new Set([
    ...COMMON_ACTION_FIELDS,
    'issue',
    'precondition',
    'idempotencyKey',
    'bodyFile',
    'bodyBytes',
    'bodySha256',
  ]),
};

function requireNonEmptyString(value, description) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${description} is required.`);
  }
}

function requireIssueNumber(value, description = 'issue number') {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${description} must be a positive integer.`);
  }
}

function assertExactFields(value, allowed, description) {
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new Error(`Unsupported ${description} field: ${unknown.join(', ')}`);
  }
}

function requireIsoTimestamp(value, description) {
  requireNonEmptyString(value, description);
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${description} must be a valid timestamp.`);
  }
}

function normalizeStrings(values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new Error('Issue snapshot labels and assignees must be string arrays.');
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeIssueSnapshot(snapshot, description = 'Issue action') {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error(`${description} requires complete precondition and desired snapshots.`);
  }
  const requiredFields = ['state', 'labels', 'assignees', 'milestoneNumber'];
  if (requiredFields.some((field) => !Object.hasOwn(snapshot, field))) {
    throw new Error(`${description} requires complete precondition and desired snapshots.`);
  }
  const unsupportedFields = Object.keys(snapshot).filter(
    (field) => !requiredFields.includes(field)
  );
  if (unsupportedFields.length > 0) {
    throw new Error(`Unsupported issue snapshot field: ${unsupportedFields.join(', ')}`);
  }
  const state = String(snapshot.state || '').toUpperCase();
  if (!['OPEN', 'CLOSED'].includes(state)) {
    throw new Error('Issue snapshot state must be OPEN or CLOSED.');
  }
  const milestoneNumber = snapshot.milestoneNumber ?? null;
  if (
    milestoneNumber !== null &&
    (!Number.isSafeInteger(milestoneNumber) || milestoneNumber <= 0)
  ) {
    throw new Error('Issue snapshot milestoneNumber must be null or a positive integer.');
  }

  return {
    state,
    labels: normalizeStrings(snapshot.labels),
    assignees: normalizeStrings(snapshot.assignees),
    milestoneNumber,
  };
}

function normalizeLabelMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Label metadata must be an object.');
  }
  assertExactFields(metadata, new Set(['color', 'description']), 'label metadata');
  const color = String(metadata.color || '')
    .replace(/^#/, '')
    .toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(color)) {
    throw new Error('Label color must be a six-digit hexadecimal value.');
  }
  return { color, description: String(metadata.description || '') };
}

function normalizeMilestoneMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Milestone metadata must be an object.');
  }
  assertExactFields(metadata, new Set(['state', 'description', 'dueOn']), 'milestone metadata');
  const state = String(metadata.state || 'open').toLowerCase();
  if (!['open', 'closed'].includes(state)) {
    throw new Error('Milestone state must be open or closed.');
  }
  return {
    state,
    description: String(metadata.description || ''),
    dueOn: metadata.dueOn ? String(metadata.dueOn) : null,
  };
}

function sameValue(left, right) {
  return isDeepStrictEqual(left, right);
}

export function triageCommentMarker(actionId) {
  return `<!-- triage-action:${actionId} -->`;
}

export function hasExactMarkerLine(body, marker) {
  return String(body)
    .split(/\r?\n/)
    .some((line) => line === marker);
}

function validateIssueUpdateAction(action) {
  requireIssueNumber(action.issue);
  normalizeIssueSnapshot(action.precondition);
  normalizeIssueSnapshot(action.desired);
}

function validateLabelAction(action) {
  requireNonEmptyString(action.name, 'Label name');
  if (!Object.hasOwn(action, 'precondition')) {
    throw new Error('Label ensure action requires an explicit precondition.');
  }
  normalizeLabelMetadata(action.desired);
  if (action.precondition !== null) {
    normalizeLabelMetadata(action.precondition);
  }
}

function validateMilestoneAction(action) {
  requireNonEmptyString(action.title, 'Milestone title');
  if (!Object.hasOwn(action, 'precondition')) {
    throw new Error('Milestone ensure action requires an explicit precondition.');
  }
  normalizeMilestoneMetadata(action.desired);
  if (action.precondition !== null) {
    normalizeMilestoneMetadata(action.precondition);
  }
}

function validateCommentAction(action) {
  requireIssueNumber(action.issue);
  normalizeIssueSnapshot(action.precondition, 'Comment action');
  requireNonEmptyString(action.idempotencyKey, 'Comment idempotency key');
  requireNonEmptyString(action.bodyFile, 'Comment body file');
  if (!Number.isSafeInteger(action.bodyBytes) || action.bodyBytes <= 0) {
    throw new Error('Comment bodyBytes must be a positive integer.');
  }
  if (typeof action.bodySha256 !== 'string' || !/^[0-9a-f]{64}$/.test(action.bodySha256)) {
    throw new Error('Comment bodySha256 must be a lowercase SHA-256 digest.');
  }
  const expectedMarker = triageCommentMarker(action.id);
  if (action.idempotencyKey !== expectedMarker) {
    throw new Error(`Comment idempotency marker must equal ${expectedMarker}`);
  }
}

const ACTION_VALIDATORS = {
  'issue.update': validateIssueUpdateAction,
  'label.ensure': validateLabelAction,
  'milestone.ensure': validateMilestoneAction,
  'issue.comment': validateCommentAction,
};

function validateAction(action, seenIds, evidenceIds) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    throw new Error('Every triage action must be an object.');
  }
  requireNonEmptyString(action.id, 'Action id');
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(action.id)) {
    throw new Error('Action id must use lowercase letters, digits, dot, underscore, or hyphen.');
  }
  if (seenIds.has(action.id)) {
    throw new Error(`Duplicate action id: ${action.id}`);
  }
  seenIds.add(action.id);

  if (!SUPPORTED_ACTIONS.has(action.kind)) {
    throw new Error(`Unsupported triage action: ${String(action.kind)}`);
  }
  assertExactFields(action, ACTION_FIELDS[action.kind], 'triage action');
  requireNonEmptyString(action.rationale, 'Action rationale');
  if (
    !Array.isArray(action.evidenceRefs) ||
    action.evidenceRefs.length === 0 ||
    action.evidenceRefs.some((reference) => typeof reference !== 'string' || !reference)
  ) {
    throw new Error('Action evidenceRefs must be a non-empty string array.');
  }
  if (new Set(action.evidenceRefs).size !== action.evidenceRefs.length) {
    throw new Error(`Action ${action.id} contains duplicate evidence references.`);
  }
  const missingEvidence = action.evidenceRefs.filter((reference) => !evidenceIds.has(reference));
  if (missingEvidence.length > 0) {
    throw new Error(
      `Action ${action.id} references unknown evidence: ${missingEvidence.join(', ')}`
    );
  }
  ACTION_VALIDATORS[action.kind](action);
}

function validateEvidenceSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('Triage draft evidenceSources must be a non-empty array.');
  }
  const evidenceIds = new Set();
  let latestObservedAt = Number.NEGATIVE_INFINITY;
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('Every evidence source must be an object.');
    }
    assertExactFields(source, EVIDENCE_SOURCE_FIELDS, 'evidence source');
    requireNonEmptyString(source.id, 'Evidence source id');
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(source.id)) {
      throw new Error(
        'Evidence source id must use lowercase letters, digits, dot, underscore, or hyphen.'
      );
    }
    requireNonEmptyString(source.kind, 'Evidence source kind');
    requireNonEmptyString(source.source, 'Evidence source URI');
    requireIsoTimestamp(source.observedAt, 'Evidence source observedAt');
    if (evidenceIds.has(source.id)) {
      throw new Error(`Duplicate evidence source id: ${source.id}`);
    }
    evidenceIds.add(source.id);
    latestObservedAt = Math.max(latestObservedAt, Date.parse(source.observedAt));
  }
  return { evidenceIds, latestObservedAt };
}

function validateIssueActionSequence(actions) {
  const expectedSnapshots = new Map();
  for (const action of actions) {
    if (!['issue.update', 'issue.comment'].includes(action.kind)) continue;
    const precondition = normalizeIssueSnapshot(action.precondition);
    const expected = expectedSnapshots.get(action.issue);
    if (expected && !sameValue(precondition, expected)) {
      throw new Error(
        `Issue action sequence has a stale precondition for issue ${action.issue}; order comments before updates that share the same observed snapshot, or bind the action to the preceding desired state.`
      );
    }
    if (!expected) expectedSnapshots.set(action.issue, precondition);
    if (action.kind === 'issue.update') {
      expectedSnapshots.set(action.issue, normalizeIssueSnapshot(action.desired));
    }
  }
}

export function validateTriageDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw new Error('Triage draft must be a JSON object.');
  }
  assertExactFields(draft, TOP_LEVEL_FIELDS, 'triage draft');
  if (draft.schemaVersion !== 1) {
    throw new Error('Unsupported triage draft schemaVersion.');
  }
  requireNonEmptyString(draft.repository, 'Draft repository');
  if (!/^[^/\s]+\/[^/\s]+$/.test(draft.repository)) {
    throw new Error('Draft repository must use owner/repo form.');
  }
  if (draft.evidenceJoined !== true) {
    throw new Error('Triage draft requires a completed evidence join.');
  }
  if (draft.reviewed !== true) {
    throw new Error('Triage draft must be explicitly reviewed before mutation.');
  }
  requireIsoTimestamp(draft.reviewedAt, 'Draft reviewedAt');
  if (!Array.isArray(draft.actions)) {
    throw new Error('Triage draft actions must be an array.');
  }

  const { evidenceIds, latestObservedAt } = validateEvidenceSources(draft.evidenceSources);
  if (Date.parse(draft.reviewedAt) < latestObservedAt) {
    throw new Error('Draft reviewedAt cannot predate its newest evidence source.');
  }
  const seenIds = new Set();
  for (const action of draft.actions) {
    validateAction(action, seenIds, evidenceIds);
  }
  validateIssueActionSequence(draft.actions);
  return draft;
}

async function applyIssueUpdate(action, client) {
  const current = normalizeIssueSnapshot(await client.readIssue(action.issue));
  const desired = normalizeIssueSnapshot(action.desired);
  if (sameValue(current, desired)) {
    return 'skipped';
  }

  const precondition = normalizeIssueSnapshot(action.precondition);
  if (!sameValue(current, precondition)) {
    throw new Error(`Precondition failed for issue ${action.issue}; refusing stale mutation.`);
  }

  await client.updateIssue(action.issue, desired, current);
  const readback = normalizeIssueSnapshot(await client.readIssue(action.issue));
  if (!sameValue(readback, desired)) {
    throw new Error(`Direct readback failed for issue ${action.issue}.`);
  }
  return 'applied';
}

async function applyLabelEnsure(action, client) {
  const observed = await client.readLabel(action.name);
  const current = observed === null ? null : normalizeLabelMetadata(observed);
  const desired = normalizeLabelMetadata(action.desired);
  if (sameValue(current, desired)) {
    return 'skipped';
  }
  const precondition =
    action.precondition === null ? null : normalizeLabelMetadata(action.precondition);
  if (!sameValue(current, precondition)) {
    throw new Error(`Precondition failed for label ${action.name}.`);
  }
  await client.ensureLabel(action.name, desired, current);
  const observedReadback = await client.readLabel(action.name);
  const readback = observedReadback === null ? null : normalizeLabelMetadata(observedReadback);
  if (!sameValue(readback, desired)) {
    throw new Error(`Direct readback failed for label ${action.name}.`);
  }
  return 'applied';
}

async function applyMilestoneEnsure(action, client) {
  const observed = await client.readMilestone(action.title);
  const current = observed === null ? null : normalizeMilestoneMetadata(observed);
  const desired = normalizeMilestoneMetadata(action.desired);
  if (sameValue(current, desired)) {
    return 'skipped';
  }
  const precondition =
    action.precondition === null ? null : normalizeMilestoneMetadata(action.precondition);
  if (!sameValue(current, precondition)) {
    throw new Error(`Precondition failed for milestone ${action.title}.`);
  }
  await client.ensureMilestone(action.title, desired, current);
  const observedReadback = await client.readMilestone(action.title);
  const readback = observedReadback === null ? null : normalizeMilestoneMetadata(observedReadback);
  if (!sameValue(readback, desired)) {
    throw new Error(`Direct readback failed for milestone ${action.title}.`);
  }
  return 'applied';
}

async function readBoundCommentBody(action) {
  const pathStat = await lstat(action.bodyFile);
  if (pathStat.isSymbolicLink()) {
    throw new Error(`Comment body file must not be a symlink: ${action.bodyFile}`);
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(action.bodyFile, constants.O_RDONLY | noFollow);
  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) {
      throw new Error(`Comment body file must be a regular file: ${action.bodyFile}`);
    }
    if (openedStat.size !== action.bodyBytes) {
      throw new Error(
        `Comment body byte size does not match the reviewed draft for action ${action.id}.`
      );
    }

    const body = await handle.readFile();
    if (body.byteLength !== action.bodyBytes) {
      throw new Error(
        `Comment body byte size changed while reading the reviewed payload for action ${action.id}.`
      );
    }
    const digest = createHash('sha256').update(body).digest('hex');
    if (digest !== action.bodySha256) {
      throw new Error(
        `Comment body SHA-256 does not match the reviewed draft for action ${action.id}.`
      );
    }

    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      throw new Error(`Comment body must be valid UTF-8 for action ${action.id}.`);
    }
    if (!hasExactMarkerLine(text, action.idempotencyKey)) {
      throw new Error('Comment body file must contain its exact idempotency marker line.');
    }
    return body;
  } finally {
    await handle.close();
  }
}

function createPreflightState() {
  return {
    issues: new Map(),
    labels: new Map(),
    milestones: new Map(),
  };
}

async function preflightIssueState(issue, state, client) {
  if (!state.issues.has(issue)) {
    state.issues.set(issue, normalizeIssueSnapshot(await client.readIssue(issue)));
  }
  return state.issues.get(issue);
}

async function preflightLabelState(name, state, client) {
  if (!state.labels.has(name)) {
    const observed = await client.readLabel(name);
    state.labels.set(name, observed === null ? null : normalizeLabelMetadata(observed));
  }
  return state.labels.get(name);
}

async function preflightMilestoneState(title, state, client) {
  if (!state.milestones.has(title)) {
    const observed = await client.readMilestone(title);
    state.milestones.set(title, observed === null ? null : normalizeMilestoneMetadata(observed));
  }
  return state.milestones.get(title);
}

async function preflightIssueUpdate(action, state, client) {
  const current = await preflightIssueState(action.issue, state, client);
  const desired = normalizeIssueSnapshot(action.desired);
  if (sameValue(current, desired)) return { action };

  const precondition = normalizeIssueSnapshot(action.precondition);
  if (!sameValue(current, precondition)) {
    throw new Error(`Precondition failed for issue ${action.issue}; refusing stale mutation.`);
  }
  state.issues.set(action.issue, desired);
  return { action };
}

async function preflightLabelEnsure(action, state, client) {
  const current = await preflightLabelState(action.name, state, client);
  const desired = normalizeLabelMetadata(action.desired);
  if (sameValue(current, desired)) return { action };

  const precondition =
    action.precondition === null ? null : normalizeLabelMetadata(action.precondition);
  if (!sameValue(current, precondition)) {
    throw new Error(`Precondition failed for label ${action.name}.`);
  }
  state.labels.set(action.name, desired);
  return { action };
}

async function preflightMilestoneEnsure(action, state, client) {
  const current = await preflightMilestoneState(action.title, state, client);
  const desired = normalizeMilestoneMetadata(action.desired);
  if (sameValue(current, desired)) return { action };

  const precondition =
    action.precondition === null ? null : normalizeMilestoneMetadata(action.precondition);
  if (!sameValue(current, precondition)) {
    throw new Error(`Precondition failed for milestone ${action.title}.`);
  }
  state.milestones.set(action.title, desired);
  return { action };
}

async function preflightIssueComment(action, state, client) {
  if (await client.hasComment(action.issue, action.idempotencyKey)) {
    return { action, commentBody: null };
  }

  const current = await preflightIssueState(action.issue, state, client);
  const precondition = normalizeIssueSnapshot(action.precondition, 'Comment action');
  if (!sameValue(current, precondition)) {
    throw new Error(
      `Precondition failed for issue ${action.issue}; refusing stale comment mutation.`
    );
  }
  return { action, commentBody: await readBoundCommentBody(action) };
}

const PREFLIGHT_ACTIONS = {
  'issue.update': preflightIssueUpdate,
  'label.ensure': preflightLabelEnsure,
  'milestone.ensure': preflightMilestoneEnsure,
  'issue.comment': preflightIssueComment,
};

async function preflightTriageActions(actions, client) {
  const state = createPreflightState();
  const plan = [];
  for (const action of actions) {
    plan.push(await PREFLIGHT_ACTIONS[action.kind](action, state, client));
  }
  return plan;
}

async function applyIssueComment(action, client, commentBody) {
  if (await client.hasComment(action.issue, action.idempotencyKey)) {
    return 'skipped';
  }

  if (commentBody === null) {
    throw new Error(
      `Comment ${action.id} disappeared after preflight; refusing an unbound mutation.`
    );
  }

  const current = normalizeIssueSnapshot(await client.readIssue(action.issue));
  const precondition = normalizeIssueSnapshot(action.precondition, 'Comment action');
  if (!sameValue(current, precondition)) {
    throw new Error(
      `Precondition failed for issue ${action.issue}; refusing stale comment mutation.`
    );
  }

  await client.addComment(action.issue, commentBody, action.idempotencyKey);
  if (!(await client.hasComment(action.issue, action.idempotencyKey))) {
    throw new Error(`Direct readback failed for issue comment ${action.id}.`);
  }
  return 'applied';
}

export async function applyTriageDraft(draft, { client } = {}) {
  validateTriageDraft(draft);
  if (!client) {
    throw new Error('A mutation client is required.');
  }

  const plan = await preflightTriageActions(draft.actions, client);
  const summary = { applied: 0, skipped: 0, failed: 0, actions: [] };
  for (const { action, commentBody } of plan) {
    let status;
    if (action.kind === 'issue.update') {
      status = await applyIssueUpdate(action, client);
    } else if (action.kind === 'label.ensure') {
      status = await applyLabelEnsure(action, client);
    } else if (action.kind === 'milestone.ensure') {
      status = await applyMilestoneEnsure(action, client);
    } else {
      status = await applyIssueComment(action, client, commentBody);
    }
    summary[status] += 1;
    summary.actions.push({ id: action.id, kind: action.kind, status });
  }
  return summary;
}

function gh(repo, args, { input } = {}) {
  const commandArguments = args[0] === 'api' ? args : [...args, '--repo', repo];
  const result = spawnSync('gh', commandArguments, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error('GitHub CLI command failed without applying a verified mutation.');
  }
  return result.stdout || '';
}

function parseJson(text, description) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Could not parse ${description} readback.`);
  }
}

function createGitHubClient(repo) {
  const apiRoot = `repos/${repo}`;
  return {
    async readIssue(issue) {
      const value = parseJson(
        gh(repo, ['issue', 'view', String(issue), '--json', 'state,labels,assignees,milestone']),
        'issue'
      );
      return {
        state: value.state,
        labels: (value.labels || []).map(({ name }) => name),
        assignees: (value.assignees || []).map(({ login }) => login),
        milestoneNumber: value.milestone?.number ?? null,
      };
    },
    async updateIssue(issue, desired) {
      gh(repo, ['api', '--method', 'PATCH', `${apiRoot}/issues/${issue}`, '--input', '-'], {
        input: JSON.stringify({
          state: desired.state.toLowerCase(),
          labels: desired.labels,
          assignees: desired.assignees,
          milestone: desired.milestoneNumber,
        }),
      });
    },
    async readLabel(name) {
      const labels = parseJson(
        gh(repo, ['label', 'list', '--limit', '1000', '--json', 'name,color,description']),
        'labels'
      );
      const label = labels.find((item) => item.name === name);
      return label ? { color: label.color, description: label.description || '' } : null;
    },
    async ensureLabel(name, desired, current) {
      if (current) {
        gh(repo, [
          'label',
          'edit',
          name,
          '--color',
          desired.color,
          '--description',
          desired.description || '',
        ]);
      } else {
        gh(repo, [
          'label',
          'create',
          name,
          '--color',
          desired.color,
          '--description',
          desired.description || '',
        ]);
      }
    },
    async readMilestone(title) {
      const milestones = parseJson(
        gh(repo, ['api', '--paginate', '--slurp', `${apiRoot}/milestones?state=all&per_page=100`]),
        'milestones'
      );
      const milestone = milestones.flat(1).find((item) => item.title === title);
      return milestone
        ? {
            state: milestone.state,
            description: milestone.description || '',
            dueOn: milestone.due_on || null,
          }
        : null;
    },
    async ensureMilestone(title, desired, current) {
      const payload = JSON.stringify({
        title,
        state: desired.state,
        description: desired.description,
        due_on: desired.dueOn,
      });
      if (current) {
        const milestones = parseJson(
          gh(repo, [
            'api',
            '--paginate',
            '--slurp',
            `${apiRoot}/milestones?state=all&per_page=100`,
          ]),
          'milestones'
        ).flat(1);
        const number = milestones.find((item) => item.title === title)?.number;
        if (!number) {
          throw new Error(`Milestone disappeared before mutation: ${title}`);
        }
        gh(repo, ['api', '--method', 'PATCH', `${apiRoot}/milestones/${number}`, '--input', '-'], {
          input: payload,
        });
      } else {
        gh(repo, ['api', '--method', 'POST', `${apiRoot}/milestones`, '--input', '-'], {
          input: payload,
        });
      }
    },
    async hasComment(issue, key) {
      const pages = parseJson(
        gh(repo, [
          'api',
          '--paginate',
          '--slurp',
          `${apiRoot}/issues/${issue}/comments?per_page=100`,
        ]),
        'comments'
      );
      return pages.flat(1).some(({ body }) => hasExactMarkerLine(body, key));
    },
    async addComment(issue, body, idempotencyKey) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
      if (!hasExactMarkerLine(text, idempotencyKey)) {
        throw new Error('Comment body file must contain its exact idempotency marker line.');
      }
      gh(repo, ['issue', 'comment', String(issue), '--body-file', '-'], { input: body });
    },
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--json') {
      continue;
    }
    const field =
      argv[index] === '--draft' ? 'draftPath' : argv[index] === '--repo' ? 'repo' : null;
    if (!field || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    }
    options[field] = argv[index + 1];
    index += 1;
  }
  requireNonEmptyString(options.draftPath, '--draft');
  requireNonEmptyString(options.repo, '--repo');
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write(APPLY_TRIAGE_DRAFT_USAGE);
    return 0;
  }
  const { draftPath, repo } = parseArguments(argv);
  const draft = JSON.parse(await readFile(draftPath, 'utf8'));
  validateTriageDraft(draft);
  if (draft.repository !== repo) {
    throw new Error('Draft repository does not match --repo.');
  }
  const result = await applyTriageDraft(draft, { client: createGitHubClient(repo) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
