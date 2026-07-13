import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(import.meta.dir, '../../..');
const tempDirectories: string[] = [];

async function tempDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('Codex-only create route integration', () => {
  it('runs the agent, skill, and guide analyze actions through the Codex provider', async () => {
    const project = await tempDirectory('omcodex-serve-create-routes-project-');
    const home = await tempDirectory('omcodex-serve-create-routes-home-');
    const bin = await tempDirectory('omcodex-serve-create-routes-bin-');
    const invocationLog = join(project, 'codex-invocations.log');
    await mkdir(join(project, '.codex', 'agents'), { recursive: true });
    await mkdir(join(project, '.agents', 'skills'), { recursive: true });
    await writeFile(join(project, 'AGENTS.md'), '# Clean Codex fixture\n', 'utf8');
    await writeFile(
      join(bin, 'codex'),
      `#!/bin/sh
set -eu
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output-last-message)
      output="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
prompt="$(/bin/cat)"
printf '%s\n' invocation >> '${invocationLog}'
case "$prompt" in
  *"agent markdown file"*)
    /bin/cat > "$output" <<'EOF'
---
name: route-codex-agent
description: Generated through the agent create action
model_reasoning_effort: high
domain: universal
tools:
  - Read
  - Grep
  - Glob
---

# Route Codex Agent
EOF
    ;;
  *"skill SKILL.md file"*)
    /bin/cat > "$output" <<'EOF'
---
name: route-codex-skill
description: Generated through the skill create action
scope: core
---

## Instructions

Use the route contract.
EOF
    ;;
  *"guide README.md file"*)
    /bin/cat > "$output" <<'EOF'
# Route Codex Guide

Generated through the guide create action.
EOF
    ;;
  *)
    echo "unexpected generation prompt" >&2
    exit 64
    ;;
esac
`,
      'utf8'
    );
    await chmod(join(bin, 'codex'), 0o755);

    const routes = {
      agent: pathToFileURL(
        join(PROJECT_ROOT, 'packages/serve/src/routes/agents/create/+page.server.ts')
      ).href,
      skill: pathToFileURL(
        join(PROJECT_ROOT, 'packages/serve/src/routes/skills/create/+page.server.ts')
      ).href,
      guide: pathToFileURL(
        join(PROJECT_ROOT, 'packages/serve/src/routes/guides/create/+page.server.ts')
      ).href,
    };
    const runner = `
const routeUrls = ${JSON.stringify(routes)};

async function analyze(routeUrl, input, pathname) {
  const route = await import(routeUrl);
  const action = route.actions?.analyze;
  if (typeof action !== 'function') throw new Error('analyze action is not wired');
  const form = new FormData();
  form.set('input', input);
  const request = new Request('http://localhost' + pathname + '?/analyze', {
    method: 'POST',
    body: form,
  });
  return action({ request });
}

const results = {
  agent: await analyze(routeUrls.agent, 'Create an architecture agent', '/agents/create'),
  skill: await analyze(routeUrls.skill, 'Create a review skill', '/skills/create'),
  guide: await analyze(routeUrls.guide, 'Create a retry guide', '/guides/create'),
};
process.stdout.write(JSON.stringify(results));
`;
    const child = Bun.spawn([process.execPath, '-e', runner], {
      cwd: PROJECT_ROOT,
      env: {
        PATH: bin,
        HOME: home,
        CODEX_HOME: join(home, '.codex'),
        OMX_PROJECT_ROOT: project,
        LANG: 'C.UTF-8',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdoutPromise = new Response(child.stdout).text();
    const stderrPromise = new Response(child.stderr).text();
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      stdoutPromise,
      stderrPromise,
    ]);
    if (exitCode !== 0) {
      throw new Error(`route integration child failed (${exitCode}): ${stderr || stdout}`);
    }

    const results = JSON.parse(stdout) as Record<string, Record<string, unknown>>;
    expect(results.agent).toMatchObject({
      success: true,
      mode: 'codex',
      diagnostics: [],
      name: 'route-codex-agent',
      description: 'Generated through the agent create action',
      model: '',
      modelReasoningEffort: 'high',
      domain: 'universal',
    });
    expect(results.skill).toMatchObject({
      success: true,
      mode: 'codex',
      diagnostics: [],
      name: 'route-codex-skill',
      description: 'Generated through the skill create action',
      scope: 'core',
      contextFork: false,
    });
    expect(results.guide).toEqual({
      success: true,
      mode: 'codex',
      diagnostics: [],
      name: 'create-retry-guide',
      body: '# Route Codex Guide\n\nGenerated through the guide create action.',
    });
    expect((await readFile(invocationLog, 'utf8')).trim().split('\n')).toEqual([
      'invocation',
      'invocation',
      'invocation',
    ]);
  });
});
