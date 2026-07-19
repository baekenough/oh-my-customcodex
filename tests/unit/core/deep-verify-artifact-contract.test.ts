import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { renameSync, rmSync, symlinkSync } from 'node:fs';
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import {
  selectArtifact,
  serializeArtifact,
  validateArtifactContent,
  validateArtifactFile,
  writeArtifact,
} from '../../../.codex/skills/deep-verify/scripts/artifact-contract.mjs';
import { install } from '../../../src/core/installer.js';

const ROOT = resolve(import.meta.dir, '../../..');
const HELPER = join(ROOT, '.codex/skills/deep-verify/scripts/artifact-contract.mjs');
const TEMPLATE_HELPER = join(
  ROOT,
  'templates/.claude/skills/deep-verify/scripts/artifact-contract.mjs'
);
const SKILL = join(ROOT, '.codex/skills/deep-verify/SKILL.md');
const TEMPLATE_SKILL = join(ROOT, 'templates/.claude/skills/deep-verify/SKILL.md');
const PLUGIN_SKILL = join(ROOT, 'plugins/oh-my-customcodex/skills/deep-verify/SKILL.md');
const POST_RELEASE = join(ROOT, '.codex/skills/post-release-followup/SKILL.md');
const TEMPLATE_POST_RELEASE = join(ROOT, 'templates/.claude/skills/post-release-followup/SKILL.md');
const HARDCODED_SOURCE_HELPER = '.codex/skills/deep-verify/scripts/artifact-contract.mjs';

type FindingBucket = 'initial' | 'falsePositives' | 'fixed' | 'unresolved';

function finding(id: string, severity = 'MEDIUM') {
  return {
    id,
    severity,
    file: 'src/example.ts',
    line: 12,
    summary: `finding ${id}`,
    evidence: `test evidence for ${id}`,
  };
}

function outcome(findingId: string, reason: string) {
  return {
    findingId,
    reason,
    evidence: `terminal evidence for ${findingId}`,
  };
}

function artifact(overrides: Record<string, unknown> = {}) {
  const initial = finding('DV-001');
  const fixed = outcome('DV-001', 'fixed and verified');

  return {
    schemaVersion: 1,
    skill: 'deep-verify',
    date: '2026-07-19T01:23:45+09:00',
    query: 'release/v1.0.28',
    repository: 'baekenough/oh-my-customcodex',
    releaseVersion: '1.0.28',
    verifiedSha: 'a'.repeat(40),
    executionMode: 'standard',
    verdict: 'READY',
    findings: {
      initial: [initial],
      falsePositives: [],
      fixed: [fixed],
      unresolved: [],
    },
    verificationEvidence: [
      { gate: 'focused tests', outcome: 'pass', reference: 'bun test: 12 pass, 0 fail' },
      { gate: 'manual release readback', outcome: 'not-run', reference: 'pre-release stage' },
    ],
    ...overrides,
  };
}

function rawArtifact(
  data: Record<string, unknown>,
  counts?: Partial<Record<FindingBucket, number>>
) {
  const findings = data.findings as Record<FindingBucket, unknown[]>;
  const marker = {
    initial: findings.initial.length,
    falsePositives: findings.falsePositives.length,
    fixed: findings.fixed.length,
    unresolved: findings.unresolved.length,
    ...counts,
  };
  return `---\n${JSON.stringify(data, null, 2)}\n---\n# Deep Verification Report\n\n<!-- deep-verify-counts:${JSON.stringify(marker)} -->\n`;
}

async function putCandidate(
  root: string,
  day: string,
  name: string,
  content: string
): Promise<string> {
  const path = join(root, '.codex/outputs/sessions', day, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { mode: 0o600 });
  return path;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function treeEntries(root: string, prefix = ''): Promise<string[]> {
  const entries: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relativePath = prefix.length === 0 ? entry.name : join(prefix, entry.name);
    entries.push(relativePath);
    if (entry.isDirectory()) {
      entries.push(...(await treeEntries(join(root, entry.name), relativePath)));
    }
  }
  return entries.sort();
}

describe('deep-verify artifact contract', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'omcodex-deep-verify-artifact-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('keeps source and install-mirror helper and skill contracts byte-identical', async () => {
    expect(await readFile(TEMPLATE_HELPER, 'utf8')).toBe(await readFile(HELPER, 'utf8'));
    const sourceSkill = await readFile(SKILL, 'utf8');
    expect(await readFile(TEMPLATE_SKILL, 'utf8')).toBe(sourceSkill);
    expect(await readFile(PLUGIN_SKILL, 'utf8')).toBe(sourceSkill);
    expect(sourceSkill).toContain(
      'The caller-supplied Markdown `body` must not contain any `<!-- deep-verify-counts:... -->` marker.'
    );
    expect(sourceSkill).toContain(
      'The helper appends exactly one count marker from the validated structured findings.'
    );
    expect(sourceSkill).toContain(
      'A caller-supplied structured marker fails closed with `artifact body already contains a structured count marker`.'
    );
    expect(await readFile(TEMPLATE_POST_RELEASE, 'utf8')).toBe(
      await readFile(POST_RELEASE, 'utf8')
    );
  });

  it('accepts one stable finding id in initial and exactly one terminal bucket', () => {
    const validated = validateArtifactContent(serializeArtifact(artifact(), '# Human report'));
    expect(validated.findings.initial[0]?.id).toBe('DV-001');
    expect(validated.findings.fixed[0]?.findingId).toBe('DV-001');
  });

  it('owns count-marker generation and rejects a caller-supplied marker with a stable diagnostic', async () => {
    const written = await writeArtifact({
      projectRoot,
      artifact: artifact(),
      body: '# Marker-free caller report',
    });
    const serialized = await readFile(written.path, 'utf8');
    const markers = serialized.match(/<!-- deep-verify-counts:[^\r\n]* -->/g) ?? [];

    expect(markers).toEqual([
      '<!-- deep-verify-counts:{"initial":1,"falsePositives":0,"fixed":1,"unresolved":0} -->',
    ]);
    await expect(
      writeArtifact({
        projectRoot,
        artifact: artifact({ date: '2026-07-19T01:23:46+09:00' }),
        body: '# Caller-owned marker is forbidden\n\n<!-- deep-verify-counts:{"initial":1,"falsePositives":0,"fixed":1,"unresolved":0} -->',
      })
    ).rejects.toThrow('artifact body already contains a structured count marker');
  });

  it('rejects duplicate ids within a bucket and across terminal buckets without rejecting lifecycle ids', () => {
    const duplicateInitial = artifact();
    (duplicateInitial.findings as Record<FindingBucket, unknown[]>).initial.push(finding('DV-001'));
    expect(() => serializeArtifact(duplicateInitial, '# Duplicate initial')).toThrow(
      /finding lifecycle/i
    );

    const duplicateTerminal = artifact();
    (duplicateTerminal.findings as Record<FindingBucket, unknown[]>).unresolved.push(
      outcome('DV-001', 'still unresolved')
    );
    expect(() => serializeArtifact(duplicateTerminal, '# Duplicate terminal')).toThrow(
      /finding lifecycle/i
    );
  });

  it('rejects missing terminal findings, orphan terminal findings, duplicate required keys, and body count mismatch', () => {
    const missingTerminal = artifact({
      findings: {
        initial: [finding('DV-001')],
        falsePositives: [],
        fixed: [],
        unresolved: [],
      },
    });
    expect(() => serializeArtifact(missingTerminal, '# Missing terminal')).toThrow(
      /finding lifecycle/i
    );

    const orphanTerminal = artifact({
      findings: {
        initial: [finding('DV-001')],
        falsePositives: [],
        fixed: [outcome('DV-002', 'fixed')],
        unresolved: [outcome('DV-001', 'unresolved')],
      },
    });
    expect(() => serializeArtifact(orphanTerminal, '# Orphan terminal')).toThrow(
      /finding lifecycle/i
    );

    const valid = rawArtifact(artifact());
    const duplicateRequired = valid.replace(
      '"schemaVersion": 1,',
      '"schemaVersion": 1,\n  "schemaVersion": 1,'
    );
    expect(() => validateArtifactContent(duplicateRequired)).toThrow(/duplicate required field/i);

    expect(() => validateArtifactContent(rawArtifact(artifact(), { fixed: 0 }))).toThrow(
      /body count mismatch/i
    );
  });

  it('rejects malformed metadata, unsafe evidence, and ambiguous verification outcomes', () => {
    for (const [field, value] of [
      ['schemaVersion', 2],
      ['date', 'July 19'],
      ['releaseVersion', 'latest'],
      ['verifiedSha', 'abc123'],
      ['skill', 'other-skill'],
      ['verdict', 'MAYBE'],
      ['executionMode', 'mystery-mode'],
    ] as const) {
      expect(() => serializeArtifact(artifact({ [field]: value }), '# Invalid metadata')).toThrow();
    }

    const missingRepository = artifact();
    delete (missingRepository as Record<string, unknown>).repository;
    expect(() => serializeArtifact(missingRepository, '# Missing metadata')).toThrow(
      /artifact has invalid fields/i
    );

    expect(() =>
      validateArtifactContent(
        '---\nschemaVersion: 1\nskill: deep-verify\n---\n# Free-form YAML is forbidden\n'
      )
    ).toThrow(/frontmatter is malformed/i);

    expect(() =>
      serializeArtifact(
        artifact({
          verificationEvidence: [
            { gate: 'publish', outcome: 'pending', reference: 'not clear whether this ran' },
          ],
        }),
        '# Ambiguous evidence'
      )
    ).toThrow(/verification evidence/i);

    expect(() =>
      serializeArtifact(
        artifact({
          verificationEvidence: [
            { gate: 'publish', outcome: 'pass', reference: `github_pat_${'A'.repeat(82)}` },
          ],
        }),
        '# Secret-bearing evidence'
      )
    ).toThrow(/sensitive/i);

    expect(() =>
      serializeArtifact(artifact({ verificationEvidence: [] }), '# Missing gate evidence')
    ).toThrow(/verification evidence/i);
  });

  it('writes through a same-directory exclusive temporary file, refuses collisions, and reads back a regular singleton', async () => {
    const result = await writeArtifact({
      projectRoot,
      artifact: artifact(),
      body: '# Human report',
    });

    expect(relative(projectRoot, result.path)).toBe(
      '.codex/outputs/sessions/2026-07-19/deep-verify-012345.md'
    );
    const info = await lstat(result.path);
    expect(info.isFile()).toBe(true);
    expect(info.isSymbolicLink()).toBe(false);
    expect(info.nlink).toBe(1);
    expect((await validateArtifactFile(result.path)).verifiedSha).toBe('a'.repeat(40));

    await expect(
      writeArtifact({ projectRoot, artifact: artifact(), body: '# Must not overwrite' })
    ).rejects.toThrow(/already exists/i);
    expect(await readFile(result.path, 'utf8')).toContain('# Human report');
  });

  it('restores the caller cwd after successful and fail-closed write and select paths', async () => {
    const originalCwd = process.cwd();
    const written = await writeArtifact({
      projectRoot,
      artifact: artifact({ date: '2026-07-19T01:24:00+09:00' }),
      body: '# Cwd restoration',
    });
    expect(process.cwd()).toBe(originalCwd);

    const selector = {
      projectRoot,
      repository: 'baekenough/oh-my-customcodex',
      releaseVersion: '1.0.28',
      verifiedSha: 'a'.repeat(40),
    };
    expect((await selectArtifact(selector)).path).toBe(written.path);
    expect(process.cwd()).toBe(originalCwd);

    await expect(
      writeArtifact({
        projectRoot,
        artifact: artifact({ date: '2026-07-19T01:24:00+09:00' }),
        body: '# Collision',
      })
    ).rejects.toThrow(/already exists/i);
    expect(process.cwd()).toBe(originalCwd);

    await expect(selectArtifact({ ...selector, verifiedSha: 'b'.repeat(40) })).rejects.toThrow(
      /no matching/i
    );
    expect(process.cwd()).toBe(originalCwd);
  });

  it('persists and validates both clean and blocked completed executions', async () => {
    const clean = artifact({
      date: '2026-07-19T03:00:00+09:00',
      verdict: 'READY',
      findings: { initial: [], falsePositives: [], fixed: [], unresolved: [] },
    });
    const cleanResult = await writeArtifact({
      projectRoot,
      artifact: clean,
      body: '# Clean verification',
    });
    expect((await validateArtifactFile(cleanResult.path)).verdict).toBe('READY');

    const blocked = artifact({
      date: '2026-07-19T04:00:00+09:00',
      verdict: 'BLOCKED',
      findings: {
        initial: [finding('DV-002', 'HIGH')],
        falsePositives: [],
        fixed: [],
        unresolved: [outcome('DV-002', 'release gate remains red')],
      },
    });
    const blockedResult = await writeArtifact({
      projectRoot,
      artifact: blocked,
      body: '# Blocked verification',
    });
    expect((await validateArtifactFile(blockedResult.path)).findings.unresolved).toEqual([
      outcome('DV-002', 'release gate remains red'),
    ]);
  });

  it('refuses symlinked output components and hard-linked artifacts', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'omcodex-deep-verify-outside-'));
    try {
      await mkdir(join(projectRoot, '.codex/outputs'), { recursive: true });
      await symlink(outside, join(projectRoot, '.codex/outputs/sessions'));
      await expect(
        writeArtifact({ projectRoot, artifact: artifact(), body: '# Symlink escape' })
      ).rejects.toThrow(/symlink|directory/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }

    const cleanRoot = await mkdtemp(join(tmpdir(), 'omcodex-deep-verify-hardlink-'));
    try {
      const written = await writeArtifact({
        projectRoot: cleanRoot,
        artifact: artifact(),
        body: '# Hard link fixture',
      });
      const hardLink = `${written.path}.copy`;
      const linked = spawnSync('ln', [written.path, hardLink]);
      expect(linked.status).toBe(0);
      await expect(validateArtifactFile(written.path)).rejects.toThrow(/hard-linked/i);
    } finally {
      await rm(cleanRoot, { recursive: true, force: true });
    }
  });

  it('rejects same-inode mutation, bounded-read growth, and path replacement during fd readback', async () => {
    const mutation = await writeArtifact({
      projectRoot,
      artifact: artifact({ date: '2026-07-19T01:30:00+09:00' }),
      body: '# Human report',
    });
    const mutationBytes = await readFile(mutation.path, 'utf8');
    await expect(
      validateArtifactFile(mutation.path, {
        afterOpen: async () => {
          await writeFile(mutation.path, mutationBytes.replace('Human', 'Mutat'));
        },
      })
    ).rejects.toThrow(/changed|fingerprint|exact/i);

    const growth = await writeArtifact({
      projectRoot,
      artifact: artifact({ date: '2026-07-19T01:31:00+09:00' }),
      body: '# Growth report',
    });
    await expect(
      validateArtifactFile(growth.path, {
        afterOpen: async () => {
          await appendFile(growth.path, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
        },
      })
    ).rejects.toThrow(/size|limit|changed/i);

    const replacement = await writeArtifact({
      projectRoot,
      artifact: artifact({ date: '2026-07-19T01:32:00+09:00' }),
      body: '# Replacement report',
    });
    const replacementBytes = await readFile(replacement.path);
    await expect(
      validateArtifactFile(replacement.path, {
        afterRead: async () => {
          const next = `${replacement.path}.next`;
          await writeFile(next, replacementBytes);
          await rename(next, replacement.path);
        },
      })
    ).rejects.toThrow(/changed|fingerprint|inode|hard-linked/i);
  });

  it('uses nonblocking pre-lstat rejection for FIFO candidates', async () => {
    const fifo = join(projectRoot, 'artifact.fifo');
    const made = spawnSync('mkfifo', [fifo]);
    expect(made.status, made.stderr?.toString()).toBe(0);
    const started = Date.now();
    const result = spawnSync(process.execPath, [HELPER, 'validate', '--file', fifo], {
      encoding: 'utf8',
      timeout: 500,
    });
    expect(result.error?.code).not.toBe('ETIMEDOUT');
    expect(result.status).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(450);
  });

  it('verifies staged and published bytes are exactly the serialized artifact', async () => {
    await expect(
      writeArtifact({
        projectRoot,
        artifact: artifact({ date: '2026-07-19T01:33:00+09:00' }),
        body: '# Stage tamper report',
        dependencies: {
          afterStageSync: async ({ temporaryPath }: { temporaryPath: string }) => {
            await writeFile(temporaryPath, 'tampered staged bytes');
          },
        },
      })
    ).rejects.toThrow(/exact|changed|frontmatter/i);

    await expect(
      writeArtifact({
        projectRoot,
        artifact: artifact({ date: '2026-07-19T01:34:00+09:00' }),
        body: '# Published tamper report',
        dependencies: {
          afterPublish: async ({ finalPath }: { finalPath: string }) => {
            await writeFile(finalPath, 'tampered published bytes');
          },
        },
      })
    ).rejects.toThrow(/exact|changed|frontmatter/i);

    let stagedReplacement = '';
    await expect(
      writeArtifact({
        projectRoot,
        artifact: artifact({ date: '2026-07-19T01:36:00+09:00' }),
        body: '# Staged inode replacement',
        dependencies: {
          afterStageSync: async ({ temporaryPath }: { temporaryPath: string }) => {
            const bytes = await readFile(temporaryPath);
            const original = `${temporaryPath}.original`;
            await rename(temporaryPath, original);
            await writeFile(temporaryPath, bytes);
            stagedReplacement = resolve(temporaryPath);
          },
        },
      })
    ).rejects.toThrow(/inode|identity/i);
    expect(await lstat(stagedReplacement)).toBeTruthy();

    let publishedReplacement = '';
    await expect(
      writeArtifact({
        projectRoot,
        artifact: artifact({ date: '2026-07-19T01:37:00+09:00' }),
        body: '# Published inode replacement',
        dependencies: {
          afterPublish: async ({ finalPath }: { finalPath: string }) => {
            const bytes = await readFile(finalPath);
            const original = `${finalPath}.original`;
            await rename(finalPath, original);
            await writeFile(finalPath, bytes);
            publishedReplacement = resolve(finalPath);
          },
        },
      })
    ).rejects.toThrow(/inode|identity/i);
    expect(await lstat(publishedReplacement)).toBeTruthy();
  });

  it('removes the exact published inode when its pinned date directory is moved outside', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'omcodex-deep-verify-moved-day-'));
    const dayPath = join(projectRoot, '.codex/outputs/sessions/2026-07-19');
    const movedDay = join(outside, 'moved-day');
    const originalCwd = process.cwd();
    try {
      await expect(
        writeArtifact({
          projectRoot,
          artifact: artifact({ date: '2026-07-19T01:35:00+09:00' }),
          body: '# Moved day rollback',
          dependencies: {
            afterPublish: async () => {
              await rename(dayPath, movedDay);
              await symlink(movedDay, dayPath);
            },
          },
        })
      ).rejects.toThrow(/ancestry|identity|symlink|directory/i);
      expect(await readdir(movedDay)).toEqual([]);
      expect(process.cwd()).toBe(originalCwd);
    } finally {
      await rm(dayPath, { force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('does not read from or leave artifacts in an outside tree during 1ms sessions swaps', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'omcodex-deep-verify-swap-outside-'));
    const sessionsPath = join(projectRoot, '.codex/outputs/sessions');
    const parkedSessions = join(outside, 'parked-sessions');
    const outsideSessions = join(outside, 'victim-sessions');
    const outsideDay = join(outsideSessions, '2026-07-19');
    const originalCwd = process.cwd();
    let stop = false;
    let swapFailure: unknown;

    await putCandidate(
      projectRoot,
      '2026-07-19',
      'deep-verify-010000.md',
      serializeArtifact(artifact({ date: '2026-07-19T01:00:00+09:00' }), '# Safe candidate')
    );
    await putCandidate(
      outside,
      '2026-07-19',
      'deep-verify-020000.md',
      serializeArtifact(
        artifact({ date: '2026-07-19T02:00:00+09:00', verifiedSha: 'b'.repeat(40) }),
        '# Outside candidate'
      )
    );
    await rename(join(outside, '.codex/outputs/sessions'), outsideSessions);
    const outsideSnapshot = await treeEntries(outsideSessions);
    const outsideRootSnapshot = await treeEntries(outside);
    const outsideCandidate = join(outsideDay, 'deep-verify-020000.md');
    const outsideBytes = await readFile(outsideCandidate);

    const swapLoop = (async () => {
      try {
        while (!stop) {
          renameSync(sessionsPath, parkedSessions);
          symlinkSync(outsideSessions, sessionsPath);
          await delay(1);
          rmSync(sessionsPath);
          renameSync(parkedSessions, sessionsPath);
          await delay(1);
        }
      } catch (error) {
        swapFailure = error;
      }
    })();

    try {
      for (let index = 0; index < 24; index += 1) {
        let selectedOutside = false;
        try {
          await selectArtifact({
            projectRoot,
            repository: 'baekenough/oh-my-customcodex',
            releaseVersion: '1.0.28',
            verifiedSha: 'b'.repeat(40),
          });
          selectedOutside = true;
        } catch {
          // A swapped path must fail closed rather than read the victim tree.
        }
        expect(selectedOutside).toBe(false);

        try {
          await writeArtifact({
            projectRoot,
            artifact: artifact({
              date: `2026-07-19T03:00:${String(index).padStart(2, '0')}+09:00`,
            }),
            body: `# Swap writer ${index}`,
          });
        } catch {
          // Directory identity changes are expected while the attacker is active.
        }
      }
    } finally {
      stop = true;
      await swapLoop;
      if ((await lstat(sessionsPath).catch(() => null))?.isSymbolicLink()) {
        await rm(sessionsPath);
      }
      if (await lstat(parkedSessions).catch(() => null)) {
        await rename(parkedSessions, sessionsPath);
      }
    }

    try {
      expect(swapFailure).toBeUndefined();
      expect(await treeEntries(outsideSessions)).toEqual(outsideSnapshot);
      expect(await treeEntries(outside)).toEqual(outsideRootSnapshot);
      expect(await readFile(outsideCandidate)).toEqual(outsideBytes);
      expect(process.cwd()).toBe(originalCwd);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('selects by exact repository, release, and SHA using frontmatter date rather than mtime', async () => {
    const olderData = artifact({ date: '2026-07-19T01:00:00+09:00' });
    const newerData = artifact({ date: '2026-07-19T02:00:00+09:00' });
    const older = await putCandidate(
      projectRoot,
      '2026-07-19',
      'deep-verify-010000.md',
      serializeArtifact(olderData, '# Older')
    );
    const newer = await putCandidate(
      projectRoot,
      '2026-07-19',
      'deep-verify-020000.md',
      serializeArtifact(newerData, '# Newer')
    );
    await utimes(older, new Date('2035-01-01'), new Date('2035-01-01'));
    await utimes(newer, new Date('2020-01-01'), new Date('2020-01-01'));

    const selected = await selectArtifact({
      projectRoot,
      repository: 'baekenough/oh-my-customcodex',
      releaseVersion: '1.0.28',
      verifiedSha: 'a'.repeat(40),
    });
    expect(selected.path).toBe(newer);
  });

  it('uses lexical path order as the deterministic tie-breaker', async () => {
    const content = serializeArtifact(artifact(), '# Same metadata date');
    const first = await putCandidate(projectRoot, '2026-07-18', 'deep-verify-235959.md', content);
    await putCandidate(projectRoot, '2026-07-19', 'deep-verify-012345.md', content);

    const selected = await selectArtifact({
      projectRoot,
      repository: 'baekenough/oh-my-customcodex',
      releaseVersion: '1.0.28',
      verifiedSha: 'a'.repeat(40),
    });
    expect(selected.path).toBe(first);
  });

  it('fails closed when the newest relevant artifact is malformed but ignores a newer valid other release', async () => {
    await putCandidate(
      projectRoot,
      '2026-07-19',
      'deep-verify-010000.md',
      serializeArtifact(artifact({ date: '2026-07-19T01:00:00+09:00' }), '# Valid current')
    );
    await putCandidate(
      projectRoot,
      '2026-07-19',
      'deep-verify-020000.md',
      rawArtifact(artifact({ date: '2026-07-19T02:00:00+09:00', verdict: 'BROKEN' }))
    );
    await putCandidate(
      projectRoot,
      '2026-07-19',
      'deep-verify-030000.md',
      serializeArtifact(
        artifact({ date: '2026-07-19T03:00:00+09:00', releaseVersion: '1.0.29' }),
        '# Other release'
      )
    );

    await expect(
      selectArtifact({
        projectRoot,
        repository: 'baekenough/oh-my-customcodex',
        releaseVersion: '1.0.28',
        verifiedSha: 'a'.repeat(40),
      })
    ).rejects.toThrow(/newest relevant artifact is malformed/i);
  });

  it('ignores a newer malformed artifact when its extracted selector identifies another release', async () => {
    const current = await putCandidate(
      projectRoot,
      '2026-07-19',
      'deep-verify-010000.md',
      serializeArtifact(artifact({ date: '2026-07-19T01:00:00+09:00' }), '# Valid current')
    );
    await putCandidate(
      projectRoot,
      '2026-07-19',
      'deep-verify-020000.md',
      rawArtifact(
        artifact({
          date: '2026-07-19T02:00:00+09:00',
          releaseVersion: '1.0.29',
          verdict: 'BROKEN',
        })
      )
    );

    const selected = await selectArtifact({
      projectRoot,
      repository: 'baekenough/oh-my-customcodex',
      releaseVersion: '1.0.28',
      verifiedSha: 'a'.repeat(40),
    });
    expect(selected.path).toBe(current);
  });

  it('fails the whole selector when any canonical candidate JSON cannot be decoded', async () => {
    await putCandidate(
      projectRoot,
      '2026-07-19',
      'deep-verify-020000.md',
      serializeArtifact(artifact({ date: '2026-07-19T02:00:00+09:00' }), '# Valid current')
    );
    await putCandidate(
      projectRoot,
      '2026-07-18',
      'deep-verify-010000.md',
      `---\n{
  "date": "2026-07-18T01:00:00+09:00",
  "repository": "different/repository",
  "releaseVersion": "9.9.9",
  "verifiedSha": "${'b'.repeat(40)}",
---\n# Undecodable older candidate\n`
    );

    await expect(
      selectArtifact({
        projectRoot,
        repository: 'baekenough/oh-my-customcodex',
        releaseVersion: '1.0.28',
        verifiedSha: 'a'.repeat(40),
      })
    ).rejects.toThrow(/JSON cannot be decoded|undecodable/i);
  });

  it('fails closed instead of falling back past canonical artifact or date-directory symlinks', async () => {
    const older = await putCandidate(
      projectRoot,
      '2026-07-19',
      'deep-verify-010000.md',
      serializeArtifact(artifact({ date: '2026-07-19T01:00:00+09:00' }), '# Older valid')
    );
    const candidateLink = join(dirname(older), 'deep-verify-020000.md');
    await symlink(older, candidateLink);

    const selector = {
      projectRoot,
      repository: 'baekenough/oh-my-customcodex',
      releaseVersion: '1.0.28',
      verifiedSha: 'a'.repeat(40),
    };
    await expect(selectArtifact(selector)).rejects.toThrow(/canonical|symlink|regular/i);

    await rm(candidateLink);
    const outsideDay = await mkdtemp(join(tmpdir(), 'omcodex-deep-verify-day-link-'));
    try {
      await symlink(outsideDay, join(projectRoot, '.codex/outputs/sessions/2026-07-20'));
      await expect(selectArtifact(selector)).rejects.toThrow(/canonical|symlink|directory/i);
    } finally {
      await rm(outsideDay, { recursive: true, force: true });
    }
  });

  it('returns nonzero-safe failures for missing, wrong-release, and wrong-SHA selection', async () => {
    await expect(
      selectArtifact({
        projectRoot,
        repository: 'baekenough/oh-my-customcodex',
        releaseVersion: '1.0.28',
        verifiedSha: 'a'.repeat(40),
      })
    ).rejects.toThrow(/no matching deep-verify artifact/i);

    await putCandidate(
      projectRoot,
      '2026-07-19',
      'deep-verify-012345.md',
      serializeArtifact(artifact(), '# Current release')
    );
    for (const [releaseVersion, verifiedSha] of [
      ['1.0.27', 'a'.repeat(40)],
      ['1.0.28', 'b'.repeat(40)],
    ]) {
      await expect(
        selectArtifact({
          projectRoot,
          repository: 'baekenough/oh-my-customcodex',
          releaseVersion,
          verifiedSha,
        })
      ).rejects.toThrow(/no matching deep-verify artifact/i);
    }
  });

  it('exposes write, validate, and select CLI subcommands with machine-readable projections', async () => {
    const input = join(projectRoot, 'artifact.json');
    await writeFile(input, JSON.stringify({ artifact: artifact(), body: '# CLI report' }));
    const written = spawnSync(
      process.execPath,
      [HELPER, 'write', '--project-root', projectRoot, '--input', input],
      {
        encoding: 'utf8',
      }
    );
    expect(written.status, written.stderr).toBe(0);
    const writeProjection = JSON.parse(written.stdout);

    const validated = spawnSync(
      process.execPath,
      [HELPER, 'validate', '--file', writeProjection.path],
      {
        encoding: 'utf8',
      }
    );
    expect(validated.status, validated.stderr).toBe(0);
    expect(JSON.parse(validated.stdout).artifact.releaseVersion).toBe('1.0.28');

    const selected = spawnSync(
      process.execPath,
      [
        HELPER,
        'select',
        '--project-root',
        projectRoot,
        '--repository',
        'baekenough/oh-my-customcodex',
        '--release-version',
        '1.0.28',
        '--verified-sha',
        'a'.repeat(40),
      ],
      { encoding: 'utf8' }
    );
    expect(selected.status, selected.stderr).toBe(0);
    expect(JSON.parse(selected.stdout).path).toBe(writeProjection.path);
  });

  it('round-trips every canonical execution mode through CLI write, validate, and exact select', async () => {
    const modes = [
      'standard',
      'docs-only-self-review',
      'lite-deterministic',
      'converged-substitution',
    ];

    for (const [index, executionMode] of modes.entries()) {
      const modeRoot = join(projectRoot, `mode-${index}`);
      const input = join(modeRoot, 'artifact.json');
      await mkdir(modeRoot, { recursive: true });
      await writeFile(
        input,
        JSON.stringify({
          artifact: artifact({
            date: `2026-07-19T04:00:0${index}+09:00`,
            executionMode,
          }),
          body: `# ${executionMode} report`,
        })
      );

      const written = spawnSync(
        process.execPath,
        [HELPER, 'write', '--project-root', modeRoot, '--input', input],
        { encoding: 'utf8' }
      );
      expect(written.status, written.stderr).toBe(0);
      const writeProjection = JSON.parse(written.stdout);
      expect(writeProjection.artifact.executionMode).toBe(executionMode);

      const validated = spawnSync(
        process.execPath,
        [HELPER, 'validate', '--file', writeProjection.path],
        { encoding: 'utf8' }
      );
      expect(validated.status, validated.stderr).toBe(0);
      expect(JSON.parse(validated.stdout).artifact.executionMode).toBe(executionMode);

      const selected = spawnSync(
        process.execPath,
        [
          HELPER,
          'select',
          '--project-root',
          modeRoot,
          '--repository',
          'baekenough/oh-my-customcodex',
          '--release-version',
          '1.0.28',
          '--verified-sha',
          'a'.repeat(40),
        ],
        { encoding: 'utf8' }
      );
      expect(selected.status, selected.stderr).toBe(0);
      const selectProjection = JSON.parse(selected.stdout);
      expect(selectProjection.path).toBe(writeProjection.path);
      expect(selectProjection.artifact.executionMode).toBe(executionMode);
    }
  });

  it('resolves and executes the helper relative to loaded skills across source, clean-install, and plugin layouts', async () => {
    const deepVerifyGuidance = await readFile(SKILL, 'utf8');
    const postReleaseGuidance = await readFile(POST_RELEASE, 'utf8');
    for (const guidance of [deepVerifyGuidance, postReleaseGuidance]) {
      expect(guidance).not.toContain(HARDCODED_SOURCE_HELPER);
      expect(guidance).toContain('currently loaded `SKILL.md`');
      expect(guidance).toContain('scripts/artifact-contract.mjs');
      expect(guidance).toContain('$artifact_helper');
    }

    const installRoot = join(projectRoot, 'clean-install');
    const installed = await install({
      targetDir: installRoot,
      language: 'en',
      components: ['skills'],
      skipConfirm: true,
      provisionOmxProject: false,
      dependencies: {
        generateAndWriteLockfileForDir: async () => ({ fileCount: 0 }),
      },
    });
    expect(installed.success, installed.error).toBe(true);

    const installedSkill = join(installRoot, '.agents/skills/deep-verify/SKILL.md');
    const installedHelper = join(dirname(installedSkill), 'scripts/artifact-contract.mjs');
    expect(await readFile(installedSkill, 'utf8')).toBe(await readFile(SKILL, 'utf8'));
    expect(await readFile(installedHelper, 'utf8')).toBe(await readFile(HELPER, 'utf8'));

    const input = join(installRoot, 'artifact-input.json');
    await writeFile(input, JSON.stringify({ artifact: artifact(), body: '# Installed helper' }));
    const written = spawnSync(
      process.execPath,
      [installedHelper, 'write', '--project-root', installRoot, '--input', input],
      { encoding: 'utf8' }
    );
    expect(written.status, written.stderr).toBe(0);
    const writtenProjection = JSON.parse(written.stdout);

    const sourceHelperFromLoadedSkill = join(dirname(SKILL), 'scripts/artifact-contract.mjs');
    const sourceValidation = spawnSync(
      process.execPath,
      [sourceHelperFromLoadedSkill, 'validate', '--file', writtenProjection.path],
      { encoding: 'utf8' }
    );
    expect(sourceValidation.status, sourceValidation.stderr).toBe(0);

    const pluginSkillsRoot = join(projectRoot, 'plugin/skills');
    await cp(join(ROOT, '.codex/skills/deep-verify'), join(pluginSkillsRoot, 'deep-verify'), {
      recursive: true,
    });
    await cp(
      join(ROOT, '.codex/skills/post-release-followup'),
      join(pluginSkillsRoot, 'post-release-followup'),
      { recursive: true }
    );
    const pluginDeepSkill = join(pluginSkillsRoot, 'deep-verify/SKILL.md');
    const pluginPostSkill = join(pluginSkillsRoot, 'post-release-followup/SKILL.md');
    const pluginHelperFromDeep = join(dirname(pluginDeepSkill), 'scripts/artifact-contract.mjs');
    const pluginHelperFromPost = join(
      dirname(dirname(pluginPostSkill)),
      'deep-verify/scripts/artifact-contract.mjs'
    );
    expect(pluginHelperFromPost).toBe(pluginHelperFromDeep);
    const pluginSelection = spawnSync(
      process.execPath,
      [
        pluginHelperFromPost,
        'select',
        '--project-root',
        installRoot,
        '--repository',
        'baekenough/oh-my-customcodex',
        '--release-version',
        '1.0.28',
        '--verified-sha',
        'a'.repeat(40),
      ],
      { encoding: 'utf8' }
    );
    expect(pluginSelection.status, pluginSelection.stderr).toBe(0);
    expect(JSON.parse(pluginSelection.stdout).path).toBe(writtenProjection.path);
  });

  it('documents mandatory producer write/readback and fail-closed Source B unresolved filtering', async () => {
    const deepVerify = await readFile(SKILL, 'utf8');
    expect(deepVerify).toContain('node "$artifact_helper" write');
    expect(deepVerify).toContain('node "$artifact_helper" validate');
    expect(deepVerify).toContain('.codex/outputs/sessions/YYYY-MM-DD/deep-verify-HHmmss.md');
    expect(deepVerify).toContain('READY');
    expect(deepVerify).toMatch(/artifact[^\n]*(?:fails|failure)[^\n]*NEEDS REVIEW/i);
    expect(deepVerify).toContain('Pipeline-deferred finalization');
    expect(deepVerify).toContain('Rounds 1–7');
    expect(deepVerify).toMatch(/pending handoff/i);
    expect(deepVerify).toContain('`reviewedTree`');
    expect(deepVerify).toContain('40-character lowercase hexadecimal');
    expect(deepVerify).toContain('git cat-file -e "$reviewedTree^{tree}"');
    expect(deepVerify).toContain('git cat-file -t "$reviewedTree"');
    expect(deepVerify).toContain('git diff --no-ext-diff --binary develop "$reviewedTree"');
    expect(deepVerify).toMatch(/all six reviewers/i);
    expect(deepVerify).toMatch(/pending handoff bundle pins the same `reviewedTree`/i);
    expect(deepVerify).toMatch(/live dirty worktree[\s\S]{0,120}fall back[\s\S]{0,80}HEAD/i);
    expect(deepVerify).toMatch(/must not mutate the frozen tree/i);
    expect(deepVerify).toMatch(/new acyclic pipeline run[\s\S]{0,80}new `reviewedTree`/i);
    expect(deepVerify).toMatch(/drift[\s\S]{0,80}invalidates[\s\S]{0,80}BLOCKED/i);
    expect(deepVerify).toMatch(/invalid or non-tree object[\s\S]{0,40}BLOCKED/i);
    expect(deepVerify).toMatch(/verification-artifact[^\n]*finalizer/i);
    expect(deepVerify).toContain('branch placement');
    expect(deepVerify).toContain('Lore commit');
    expect(deepVerify).toContain('git rev-parse "$final_sha^{tree}"');
    expect(deepVerify).toMatch(/equals the pinned `reviewedTree`/i);
    expect(deepVerify).toContain('returned JSON path parsing');
    expect(deepVerify).toMatch(/exact repository\/release\/SHA `select`/i);
    expect(deepVerify).toMatch(/Only after every step[\s\S]{0,160}completed[\s\S]{0,80}READY/i);

    const postRelease = await readFile(POST_RELEASE, 'utf8');
    expect(postRelease).toContain('node "$artifact_helper" select');
    expect(postRelease).toContain('--repository');
    expect(postRelease).toContain('--release-version');
    expect(postRelease).toContain('--verified-sha');
    expect(postRelease).toMatch(/unresolved[^\n]*(?:MEDIUM|LOW)/i);
    expect(postRelease).toMatch(/missing|malformed/i);
    expect(postRelease).toMatch(/fail(?:s|ure| closed)|block/i);
  });
});
