import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Locate the `dsh` CLI.
 *
 * The shell never ships DSH: the user installs `@deepseek-ai/dsh` with npm and
 * the shell only starts `dsh web`. Resolution order, most explicit first:
 *
 *   1. `settings.dshCommand`
 *   2. `$DSH_BIN`
 *   3. `dsh` on `PATH`
 *   4. well-known install locations
 */

export function whichSync(command, { platform = process.platform, env = process.env } = {}) {
  const finder = platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(finder, [command], { encoding: 'utf8', env, windowsHide: true });
  if (result.error || result.status !== 0 || !result.stdout) return null;
  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first ?? null;
}

export function candidatePaths({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (platform === 'win32') {
    const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
    return [join(appData, 'npm', 'dsh.cmd'), join(appData, 'npm', 'dsh.exe')];
  }
  return [
    join(home, '.local', 'bin', 'dsh'),
    join(home, 'bin', 'dsh'),
    join(home, '.npm-global', 'bin', 'dsh'),
    '/usr/local/bin/dsh',
    '/opt/homebrew/bin/dsh',
  ];
}

/**
 * @returns {{command: string|null, source: string|null, tried: string[]}}
 */
export function locateDsh({
  explicit = null,
  env = process.env,
  platform = process.platform,
  home = homedir(),
  exists = existsSync,
  which = (name) => whichSync(name, { platform, env }),
} = {}) {
  const tried = [];
  const accept = (candidate, source) => {
    if (!candidate || typeof candidate !== 'string') return null;
    const value = candidate.trim();
    if (!value) return null;
    tried.push(value);
    if (source === 'path') return { command: value, source, tried };
    return exists(value) ? { command: value, source, tried } : null;
  };

  const fromSettings = accept(explicit, 'settings');
  if (fromSettings) return fromSettings;

  const fromEnv = accept(env.DSH_BIN, 'env');
  if (fromEnv) return fromEnv;

  const fromPath = accept(which('dsh'), 'path');
  if (fromPath) return fromPath;

  for (const candidate of candidatePaths({ platform, env, home })) {
    const hit = accept(candidate, 'common');
    if (hit) return hit;
  }

  return { command: null, source: null, tried };
}
