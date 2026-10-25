/**
 * Settings schema and normalization.
 *
 * Everything the shell persists lives in a single JSON file inside the
 * Electron userData directory. `normalizeSettings` is the only place that
 * trusts (or rather, distrusts) that file: a hand-edited or half-written
 * settings file must never crash the shell.
 */

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  version: SETTINGS_VERSION,
  /** Explicit path to the `dsh` executable. `null` means auto-detect. */
  dshCommand: null,
  /** Working directory for `dsh web`; `null` means the user's home. */
  workspace: null,
  /** Loopback host the web server binds to. */
  host: '127.0.0.1',
  /** Fixed port; `null` picks a free one on every launch. */
  port: null,
  /** Extra argv appended to `dsh web ...`. */
  extraArgs: [],
  /**
   * Attach to an already running `dsh web` instead of spawning one.
   * Useful when DSH runs in a terminal, in a container, or on another host.
   */
  attachUrl: null,
  /** Active skin id. */
  skin: 'aurora',
  /** Global switch for the wallpaper layer. */
  skinEnabled: true,
  /** Also make the app's outer containers transparent so the wallpaper shows. */
  transparentRoot: true,
  /** Hide to tray instead of quitting when the window closes. */
  closeToTray: true,
  /** Toggle shortcut; empty string disables it. */
  globalShortcut: 'CommandOrControl+Shift+Space',
  /** Hide the Electron token from `navigator.userAgent`. */
  spoofBrowserUA: true,
  /** Register the `dsh://` scheme for this shell (off by default: the official
   *  desktop app may own it already). */
  registerProtocol: false,
  zoomFactor: 1,
  window: {
    width: 1280,
    height: 820,
    x: null,
    y: null,
    maximized: false,
  },
});

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

const optionalInt = (value, min, max) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
};

const text = (value, fallback = null) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

const httpUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

const SKIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Coerce arbitrary parsed JSON into a complete, valid settings object.
 * Unknown keys are dropped; invalid values fall back to defaults.
 */
export function normalizeSettings(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const window = isPlainObject(source.window) ? source.window : {};
  const defaults = DEFAULT_SETTINGS;

  const shortcut =
    source.globalShortcut === '' ? '' : text(source.globalShortcut, defaults.globalShortcut);

  const extraArgs = Array.isArray(source.extraArgs)
    ? source.extraArgs
        .filter((arg) => typeof arg === 'string' && arg.length > 0 && !/[\r\n]/.test(arg))
        .slice(0, 32)
    : [];

  const skin = text(source.skin, defaults.skin);
  const safeSkin = skin && SKIN_ID_RE.test(skin) ? skin : defaults.skin;

  const host = text(source.host, defaults.host);
  const safeHost = host && !/\s/.test(host) ? host : defaults.host;

  return {
    version: SETTINGS_VERSION,
    dshCommand: text(source.dshCommand, null),
    workspace: text(source.workspace, null),
    host: safeHost,
    port: optionalInt(source.port, 1, 65535),
    extraArgs,
    attachUrl: httpUrl(source.attachUrl),
    skin: safeSkin,
    skinEnabled: bool(source.skinEnabled, defaults.skinEnabled),
    transparentRoot: bool(source.transparentRoot, defaults.transparentRoot),
    closeToTray: bool(source.closeToTray, defaults.closeToTray),
    globalShortcut: shortcut,
    spoofBrowserUA: bool(source.spoofBrowserUA, defaults.spoofBrowserUA),
    registerProtocol: bool(source.registerProtocol, defaults.registerProtocol),
    zoomFactor: Math.round(clamp(source.zoomFactor, 0.5, 2.5, defaults.zoomFactor) * 100) / 100,
    window: {
      width: Math.round(clamp(window.width, 640, 7680, defaults.window.width)),
      height: Math.round(clamp(window.height, 480, 4320, defaults.window.height)),
      x: optionalInt(window.x, -20000, 20000),
      y: optionalInt(window.y, -20000, 20000),
      maximized: bool(window.maximized, false),
    },
  };
}

/** Merge a patch into existing settings and re-validate. */
export function patchSettings(current, patch) {
  const base = isPlainObject(current) ? current : {};
  const next = isPlainObject(patch) ? patch : {};
  return normalizeSettings({
    ...base,
    ...next,
    window: { ...(isPlainObject(base.window) ? base.window : {}), ...(isPlainObject(next.window) ? next.window : {}) },
  });
}
