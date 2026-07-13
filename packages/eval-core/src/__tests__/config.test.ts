import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { getDefaultConfig } from '../types/config.js';

describe('getDefaultConfig', () => {
  it('uses the canonical oh-my-customcodex evaluation database', () => {
    expect(getDefaultConfig().sqlitePath).toBe(
      `${homedir()}/.oh-my-customcodex/eval-core.sqlite`
    );
  });
});
