import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';

const WRAPPER = join(
  import.meta.dir,
  '../../../.codex/skills/codex-exec/scripts/codex-wrapper.cjs'
);
const TEMPLATE_WRAPPER = join(
  import.meta.dir,
  '../../../templates/.claude/skills/codex-exec/scripts/codex-wrapper.cjs'
);

const FAKE_CODEX = `#!/usr/bin/env node
const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE || 'success';

function complete() {
  if (mode === 'fail') {
    process.stderr.write('synthetic codex failure\\n');
    process.exit(17);
  }

  process.stderr.write('synthetic codex note\\n');

  if (args.includes('--json')) {
    process.stdout.write(
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: 'pong',
        },
      }) + '\\n'
    );
  } else {
    process.stdout.write('pong\\n');
  }

  process.exit(0);
}

let ended = false;
process.stdin.on('end', () => {
  ended = true;
  complete();
});
process.stdin.resume();

setTimeout(() => {
  if (!ended) {
    process.stderr.write('stdin was not closed\\n');
    process.exit(9);
  }
}, 200);
`;

interface WrapperResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runWrapper(extraEnv: Record<string, string> = {}): Promise<WrapperResult> {
  const proc = spawn({
    cmd: ['node', WRAPPER, '--prompt', 'Reply with exactly: pong', '--json', '--timeout', '5000'],
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

describe('codex-wrapper.cjs', () => {
  let tempDir: string;
  let binDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'omcodex-codex-wrapper-test-'));
    binDir = join(tempDir, 'bin');
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, 'codex'), FAKE_CODEX);
    await chmod(join(binDir, 'codex'), 0o755);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('closes child stdin when prompt mode is used and still parses JSON output', async () => {
    const result = await runWrapper({
      PATH: `${binDir}:${process.env.PATH || ''}`,
    });

    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.success).toBe(true);
    expect(parsed.output).toBe('pong');
    expect(parsed.events_count).toBe(1);
    expect(result.stderr).toContain('[codex-wrapper] Executing codex with timeout: 5000ms');
  });

  it('preserves captured child stderr on failure', async () => {
    const result = await runWrapper({
      PATH: `${binDir}:${process.env.PATH || ''}`,
      FAKE_CODEX_MODE: 'fail',
    });

    expect(result.exitCode).toBe(17);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.success).toBe(false);
    expect(parsed.exit_code).toBe(17);
    expect(parsed.stderr).toContain('synthetic codex failure');
    expect(parsed.stderr).not.toContain('stdin was not closed');
  });

  it('keeps the shipped template wrapper in sync with the live wrapper', async () => {
    const [liveWrapper, templateWrapper] = await Promise.all([
      readFile(WRAPPER, 'utf8'),
      readFile(TEMPLATE_WRAPPER, 'utf8'),
    ]);

    expect(templateWrapper).toBe(liveWrapper);
  });
});
