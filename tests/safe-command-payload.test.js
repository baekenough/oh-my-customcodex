import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { stageCommandPayload } from '../scripts/safe-command-payload.mjs';

const temporaryRoots = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'safe-command-payload-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test('round-trips a hostile multilingual Markdown payload without exposing its bytes', async () => {
  const root = await fixture();
  const source = join(root, 'reviewed.md');
  const destination = join(root, 'stage', 'body.md');
  const payload =
    `${'긴 이슈 본문 '.repeat(900)}\n\n\`inline\`\n\n\`\`\`sh\n` +
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal hostile payload fixture
    'echo "${HOME}"; echo "$(whoami)"; gh api "/x?y=1&z=2"\n```\n' +
    `quotes: ' " & ? {"json":true}\n`;
  await writeFile(source, payload);

  const result = await stageCommandPayload({ source, destination, tempRoot: root });

  assert.equal(await readFile(destination, 'utf8'), payload);
  assert.equal(result.bytes, Buffer.byteLength(payload));
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await lstat(destination)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(result).includes('whoami'), false);
});

test('validates JSON before staging and rejects argv payloads by contract', async () => {
  const root = await fixture();
  const source = join(root, 'draft.json');
  await writeFile(source, '{not-json}');
  await assert.rejects(
    stageCommandPayload({
      source,
      destination: join(root, 'stage.json'),
      tempRoot: root,
      validateJson: true,
    }),
    /valid JSON/
  );

  const help = execFileSync(process.execPath, ['scripts/safe-command-payload.mjs', '--help'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  assert.match(help, /--source/);
  assert.doesNotMatch(help, /--payload|--body/);
});

test('rejects source and destination symlinks', async () => {
  const root = await fixture();
  const source = join(root, 'source.md');
  const sourceLink = join(root, 'source-link.md');
  const destination = join(root, 'destination.md');
  await writeFile(source, 'reviewed');
  await symlink(source, sourceLink);
  await assert.rejects(
    stageCommandPayload({ source: sourceLink, destination, tempRoot: root }),
    /source.*symbolic link/i
  );

  await writeFile(destination, 'old');
  const destinationLink = join(root, 'destination-link.md');
  await symlink(destination, destinationLink);
  await assert.rejects(
    stageCommandPayload({ source, destination: destinationLink, tempRoot: root }),
    /destination.*symbolic link/i
  );
});

test('rejects destinations outside or symlink-escaped from the explicit temporary root', async () => {
  const root = await fixture();
  const outside = await fixture();
  const source = join(root, 'source.md');
  await writeFile(source, 'reviewed');
  await assert.rejects(
    stageCommandPayload({ source, destination: join(outside, 'body.md'), tempRoot: root }),
    /outside temporary root/i
  );

  await symlink(outside, join(root, 'escape'));
  const escapedParent = join(outside, 'must-not-be-created');
  await assert.rejects(
    stageCommandPayload({
      source,
      destination: join(root, 'escape', 'must-not-be-created', 'body.md'),
      tempRoot: root,
    }),
    /outside temporary root|symbolic link/i
  );
  await assert.rejects(lstat(escapedParent), /ENOENT/);
});
