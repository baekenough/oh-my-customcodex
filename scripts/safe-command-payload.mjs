#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SAFE_COMMAND_PAYLOAD_HELP = `Usage: node scripts/safe-command-payload.mjs \\
  --source <reviewed-file> \\
  --destination <staged-file> \\
  --temp-root <temporary-root> [--json]\n\nCopies reviewed Markdown or validated JSON through a restrictive atomic file boundary.\nPayload bytes are never accepted as an argument.`;

function isContained(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function nearestExistingRealPath(candidate) {
  let current = candidate;
  while (true) {
    try {
      return { requested: current, real: await realpath(current) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function rejectSymlink(path, label) {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
    return stats;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function stageCommandPayload({ source, destination, tempRoot, validateJson = false }) {
  if (!source || !destination || !tempRoot) {
    throw new Error('--source, --destination, and --temp-root are required');
  }

  const rootStats = await rejectSymlink(tempRoot, 'temporary root');
  if (!rootStats?.isDirectory())
    throw new Error(`temporary root must be an existing directory: ${tempRoot}`);
  const requestedRoot = resolve(tempRoot);
  const requestedDestination = resolve(destination);
  const destinationRelative = relative(requestedRoot, requestedDestination);
  if (destinationRelative.startsWith('..') || isAbsolute(destinationRelative)) {
    throw new Error(`destination is outside temporary root: ${destination}`);
  }
  const canonicalRoot = await realpath(tempRoot);
  const destinationPath = resolve(canonicalRoot, destinationRelative);

  const sourceStats = await rejectSymlink(source, 'source');
  if (!sourceStats?.isFile()) throw new Error(`source must be an existing regular file: ${source}`);
  await rejectSymlink(destinationPath, 'destination');

  const parentPath = dirname(destinationPath);
  const parent = await nearestExistingRealPath(parentPath);
  if (!isContained(canonicalRoot, parent.real)) {
    throw new Error(`destination resolves outside temporary root: ${destination}`);
  }
  await mkdir(parentPath, { recursive: true, mode: 0o700 });
  const canonicalParent = await realpath(parentPath);
  if (!isContained(canonicalRoot, canonicalParent)) {
    throw new Error(`destination resolves outside temporary root: ${destination}`);
  }

  const payload = await readFile(source);
  if (validateJson || destinationPath.endsWith('.json')) {
    try {
      JSON.parse(payload.toString('utf8'));
    } catch {
      throw new Error('source payload is not valid JSON');
    }
  }

  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, destinationPath);
    await chmod(destinationPath, 0o600);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return {
    sourcePath: resolve(source),
    destinationPath,
    bytes: payload.byteLength,
    sha256: createHash('sha256').update(payload).digest('hex'),
  };
}

export function parseSafeCommandPayloadArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const value = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    help: false,
    source: value('--source'),
    destination: value('--destination'),
    tempRoot: value('--temp-root'),
    validateJson: argv.includes('--json'),
  };
}

async function main() {
  const options = parseSafeCommandPayloadArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${SAFE_COMMAND_PAYLOAD_HELP}\n`);
    return;
  }
  const result = await stageCommandPayload(options);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`safe-command-payload: ${error.message}\n`);
    process.exitCode = 1;
  });
}
