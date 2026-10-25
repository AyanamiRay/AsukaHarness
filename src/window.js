import { BrowserWindow, screen, shell } from 'electron';

/**
 * Windows and window-adjacent plumbing.
 *
 * The page is untrusted-by-default: no Node integration, no page-facing preload
 * API, context isolation on, and every navigation away from the DSH origin is
 * handed to the system browser.
 */

export function stripElectronUA(userAgent) {
  return String(userAgent)
    .replace(/\sElectron\/[\d.]+/gi, '')
    .replace(/\sasuka-shell\/[\d.]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Drop a remembered position that no longer intersects any display, so a
 * window saved on a disconnected monitor does not open off-screen.
 */
export function visibleWindowBounds(saved) {
  const width = saved?.width ?? 1280;
  const height = saved?.height ?? 820;
  const x = Number.isInteger(saved?.x) ? saved.x : null;
  const y = Number.isInteger(saved?.y) ? saved.y : null;

  if (x === null || y === null) return { width, height };

  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return x < area.x + area.width && x + width > area.x && y < area.y + area.height && y + height > area.y;
  });

  return visible ? { width, height, x, y } : { width, height };
}

export function createMainWindow({ settings, splashPath, preload, logger }) {
  const bounds = visibleWindowBounds(settings.window);
  const window = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Asuka Shell',
    backgroundColor: '#0b0d12',
    autoHideMenuBar: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webviewTag: false,
      safeDialogs: true,
      backgroundThrottling: false,
    },
  });

  window.once('ready-to-show', () => {
    if (settings.window?.maximized) window.maximize();
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('dsh://')) {
      window.show();
      window.focus();
    } else if (/^https?:/i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  // Keep the DSH origin inside the shell; anything else opens in the browser.
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL();
    try {
      if (current && new URL(url).origin === new URL(current).origin) return;
    } catch {
      /* fall through */
    }
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    else logger?.warn?.(`window: blocked navigation to ${url}`);
  });

  window.loadFile(splashPath).catch((error) => {
    logger?.error?.(`window: splash failed: ${error.message}`);
  });

  return window;
}

export function applyZoom(window, factor) {
  if (!window || window.isDestroyed()) return;
  try {
    window.webContents.setZoomFactor(Math.min(2.5, Math.max(0.5, Number(factor) || 1)));
  } catch {
    /* before first load */
  }
}
