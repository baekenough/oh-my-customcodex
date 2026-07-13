export interface EvalCoreConfig {
  dbDriver: 'sqlite';
  sqlitePath: string;
  tokenEstimation: boolean;
}

export function getDefaultConfig(): EvalCoreConfig {
  return {
    dbDriver: 'sqlite',
    sqlitePath: resolveHome('~/.oh-my-customcodex/eval-core.sqlite'),
    tokenEstimation: true,
  };
}

function resolveHome(path: string): string {
  if (path.startsWith('~/')) {
    return path.replace('~', homedir());
  }
  return path;
}
import { homedir } from 'node:os';
