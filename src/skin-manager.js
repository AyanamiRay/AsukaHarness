import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { nativeImage, shell } from 'electron';

import { SKIN_BASE_CSS, skinVariables } from './lib/skin-css.js';
import { discoverSkins, IMAGE_EXTENSIONS, skinMtime } from './lib/skin-manifest.js';

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;

const fileMtime = (path) => {
  if (!path) return 0;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};

const slugify = (input) => {
  const slug = String(input)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || `skin-${Date.now().toString(36)}`;
};

/**
 * Discovers skins, serves thumbnails, and pushes the active skin into the page.
 *
 * Visuals are applied through CSS custom properties plus one class on
 * `<html>`; switching skins never reloads the DSH UI.
 */
export class SkinManager {
  #builtinDir;
  #userDir;
  #logger;
  #skins = new Map();
  #warnings = [];
  #cache = new Map();
  #thumbCache = new Map();
  #enabled;
  #current;
  #transparentRoot;
  #pageState = new WeakMap();

  constructor({ builtinDir, userDir, logger, enabled = true, current = 'aurora', transparentRoot = true }) {
    this.#builtinDir = builtinDir;
    this.#userDir = userDir;
    this.#logger = logger;
    this.#enabled = enabled;
    this.#current = current;
    this.#transparentRoot = transparentRoot;
  }

  get enabled() {
    return this.#enabled;
  }

  setEnabled(value) {
    this.#enabled = Boolean(value);
  }

  setTransparentRoot(value) {
    this.#transparentRoot = Boolean(value);
  }

  refresh() {
    const { skins, warnings } = discoverSkins([
      { dir: this.#builtinDir, source: 'builtin' },
      { dir: this.#userDir, source: 'user' },
    ]);
    this.#skins = new Map(skins.map((skin) => [skin.id, skin]));
    this.#warnings = warnings;
    for (const warning of warnings) this.#logger?.warn?.(`skin: ${warning.dir}: ${warning.message}`);

    if (!this.#skins.has(this.#current)) {
      this.#current = skins[0]?.id ?? null;
      if (this.#current) this.#logger?.warn?.(`skin: fallback to "${this.#current}"`);
    }
    return this.list();
  }

  get warnings() {
    return this.#warnings;
  }

  get currentId() {
    return this.#current;
  }

  current() {
    return this.#current ? this.#skins.get(this.#current) ?? null : null;
  }

  setCurrent(id) {
    if (!this.#skins.has(id)) throw new Error(`unknown skin: ${id}`);
    this.#current = id;
    return this.current();
  }

  /** Metadata for the picker, including a resized data-URL thumbnail. */
  list() {
    const skins = [...this.#skins.values()].map((skin) => ({
      id: skin.id,
      name: skin.name,
      description: skin.description,
      source: skin.source,
      hasImage: Boolean(skin.imagePath),
      thumb: this.#thumbnail(skin),
    }));
    return {
      skins,
      current: this.#current,
      enabled: this.#enabled,
      transparentRoot: this.#transparentRoot,
      userDir: this.#userDir,
      warnings: this.#warnings,
    };
  }

  #thumbnail(skin) {
    if (!skin.imagePath) return null;
    const mtime = skinMtime(skin);
    const cached = this.#thumbCache.get(skin.imagePath);
    if (cached && cached.mtime === mtime) return cached.url;
    try {
      const image = nativeImage.createFromPath(skin.imagePath);
      if (image.isEmpty()) return null;
      const { width } = image.getSize();
      const resized = width > 480 ? image.resize({ width: 480, quality: 'good' }) : image;
      const url = resized.toDataURL();
      this.#thumbCache.set(skin.imagePath, { mtime, url });
      return url;
    } catch (error) {
      this.#logger?.warn?.(`skin: thumbnail failed for ${skin.id}: ${error.message}`);
      return null;
    }
  }

  #imageUrl(skin) {
    if (!skin.imagePath) return null;
    const mtime = skinMtime(skin);
    const cached = this.#cache.get(skin.imagePath);
    if (cached && cached.mtime === mtime && cached.size) return cached.url;

    const buffer = readFileSync(skin.imagePath);
    if (buffer.byteLength > MAX_WALLPAPER_BYTES) {
      this.#logger?.warn?.(`skin: ${skin.id} image is larger than 20 MB; using it anyway`);
    }
    const mime = MIME[extname(skin.imagePath).toLowerCase()] ?? 'image/jpeg';
    const url = `data:${mime};base64,${buffer.toString('base64')}`;
    this.#cache.set(skin.imagePath, { mtime, url, size: buffer.byteLength });
    return url;
  }

  /** Reset per-document state after a navigation. */
  resetPage(webContents) {
    this.#pageState.delete(webContents);
  }

  /**
   * Apply (or clear) the active skin on one page.
   * Safe to call repeatedly; used on navigation and on every skin change.
   */
  async apply(webContents) {
    if (!webContents || webContents.isDestroyed()) return;
    const state = this.#pageState.get(webContents) ?? { base: false, custom: null, applied: null };
    this.#pageState.set(webContents, state);

    if (!state.base) {
      try {
        await webContents.insertCSS(SKIN_BASE_CSS, { cssOrigin: 'user' });
        state.base = true;
      } catch (error) {
        this.#logger?.warn?.(`skin: base css failed: ${error.message}`);
      }
    }

    const skin = this.current();
    const transparent = Boolean(skin?.transparentRoot && this.#transparentRoot);
    // Re-applying the same skin (window focus, zoom, config toggle) is a no-op:
    // the wallpaper is a multi-megabyte data URL and should cross IPC once.
    const signature =
      !this.#enabled || !skin
        ? 'off'
        : [
            skin.id,
            fileMtime(join(skin.dir, 'skin.json')),
            fileMtime(skin.imagePath),
            fileMtime(skin.cssPath),
            transparent,
          ].join('|');
    if (state.applied === signature) return;

    if (state.custom) {
      try {
        await webContents.removeInsertedCSS(state.custom);
      } catch {
        /* document already replaced */
      }
      state.custom = null;
    }

    if (!this.#enabled || !skin) {
      try {
        await webContents.executeJavaScript(
          `document.documentElement.classList.remove('dsh-skin-on','dsh-skin-transparent-root')`,
          true,
        );
        state.applied = signature;
      } catch {
        /* page not ready */
      }
      return;
    }

    const variables = skinVariables(skin, this.#imageUrl(skin));
    const script = `(() => {
      const root = document.documentElement;
      const vars = ${JSON.stringify(variables)};
      for (const key of Object.keys(vars)) root.style.setProperty(key, vars[key]);
      root.classList.add('dsh-skin-on');
      root.classList.toggle('dsh-skin-transparent-root', ${transparent});
      root.dataset.dshSkin = ${JSON.stringify(skin.id)};
    })()`;

    try {
      await webContents.executeJavaScript(script, true);
      state.applied = signature;
    } catch (error) {
      this.#logger?.warn?.(`skin: apply failed: ${error.message}`);
      return;
    }

    if (skin.cssPath) {
      try {
        state.custom = await webContents.insertCSS(readFileSync(skin.cssPath, 'utf8'), {
          cssOrigin: 'user',
        });
      } catch (error) {
        this.#logger?.warn?.(`skin: custom css failed: ${error.message}`);
      }
    }
  }

  /**
   * Copy an image into the user skin directory and register it as a skin.
   * @returns {string} the new skin id
   */
  importImage(file) {
    if (!existsSync(file)) throw new Error('file does not exist');
    const extension = extname(file).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) throw new Error(`unsupported image type: ${extension}`);

    const id = slugify(file.split(/[\\/]/).pop().replace(extension, ''));
    const dir = join(this.#userDir, id);
    mkdirSync(dir, { recursive: true });
    copyFileSync(file, join(dir, `background${extension}`));
    writeFileSync(
      join(dir, 'skin.json'),
      `${JSON.stringify(
        {
          name: id,
          description: '导入的本地图片',
          image: `background${extension}`,
          size: 'cover',
          position: 'center',
          blur: 0,
          dim: 0.3,
          tint: '#000000',
          transparentRoot: true,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    this.refresh();
    return id;
  }

  async openFolder() {
    mkdirSync(this.#userDir, { recursive: true });
    await shell.openPath(this.#userDir);
  }
}
