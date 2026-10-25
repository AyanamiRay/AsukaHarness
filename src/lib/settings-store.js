import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { DEFAULT_SETTINGS, normalizeSettings } from './config.js';

/**
 * Tiny JSON store with debounced, atomic writes.
 *
 * The file is read once at startup; a corrupt file is ignored rather than
 * fatal, so users can always recover by deleting it.
 */
export class SettingsStore {
  #file;
  #data;
  #timer = null;
  #logger;

  constructor(file, logger = null) {
    this.#file = file;
    this.#data = normalizeSettings(DEFAULT_SETTINGS);
    this.#logger = logger;
  }

  get file() {
    return this.#file;
  }

  load() {
    try {
      if (existsSync(this.#file)) {
        const raw = JSON.parse(readFileSync(this.#file, 'utf8'));
        this.#data = normalizeSettings(raw);
      }
    } catch (error) {
      this.#logger?.warn?.(`settings: cannot read ${this.#file}: ${error.message}`);
    }
    return this.#data;
  }

  get() {
    return this.#data;
  }

  patch(patch) {
    this.#data = normalizeSettings({
      ...this.#data,
      ...patch,
      window: { ...this.#data.window, ...(patch?.window ?? {}) },
    });
    this.#schedule();
    return this.#data;
  }

  saveNow() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    try {
      mkdirSync(dirname(this.#file), { recursive: true });
      const tmp = `${this.#file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(this.#data, null, 2)}\n`, 'utf8');
      renameSync(tmp, this.#file);
    } catch (error) {
      this.#logger?.warn?.(`settings: cannot write ${this.#file}: ${error.message}`);
    }
  }

  #schedule() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.saveNow();
    }, 250);
    this.#timer.unref?.();
  }
}

/** Return the size of a file in bytes, or 0 when it is missing. */
export function fileSize(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}
