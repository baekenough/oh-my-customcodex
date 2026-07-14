import { describe, expect, it } from 'bun:test';
import {
  assessOmxInstallation,
  compareOmxVersions,
  type InstallerDeps,
  isOmxVersionAtLeast,
  MINIMUM_OMX_VERSION,
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

const invalidOmxVersionOutputs = [
  'not-oh-my-codex v0.20.1',
  'oh-my-codex v0.20.1+..',
  'oh-my-codex v0.20.1_garbage',
  'prefix oh-my-codex v0.20.1',
  'oh-my-codex v0.20.1 suffix',
  'oh-my-codex v0.20.1-alpha..1',
  'oh-my-codex v0.20.1+build.',
  'oh-my-codex v00.20.1',
  '00.20.1',
  'oh-my-codex v0.020.1',
  '0.020.1',
  'oh-my-codex v0.20.01',
  '0.20.01',
  'oh-my-codex v0.20.1-01',
  '0.20.1-01',
] as const;

describe('omx installer baseline checks', () => {
  it('parses oh-my-codex version output', () => {
    expect(parseOmxVersion('oh-my-codex v0.19.0')).toBe('0.19.0');
    expect(parseOmxVersion('0.18.18')).toBe('0.18.18');
    expect(parseOmxVersion('v0.18.18')).toBe('0.18.18');
    expect(parseOmxVersion('oh-my-codex v0.19.0-beta.1')).toBe('0.19.0-beta.1');
    expect(parseOmxVersion('\t oh-my-codex v0.20.1-beta.1+build.7 \t')).toBe(
      '0.20.1-beta.1+build.7'
    );
    expect(parseOmxVersion('oh-my-codex v0.20.1-0')).toBe('0.20.1-0');
    expect(parseOmxVersion('0.20.1-rc.1')).toBe('0.20.1-rc.1');
    expect(parseOmxVersion('v0.20.1+001')).toBe('0.20.1+001');
    expect(parseOmxVersion('Node.js v22.17.0\noh-my-codex v0.20.1')).toBe('0.20.1');
    expect(parseOmxVersion('Node.js v22.17.0')).toBeNull();
    expect(parseOmxVersion('oh-my-codex version unavailable')).toBeNull();
    expect(parseOmxVersion('unknown')).toBeNull();
  });

  it('rejects malformed or non-official version output', () => {
    for (const versionOutput of invalidOmxVersionOutputs) {
      expect(parseOmxVersion(versionOutput)).toBeNull();
    }
  });

  it('rejects a long malformed prerelease suffix without accepting a version prefix', () => {
    const versionOutput = `oh-my-codex v0.20.1-${'a'.repeat(10_000)}_`;

    expect(parseOmxVersion(versionOutput)).toBeNull();
  });

  it('compares semantic versions with prereleases below final releases', () => {
    expect(compareOmxVersions('0.19.1', '0.19.0')).toBe(1);
    expect(compareOmxVersions('0.18.17', '0.19.0')).toBe(-1);
    expect(compareOmxVersions('0.19.0-beta.1', '0.19.0')).toBe(-1);
    expect(compareOmxVersions('0.19.0', '0.19.0')).toBe(0);
    expect(isOmxVersionAtLeast('oh-my-codex v0.19.0', '0.19.0')).toBe(true);
  });

  it('requires the OMX v0.20.1 runtime boundary', () => {
    expect(MINIMUM_OMX_VERSION).toBe('0.20.1');
    expect(isOmxVersionAtLeast('oh-my-codex v0.20.0')).toBe(false);
    expect(isOmxVersionAtLeast('oh-my-codex v0.20.1-beta.1')).toBe(false);
    expect(isOmxVersionAtLeast('oh-my-codex v0.20.1')).toBe(true);
    expect(isOmxVersionAtLeast('oh-my-codex v0.20.2')).toBe(true);
  });

  it('marks missing omx as missing', () => {
    const result = assessOmxInstallation(depsFor({ 'which omx': new Error('missing') }));

    expect(result.status).toBe('missing');
    expect(result.installed).toBe(false);
  });

  it('marks v0.20.0 omx as stale without probing api', () => {
    const result = assessOmxInstallation(
      depsFor({
        'which omx': '/usr/local/bin/omx',
        'omx --version': 'oh-my-codex v0.20.0',
      })
    );

    expect(result.status).toBe('stale');
    expect(result.parsedVersion).toBe('0.20.0');
    expect(result.minimumVersion).toBe('0.20.1');
    expect(result.hasApiCommand).toBe(false);
  });

  it('marks a new enough omx without api as api-missing', () => {
    const result = assessOmxInstallation(
      depsFor({
        'which omx': '/usr/local/bin/omx',
        'omx --version': 'oh-my-codex v0.20.1',
        'omx api --help': new Error('unknown command'),
      })
    );

    expect(result.status).toBe('api-missing');
    expect(result.installed).toBe(true);
  });

  it('marks unparseable version output as unknown even when omx api is available', () => {
    const result = assessOmxInstallation(
      depsFor({
        'which omx': '/usr/local/bin/omx',
        'omx --version': 'Node.js v22.17.0',
        'omx api --help': 'Usage: omx api',
      })
    );

    expect(result.status).toBe('unknown-version');
    expect(result.parsedVersion).toBeNull();
    expect(result.hasApiCommand).toBe(true);
  });

  it('never marks malformed or non-official version output ready when omx api is available', () => {
    for (const versionOutput of invalidOmxVersionOutputs) {
      const result = assessOmxInstallation(
        depsFor({
          'which omx': '/usr/local/bin/omx',
          'omx --version': versionOutput,
          'omx api --help': 'Usage: omx api',
        })
      );

      expect(result.status).toBe('unknown-version');
      expect(result.parsedVersion).toBeNull();
      expect(result.hasApiCommand).toBe(true);
    }
  });

  it('marks version command failures as unknown even when omx api is available', () => {
    const result = assessOmxInstallation(
      depsFor({
        'which omx': '/usr/local/bin/omx',
        'omx --version': new Error('version command failed'),
        'omx api --help': 'Usage: omx api',
      })
    );

    expect(result.status).toBe('unknown-version');
    expect(result.version).toBeNull();
    expect(result.parsedVersion).toBeNull();
    expect(result.hasApiCommand).toBe(true);
  });

  it('marks v0.20.1 with omx api as ready', () => {
    const result = assessOmxInstallation(
      depsFor({
        'which omx': '/usr/local/bin/omx',
        'omx --version': 'oh-my-codex v0.20.1',
        'omx api --help': 'Usage: omx api',
      })
    );

    expect(result.status).toBe('ready');
    expect(result.hasApiCommand).toBe(true);
  });
});
