import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type BunSqliteExecFile,
  type BunSqliteExecOptions,
  type Evaluation,
  getEvaluation,
  getEvaluationDashboardData,
  getEvaluations,
  saveEvaluation,
} from '../../../packages/serve/src/lib/server/eval-reader.js';

const fixtureRoots: string[] = [];

function createFixtureRoot(): string {
  const root = join(
    tmpdir(),
    `omcodex-eval-reader-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fixtureRoots.push(root);
  return root;
}

interface InvocationFixture {
  sessionPpid: string;
  sessionId?: string;
  timestamp: string;
  agentType: string;
  model: string;
  outcome: string;
}

async function createInvocationDb(path: string, rows: InvocationFixture[] = []): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new Database(path);
  try {
    database.run(`
      CREATE TABLE agent_invocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_ppid TEXT NOT NULL,
        session_id TEXT,
        timestamp TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        model TEXT NOT NULL,
        outcome TEXT NOT NULL
      )
    `);
    const insert = database.query(`
      INSERT INTO agent_invocations (
        session_ppid, session_id, timestamp, agent_type, model, outcome
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(
        row.sessionPpid,
        row.sessionId ?? null,
        row.timestamp,
        row.agentType,
        row.model,
        row.outcome
      );
    }
  } finally {
    database.close();
  }
}

function evaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: 'eval-1',
    sessionId: 'session-1',
    score: 4,
    verdict: 'pass',
    tags: ['runtime'],
    comment: 'canonical',
    evaluatedAt: '2026-07-13T00:00:00Z',
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe('eval-reader evaluation storage', () => {
  it('writes canonical JSON and merges legacy files without letting legacy duplicates win', async () => {
    const home = createFixtureRoot();
    const canonicalDirectory = join(home, '.oh-my-customcodex', 'evaluations');
    const legacyDirectory = join(home, '.omcustom', 'evaluations');
    await Promise.all([
      mkdir(canonicalDirectory, { recursive: true }),
      mkdir(legacyDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(canonicalDirectory, 'eval-1.json'),
        JSON.stringify(evaluation({ comment: 'canonical wins' }))
      ),
      writeFile(
        join(legacyDirectory, 'eval-1.json'),
        JSON.stringify(evaluation({ comment: 'legacy duplicate' }))
      ),
      writeFile(
        join(legacyDirectory, 'eval-legacy.json'),
        JSON.stringify(evaluation({ id: 'eval-legacy', comment: 'legacy only' }))
      ),
    ]);

    const evaluations = await getEvaluations({ home });
    expect(evaluations).toHaveLength(2);
    expect(evaluations.find((item) => item.id === 'eval-1')?.comment).toBe('canonical wins');
    expect((await getEvaluation('eval-legacy', { home }))?.comment).toBe('legacy only');

    const saved = await saveEvaluation(
      {
        sessionId: 'session-new',
        score: 5,
        verdict: 'pass',
        tags: [],
        comment: 'new canonical record',
        evaluatedAt: '2026-07-13T01:00:00Z',
      },
      { home }
    );
    expect(
      JSON.parse(await readFile(join(canonicalDirectory, `${saved.id}.json`), 'utf8')).id
    ).toBe(saved.id);
    expect(await readdir(legacyDirectory)).not.toContain(`${saved.id}.json`);
  });
});

describe('eval-reader persistent sessions', () => {
  it('uses the bounded Bun adapter when node:sqlite is unavailable and keeps reading after an empty canonical DB', async () => {
    const home = createFixtureRoot();
    const liveDirectory = join(home, 'tmp');
    const canonicalDb = join(home, '.oh-my-customcodex', 'eval-core.sqlite');
    const legacyDb = join(home, '.omcustom', 'eval.db');
    const oldestLegacyDb = join(home, '.config', 'oh-my-customcode', 'eval-core.sqlite');
    const duplicate = {
      timestamp: '2026-07-13T00:00:00Z',
      agent_type: 'executor',
      model: 'gpt-5.6-sol',
      outcome: 'success',
    };

    await Promise.all([
      createInvocationDb(canonicalDb),
      createInvocationDb(legacyDb, [
        {
          sessionPpid: '4242',
          timestamp: duplicate.timestamp,
          agentType: duplicate.agent_type,
          model: duplicate.model,
          outcome: duplicate.outcome,
        },
      ]),
      createInvocationDb(oldestLegacyDb, [
        {
          sessionPpid: '9001',
          timestamp: '2026-07-13T02:00:00Z',
          agentType: 'verifier',
          model: 'gpt-5.6-sol',
          outcome: 'success',
        },
      ]),
      mkdir(liveDirectory, { recursive: true }),
    ]);
    await writeFile(
      join(liveDirectory, '.codex-task-outcomes-4242'),
      `${[
        duplicate,
        duplicate,
        { ...duplicate, model: 'gpt-5.6-luna' },
        { ...duplicate, outcome: 'failure' },
      ]
        .map((record) => JSON.stringify(record))
        .join('\n')}\n`
    );

    let bunReadCalls = 0;
    const result = await getEvaluationDashboardData({
      home,
      tmpDir: liveDirectory,
      loadNodeSqlite: async () => {
        throw new Error('simulate Node 20');
      },
      readWithBun: async (databasePaths) => {
        bunReadCalls += 1;
        expect(databasePaths).toEqual([canonicalDb, legacyDb, oldestLegacyDb]);
        return {
          outcomes: [
            {
              session_ppid: '4242',
              ...duplicate,
            },
            {
              session_ppid: '9001',
              timestamp: '2026-07-13T02:00:00Z',
              agent_type: 'verifier',
              model: 'gpt-5.6-sol',
              outcome: 'success',
            },
          ],
          errors: [],
        };
      },
    });

    expect(bunReadCalls).toBe(1);
    expect(result.diagnostics).toEqual([]);
    expect(result.sessions.find((session) => session.sessionId === '4242')?.agentCount).toBe(3);
    expect(result.sessions.find((session) => session.sessionId === '9001')?.agentCount).toBe(1);
  });

  it('merges every database with node:sqlite and reports one unreadable legacy path', async () => {
    const home = createFixtureRoot();
    const canonicalDb = join(home, 'canonical.sqlite');
    const legacyDb = join(home, 'legacy.sqlite');
    const unreadableDb = join(home, 'unreadable.sqlite');
    await Promise.all(
      [canonicalDb, legacyDb, unreadableDb].map(async (path) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, 'fixture');
      })
    );

    const opened: Array<{ path: string; options: unknown }> = [];
    const closed: string[] = [];
    class FakeDatabaseSync {
      constructor(
        private readonly path: string,
        options?: { readOnly?: boolean; allowExtension?: boolean }
      ) {
        opened.push({ path, options });
      }

      prepare() {
        if (this.path === unreadableDb) throw new Error('bad fixture');
        return {
          all: () =>
            this.path === canonicalDb
              ? []
              : [
                  {
                    session_ppid: '5150',
                    session_id: null,
                    timestamp: '2026-07-13T03:00:00Z',
                    agent_type: 'architect',
                    model: 'gpt-5.6-sol',
                    outcome: 'success',
                  },
                ],
        };
      }

      close() {
        closed.push(this.path);
      }
    }

    const result = await getEvaluationDashboardData({
      home,
      tmpDir: join(home, 'missing-tmp'),
      databasePaths: [canonicalDb, legacyDb, unreadableDb],
      loadNodeSqlite: async () => ({ DatabaseSync: FakeDatabaseSync }),
      readWithBun: async () => {
        throw new Error('must not use fallback');
      },
    });

    expect(result.sessions).toContainEqual({
      sessionId: '5150',
      startedAt: '2026-07-13T03:00:00Z',
      agentCount: 1,
      evaluationCount: 0,
      avgScore: null,
    });
    expect(result.diagnostics).toEqual([
      {
        code: 'eval_db_read_failed',
        severity: 'warning',
        message: 'Could not read evaluation history from ~/unreadable.sqlite.',
        source: '~/unreadable.sqlite',
      },
    ]);
    expect(opened).toEqual(
      [canonicalDb, legacyDb, unreadableDb].map((path) => ({
        path,
        options: { readOnly: true, allowExtension: false },
      }))
    );
    expect(closed).toEqual([canonicalDb, legacyDb, unreadableDb]);
  });

  it('passes database paths with shell metacharacters as safe Bun argv', async () => {
    const home = createFixtureRoot();
    const databasePath = join(home, "history with spaces '$HOME;echo.sqlite");
    await createInvocationDb(databasePath, [
      {
        sessionPpid: 'safe-argv',
        timestamp: '2026-07-13T04:00:00Z',
        agentType: 'verifier',
        model: 'gpt-5.6-sol',
        outcome: 'success',
      },
    ]);

    let invocation: { file: string; args: string[]; options: BunSqliteExecOptions } | undefined;
    const execFileImpl: BunSqliteExecFile = (file, args, options, callback) => {
      invocation = { file, args, options };
      callback(
        null,
        JSON.stringify({
          outcomes: [
            {
              session_ppid: 'safe-argv',
              timestamp: '2026-07-13T04:00:00Z',
              agent_type: 'verifier',
              model: 'gpt-5.6-sol',
              outcome: 'success',
            },
          ],
          errors: [],
        })
      );
    };

    const result = await getEvaluationDashboardData({
      home,
      tmpDir: join(home, 'missing-tmp'),
      databasePaths: [databasePath],
      loadNodeSqlite: async () => {
        throw new Error('simulate Node 20');
      },
      execFileImpl,
    });

    expect(invocation).toBeDefined();
    expect(invocation?.file).toBe(process.execPath);
    expect(invocation?.args[0]).toBe('-e');
    expect(invocation?.args.at(-1)).toBe(databasePath);
    expect(invocation?.options.shell).toBe(false);
    expect(invocation?.options.env.NODE_OPTIONS).toBeUndefined();
    expect(invocation?.options.env.BUN_OPTIONS).toBeUndefined();
    expect(result.diagnostics).toEqual([]);
    expect(result.sessions).toContainEqual({
      sessionId: 'safe-argv',
      startedAt: '2026-07-13T04:00:00Z',
      agentCount: 1,
      evaluationCount: 0,
      avgScore: null,
    });
  });

  it('returns a structured user-visible diagnostic when neither SQLite adapter is available', async () => {
    const home = createFixtureRoot();
    const databasePath = join(home, '.oh-my-customcodex', 'eval-core.sqlite');
    await mkdir(dirname(databasePath), { recursive: true });
    await writeFile(databasePath, 'fixture');

    const result = await getEvaluationDashboardData({
      home,
      tmpDir: join(home, 'missing-tmp'),
      loadNodeSqlite: async () => {
        throw new Error('unavailable');
      },
      readWithBun: async () => {
        throw new Error('unavailable');
      },
    });

    expect(result.sessions).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        code: 'eval_db_adapter_unavailable',
        severity: 'error',
        message:
          'Persistent evaluation history is unavailable. Use Node 22.13+ with node:sqlite enabled, or install Bun for the compatibility reader.',
      },
    ]);
  });
});
