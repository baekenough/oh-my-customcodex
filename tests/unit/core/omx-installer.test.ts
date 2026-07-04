import { describe, expect, it } from 'bun:test';
import {
  assessOmxInstallation,
  compareOmxVersions,
  type InstallerDeps,
  isOmxVersionAtLeast,
  parseOmxVersion,
} from '../../../src/core/omx-installer.ts';

function depsFor(commands: Record<string, string | Error>): InstallerDeps {
  return {
    exec: (cmd: string) => {
      const result = commands[cmd];
      if (result instanceof Error || result === undefined) {
        throw result ?? new Error(`Unexpected command: ${cmd}`);
      }
      return result;
    },
    getPlatform: () => 'linux',
  };
}

describe('omx installer baseline checks', () => {
  it('parses oh-my-codex version output', () => {
    expect(parseOmxVersion('oh-my-codex v0.18.17')).toBe('0.18.17');
    expect(parseOmxVersion('0.18.18')).toBe('0.18.18');
    expect(parseOmxVersion('oh-my-codex v0.19.0-beta.1')).toBe('0.19.0-beta.1');
    expect(parseOmxVersion('unknown')).toBeNull();
  });

  it('compares semantic versions with prereleases below final releases', () => {
    expect(compareOmxVersions('0.18.18', '0.18.17')).toBe(1);
    expect(compareOmxVersions('0.18.16', '0.18.17')).toBe(-1);
    expect(compareOmxVersions('0.18.17-beta.1', '0.18.17')).toBe(-1);
    expect(compareOmxVersions('0.18.17', '0.18.17')).toBe(0);
    expect(isOmxVersionAtLeast('oh-my-codex v0.18.17')).toBe(true);
  });

  it('marks missing omx as missing', () => {
    const result = assessOmxInstallation(depsFor({ 'which omx': new Error('missing') }));

    expect(result.status).toBe('missing');
    expect(result.installed).toBe(false);
  });

  it('marks pre-0.18.17 omx as stale without probing api', () => {
    const result = assessOmxInstallation(
      depsFor({
        'which omx': '/usr/local/bin/omx',
        'omx --version': 'oh-my-codex v0.18.16',
      })
    );

    expect(result.status).toBe('stale');
    expect(result.parsedVersion).toBe('0.18.16');
    expect(result.hasApiCommand).toBe(false);
  });

  it('marks a new enough omx without api as api-missing', () => {
    const result = assessOmxInstallation(
      depsFor({
        'which omx': '/usr/local/bin/omx',
        'omx --version': 'oh-my-codex v0.18.17',
        'omx api --help': new Error('unknown command'),
      })
    );

    expect(result.status).toBe('api-missing');
    expect(result.installed).toBe(true);
  });

  it('marks v0.18.17 with omx api as ready', () => {
    const result = assessOmxInstallation(
      depsFor({
        'which omx': '/usr/local/bin/omx',
        'omx --version': 'oh-my-codex v0.18.17',
        'omx api --help': 'Usage: omx api',
      })
    );

    expect(result.status).toBe('ready');
    expect(result.hasApiCommand).toBe(true);
  });
});
