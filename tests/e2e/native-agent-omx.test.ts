import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncNativeAgents } from '../../src/core/agent-compiler.js';

const omxPath = Bun.which('omx');
const omxIt = omxPath ? it : it.skip;

async function runOmx(
  args: string[],
  cwd: string,
  environment: Record<string, string | undefined>
): Promise<string> {
  const process = Bun.spawn([omxPath as string, ...args], {
    cwd,
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`omx ${args.join(' ')} failed (${exitCode}):\n${stderr}\n${stdout}`);
  }
  return stdout;
}

describe('native agent OMX discovery', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  omxIt(
    'preserves every deterministic harness role through project setup and discovers it',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'omcodex-native-omx-'));
      temporaryRoots.push(root);
      const project = join(root, 'project');
      const home = join(root, 'home');
      const destinationDir = join(project, '.codex', 'agents');
      const sourceDir = join(import.meta.dir, '../../templates/.claude/agents');
      await mkdir(project, { recursive: true });
      await mkdir(home, { recursive: true });

      const compiled = await syncNativeAgents({
        sourceDir,
        destinationDir,
        targetRoot: project,
        modelLanes: { frontier: 'gpt-5.6-sol', spark: 'gpt-5.6-luna' },
      });
      const expected = new Map(compiled.compiled.map((agent) => [agent.filename, agent.toml]));
      expect(expected.size).toBe(
        (await readdir(sourceDir)).filter((name) => name.endsWith('.md')).length
      );
      for (const [filename, toml] of expected) {
        expect(await readFile(join(destinationDir, filename), 'utf8')).toBe(toml);
      }

      const customPath = join(destinationDir, 'custom-local.toml');
      const customBytes =
        'name = "custom-local"\ndescription = "custom"\ndeveloper_instructions = "custom"\n';
      await writeFile(customPath, customBytes);
      const environment = {
        ...process.env,
        HOME: home,
        CODEX_HOME: join(home, '.codex'),
        XDG_CONFIG_HOME: join(home, '.config'),
        OMX_TEAM_STATE_ROOT: join(project, '.omx', 'state'),
        CI: '1',
        NO_COLOR: '1',
        TERM: 'dumb',
      };

      await runOmx(
        ['setup', '--scope', 'project', '--merge-agents', '--legacy', '--mcp=none'],
        project,
        environment
      );

      for (const [filename, toml] of expected) {
        expect(await readFile(join(destinationDir, filename), 'utf8')).toBe(toml);
      }
      expect(await readFile(customPath, 'utf8')).toBe(customBytes);

      const discovery = await runOmx(
        ['agents', 'list', '--scope', 'project'],
        project,
        environment
      );
      for (const filename of expected.keys()) {
        expect(discovery).toContain(filename.replace(/\.toml$/, ''));
      }
      expect(discovery).toContain('custom-local');
    }
  );
});
