/**
 * Provider-aware layout and component mapping.
 */

/**
 * Components that can be installed
 */
export type InstallComponent =
  | 'entry-md'
  | 'rules'
  | 'agents'
  | 'skills'
  | 'guides'
  | 'hooks'
  | 'contexts'
  | 'ontology';

export type Provider = 'codex' | 'claude';

export interface ProviderLayout {
  provider: Provider;
  rootDir: string;
  templateRootDir: string;
  entryFile: string;
  entryTemplatePrefix: string;
  manifestFile: string;
  backupDirPrefix: string;
  directoryStructure: string[];
}

const CODEX_LAYOUT: ProviderLayout = {
  provider: 'codex',
  rootDir: '.codex',
  templateRootDir: '.claude',
  entryFile: 'AGENTS.md',
  entryTemplatePrefix: 'AGENTS.md',
  manifestFile: 'manifest.json',
  backupDirPrefix: '.codex-backup-',
  directoryStructure: [
    '.codex',
    '.codex/rules',
    '.codex/hooks',
    '.codex/contexts',
    '.codex/agents',
    '.codex/ontology',
    '.agents',
    '.agents/skills',
    'guides',
  ],
};

const CLAUDE_LAYOUT: ProviderLayout = {
  provider: 'claude',
  rootDir: '.claude',
  templateRootDir: '.claude',
  entryFile: 'CLAUDE.md',
  entryTemplatePrefix: 'CLAUDE.md',
  manifestFile: 'manifest.json',
  backupDirPrefix: '.claude-backup-',
  directoryStructure: [
    '.claude',
    '.claude/rules',
    '.claude/hooks',
    '.claude/contexts',
    '.claude/agents',
    '.claude/skills',
    '.claude/ontology',
    'guides',
  ],
};

export function getProviderLayout(provider: Provider = 'codex'): ProviderLayout {
  return provider === 'claude' ? CLAUDE_LAYOUT : CODEX_LAYOUT;
}

export function getEntryTemplateName(language: 'en' | 'ko', provider: Provider = 'codex'): string {
  const layout = getProviderLayout(provider);
  return `${layout.entryTemplatePrefix}.${language}`;
}

export function getComponentPath(
  component: InstallComponent,
  provider: Provider = 'codex'
): string {
  const layout = getProviderLayout(provider);

  if (component === 'entry-md') {
    return layout.entryFile;
  }

  if (component === 'guides') {
    return 'guides';
  }

  if (provider === 'codex' && component === 'skills') {
    return '.agents/skills';
  }

  return `${layout.rootDir}/${component}`;
}

export function getTemplateComponentPath(
  component: InstallComponent,
  provider: Provider = 'codex'
): string {
  const layout = getProviderLayout(provider);

  if (component === 'entry-md') {
    return layout.entryTemplatePrefix;
  }

  if (component === 'guides') {
    return 'guides';
  }

  return `${layout.templateRootDir}/${component}`;
}
