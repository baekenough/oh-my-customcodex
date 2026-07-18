#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function createOfflineEvidencePath({
  temporaryRoot = tmpdir(),
  processId = process.pid,
  nonce = randomUUID(),
} = {}) {
  return join(temporaryRoot, `omcustomcodex-release-evidence-${processId}-${nonce}`);
}

export function runOfflineReleaseVerification({
  evidenceDir = createOfflineEvidencePath(),
  executable = process.execPath,
  environment = process.env,
} = {}) {
  const verifier = fileURLToPath(new URL('./verify-release-contract.mjs', import.meta.url));
  const result = spawnSync(
    executable,
    [verifier, '--mode', 'offline', '--evidence-dir', evidenceDir],
    {
      env: environment,
      stdio: 'inherit',
    }
  );

  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`Offline release verification terminated by ${result.signal}.`);
  }
  return result.status ?? 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (invokedPath === import.meta.url) {
  process.exitCode = runOfflineReleaseVerification();
}
