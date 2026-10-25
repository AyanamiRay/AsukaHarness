import { appendFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

import { fileSize } from './settings-store.js';

const MAX_LOG_BYTES = 2 * 1024 * 1024;

const format = (value) => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * Append-only text logger with a single rotation slot.
 *
 * Logging must never take the app down, so every filesystem call is guarded.
 */
export function createLogger(file, { scope = 'shell', mirror = true } = {}) {
  const prefix = scope ? `[${scope}]` : '';

  const write = (level, args) => {
    const line = `${new Date().toISOString()} ${level} ${prefix} ${args.map(format).join(' ')}\n`;
    try {
      mkdirSync(dirname(file), { recursive: true });
      if (fileSize(file) > MAX_LOG_BYTES) renameSync(file, `${file}.1`);
      appendFileSync(file, line, 'utf8');
    } catch {
      /* ignore */
    }
    if (mirror) {
      const sink = level === 'ERROR' ? console.error : console.log;
      sink(line.trimEnd());
    }
  };

  return {
    file,
    info: (...args) => write('INFO', args),
    warn: (...args) => write('WARN', args),
    error: (...args) => write('ERROR', args),
    child: (childScope) => createLogger(file, { scope: childScope, mirror }),
  };
}
