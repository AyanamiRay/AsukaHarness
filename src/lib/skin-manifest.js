import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

/**
 * Skin packages
 * =============
 *
 * A skin is a directory containing `skin.json` and (optionally) one background
 * image and one CSS file:
 *
 *     skins/aurora/
 *       skin.json
 *       background.jpg
 *       custom.css        (optional, loaded verbatim)
 *
 * `skin.json`:
 *
 *     {
 *       "name": "极光",
 *       "description": "深蓝到青绿的渐变",
 *       "image": "background.jpg",
 *       "size": "cover",            // cover | contain | tile
 *       "position": "center",       // any CSS background-position
 *       "blur": 0,                  // 0..40 px
 *       "dim": 0.28,                // 0..0.95, tint opacity
 *       "tint": "#060913",          // veil colour
 *       "transparentRoot": true,    // also clear the app's outer containers
 *       "css": "custom.css"         // optional extra CSS
 *     }
 *
 * Axes are intentionally narrow: everything maps onto a CSS custom property,
 * so switching skins is a style write, never a page reload.
 */

export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const SIZES = new Set(['cover', 'contain', 'tile']);
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const POSITION_RE = /^[a-z0-9.% -]{1,40}$/i;

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

function insideDirectory(dir, file) {
  const base = resolve(dir) + sep;
  return resolve(file).startsWith(base);
}

export class SkinError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SkinError';
  }
}

/**
 * Validate raw `skin.json` data and resolve its assets.
 * @param {object} raw parsed JSON
 * @param {{id: string, dir: string, source?: string}} context
 */
export function normalizeSkin(raw, { id, dir, source = 'builtin' }) {
  if (!isPlainObject(raw)) throw new SkinError('skin.json must contain an object');
  if (!ID_RE.test(id)) throw new SkinError(`invalid skin id: ${id}`);

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';

  let imagePath = null;
  if (typeof raw.image === 'string' && raw.image.trim()) {
    const candidate = resolve(dir, raw.image);
    if (!insideDirectory(dir, candidate)) throw new SkinError('image must stay inside the skin directory');
    if (!IMAGE_EXTENSIONS.has(extname(candidate).toLowerCase())) {
      throw new SkinError(`unsupported image type: ${extname(candidate)}`);
    }
    imagePath = candidate;
  }

  let cssPath = null;
  if (typeof raw.css === 'string' && raw.css.trim()) {
    const candidate = resolve(dir, raw.css);
    if (!insideDirectory(dir, candidate)) throw new SkinError('css must stay inside the skin directory');
    cssPath = candidate;
  }

  const size = typeof raw.size === 'string' && SIZES.has(raw.size) ? raw.size : 'cover';
  const position =
    typeof raw.position === 'string' && POSITION_RE.test(raw.position) ? raw.position : 'center';
  const tint = typeof raw.tint === 'string' && HEX_RE.test(raw.tint) ? raw.tint : '#000000';

  return {
    id,
    dir,
    source,
    name,
    description,
    imagePath,
    cssPath,
    size,
    position,
    blur: Math.round(clamp(raw.blur, 0, 40, 0) * 10) / 10,
    dim: Math.round(clamp(raw.dim, 0, 0.95, 0.25) * 1000) / 1000,
    tint,
    transparentRoot:
      typeof raw.transparentRoot === 'boolean' ? raw.transparentRoot : true,
  };
}

/** Read one skin directory; throws `SkinError` when it is not a valid skin. */
export function readSkin(dir, { source = 'builtin' } = {}) {
  const manifestPath = join(dir, 'skin.json');
  let raw;
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new SkinError(`cannot read ${manifestPath}: ${error.message}`);
  }
  const id = raw?.id && ID_RE.test(raw.id) ? raw.id : dir.split(/[\\/]/).pop();
  const skin = normalizeSkin(raw, { id, dir, source });
  if (skin.imagePath && !existsSync(skin.imagePath)) {
    throw new SkinError(`missing image: ${skin.imagePath}`);
  }
  if (skin.cssPath && !existsSync(skin.cssPath)) {
    throw new SkinError(`missing css: ${skin.cssPath}`);
  }
  return skin;
}

/**
 * Scan skin roots in order. Later roots override earlier ones by id, so a user
 * skin can replace a built-in skin without renaming it.
 *
 * @param {{dir: string, source?: string}[]} roots
 * @returns {{skins: object[], warnings: {dir: string, message: string}[]}}
 */
export function discoverSkins(roots) {
  const byId = new Map();
  const warnings = [];

  for (const root of roots) {
    let entries = [];
    try {
      if (!existsSync(root.dir)) continue;
      entries = readdirSync(root.dir, { withFileTypes: true });
    } catch (error) {
      warnings.push({ dir: root.dir, message: error.message });
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(root.dir, entry.name);
      if (!existsSync(join(dir, 'skin.json'))) continue;
      try {
        const skin = readSkin(dir, { source: root.source ?? 'builtin' });
        byId.set(skin.id, skin);
      } catch (error) {
        warnings.push({ dir, message: error.message });
      }
    }
  }

  const skins = [...byId.values()].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });

  return { skins, warnings };
}

/** Last-modified timestamp used to bust the wallpaper data-URL cache. */
export function skinMtime(skin) {
  if (!skin.imagePath) return 0;
  try {
    return statSync(skin.imagePath).mtimeMs;
  } catch {
    return 0;
  }
}
