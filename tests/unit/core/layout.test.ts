import { describe, expect, it } from 'bun:test';
import {
  getComponentPath,
  getEntryTemplateName,
  getProviderLayout,
  getTemplateComponentPath,
} from '../../../src/core/layout.js';

describe('provider layout', () => {
  it('uses codex as the default runtime layout', () => {
    const layout = getProviderLayout();

    expect(layout.provider).toBe('codex');
    expect(layout.rootDir).toBe('.codex');
    expect(layout.templateRootDir).toBe('.claude');
    expect(layout.entryFile).toBe('AGENTS.md');
    expect(layout.entryTemplatePrefix).toBe('AGENTS.md');
  });

  it('keeps template and target component paths separate for codex', () => {
    expect(getComponentPath('skills')).toBe('.agents/skills');
    expect(getTemplateComponentPath('skills')).toBe('.claude/skills');
    expect(getComponentPath('entry-md')).toBe('AGENTS.md');
    expect(getEntryTemplateName('en')).toBe('AGENTS.md.en');
  });

  it('still supports the claude layout explicitly', () => {
    const layout = getProviderLayout('claude');

    expect(layout.provider).toBe('claude');
    expect(layout.rootDir).toBe('.claude');
    expect(layout.entryFile).toBe('CLAUDE.md');
    expect(getComponentPath('skills', 'claude')).toBe('.claude/skills');
    expect(getTemplateComponentPath('skills', 'claude')).toBe('.claude/skills');
    expect(getEntryTemplateName('ko', 'claude')).toBe('CLAUDE.md.ko');
  });
});
