/**
 * Provider detection for Codex and Claude layouts.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { getProviderLayout, type Provider } from './layout.js';

export type DetectionSource = 'default' | 'filesystem';
export type DetectionConfidence = 'high';

export interface ProviderDetection {
  provider: Provider;
  source: DetectionSource;
  confidence: DetectionConfidence;
  reason: string;
}

export interface DetectProviderOptions {
  targetDir?: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectProvider(
  options: DetectProviderOptions = {}
): Promise<ProviderDetection> {
  const targetDir = options.targetDir;

  if (targetDir) {
    const codexLayout = getProviderLayout('codex');
    const claudeLayout = getProviderLayout('claude');

    const hasCodexRoot = await pathExists(join(targetDir, codexLayout.rootDir));
    const hasCodexEntry = await pathExists(join(targetDir, codexLayout.entryFile));
    if (hasCodexRoot || hasCodexEntry) {
      return {
        provider: 'codex',
        source: 'filesystem',
        confidence: 'high',
        reason: 'codex-runtime-found',
      };
    }

    const hasClaudeRoot = await pathExists(join(targetDir, claudeLayout.rootDir));
    const hasClaudeEntry = await pathExists(join(targetDir, claudeLayout.entryFile));
    if (hasClaudeRoot || hasClaudeEntry) {
      return {
        provider: 'claude',
        source: 'filesystem',
        confidence: 'high',
        reason: 'claude-runtime-found',
      };
    }
  }

  return {
    provider: 'codex',
    source: 'default',
    confidence: 'high',
    reason: 'codex-default',
  };
}
