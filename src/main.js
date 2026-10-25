import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DshBackend } from './backend.js';
import { injectFloatingButton, removeFloatingButton } from './inpage.js';
import { locateDsh } from './lib/dsh-locator.js';
import { createLogger } from './lib/log.js';
import { SettingsStore } from './lib/settings-store.js';
import { SkinManager } from './skin-manager.js';
import { createTray } from './tray.js';
import { applyZoom, createMainWindow, stripElectronUA } from './window.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPLASH = join(ROOT, 'ui', 'splash.html');
const PICKER = join(ROOT, 'ui', 'picker', 'index.html');
const PICKER_PRELOAD = join(ROOT, 'src', 'preload-picker.cjs');
const MAIN_PRELOAD = join(ROOT, 'src', 'preload-main.cjs');
const TRAY_ICON = join(ROOT, 'assets', 'tray.png');
const DSH_REPO = 'https://github.com/deepseek-ai/deepseek-harness';
/** `--smoke`: log the applied skin state after load, then exit (CI diagnostic). */
const SMOKE = process.argv.includes('--smoke');
/** `--dev` opens detached DevTools on the main window. */
const DEV = process.argv.includes('--dev');

app.setName('Asuka Shell');
// Keep user data in a predictable, lowercase directory on every platform.
// `ASUKA_SHELL_USER_DATA` enables portable installs and isolated test runs.
app.setPath(
  'userData',
  process.env.ASUKA_SHELL_USER_DATA
    ? resolve(process.env.ASUKA_SHELL_USER_DATA)
    : join(app.getPath('appData'), 'asuka-shell'),
);
if (process.platform === 'linux') {
  // Matches StartupWMClass in the generated .desktop file.
  app.setDesktopName?.('asuka-shell.desktop');
}

/** @type {SettingsStore} */
let settings;
let logger;
/** @type {DshBackend|null} */
let backend = null;
/** @type {BrowserWindow|null} */
let mainWindow = null;
/** @type {BrowserWindow|null} */
let pickerWindow = null;
let trayHandle = null;
/** @type {SkinManager|null} */
let skins = null;

let quitting = false;
let cleanupDone = false;
let starting = false;
let restartTimer = null;
let restartFailures = 0;
let boundsTimer = null;
let failureDialogOpen = false;
let loadFailureDialogOpen = false;

const primaryInstance = app.requestSingleInstanceLock();

if (!primaryInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    handleDeepLink(argv);
    showWindow();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink([url]);
    showWindow();
  });

  app.whenReady().then(boot).catch(fatal);

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return;
    if (!(settings?.get()?.closeToTray ?? true)) app.quit();
  });

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showWindow();
      return;
    }
    createWindow();
    const url = backend?.url ?? settings?.get()?.attachUrl;
    if (url) loadUrl(url).catch((error) => logger?.warn?.(`window: reload failed: ${error.message}`));
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  // If the shell is killed hard (crash, SIGKILL, OS shutdown) the child would
  // otherwise keep running and holding its port.
  process.on('exit', () => backend?.killSync?.());

  app.on('before-quit', (event) => {
    quitting = true;
    settings?.saveNow();
    if (cleanupDone || !backend?.running) return;
    event.preventDefault();
    const current = backend;
    current
      .stop()
      .catch((error) => logger?.warn?.(`backend: stop failed: ${error.message}`))
      .finally(() => {
        cleanupDone = true;
        app.quit();
      });
  });
}

async function boot() {
  const userData = app.getPath('userData');
  logger = createLogger(join(userData, 'logs', 'shell.log'));
  logger.info(`starting Asuka Shell ${app.getVersion()} on ${process.platform}-${process.arch}`);

  settings = new SettingsStore(join(userData, 'settings.json'), logger);
  settings.load();
  // Materialise the defaults so users can find and edit the file.
  if (!existsSync(settings.file)) settings.saveNow();

  configureSession();

  skins = new SkinManager({
    builtinDir: join(ROOT, 'skins'),
    userDir: join(userData, 'skins'),
    logger,
    enabled: settings.get().skinEnabled,
    current: settings.get().skin,
    transparentRoot: settings.get().transparentRoot,
  });
  skins.refresh();

  registerIpc();
  buildMenu();
  createWindow();
  if (DEV && mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' });
  setupTray();
  registerShortcut();
  registerProtocol();

  await startBackend();
}

function configureSession() {
  const allowed = new Set([
    'media',
    'notifications',
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
    'pointerLock',
  ]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
}

function createWindow() {
  mainWindow = createMainWindow({
    settings: settings.get(),
    splashPath: SPLASH,
    preload: MAIN_PRELOAD,
    logger,
  });
  wireWindow(mainWindow);
}

function wireWindow(window) {
  const contents = window.webContents;

  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) skins?.resetPage(contents);
  });

  contents.on('did-finish-load', () => {
    const url = contents.getURL();
    if (!/^https?:/i.test(url)) return; // splash
    logger.info(`window: loaded ${url.replace(/([?&]token=)[^&]+/u, '$1***')}`);
    applyZoom(window, settings.get().zoomFactor);
    const applied = skins?.apply(contents) ?? Promise.resolve();
    applied
      .then(() => syncFloatingButton())
      .catch((error) => logger.warn(`skin: ${error.message}`));
    if (SMOKE) {
      applied
        .then(() =>
          contents.executeJavaScript(
            `JSON.stringify({
              skin: document.documentElement.dataset.dshSkin ?? null,
              on: document.documentElement.classList.contains('dsh-skin-on'),
              transparent: document.documentElement.classList.contains('dsh-skin-transparent-root'),
              image: getComputedStyle(document.documentElement).getPropertyValue('--dsh-skin-image').slice(0, 40)
            })`,
            true,
          ),
        )
        .then((state) => {
          logger.info(`SMOKE_STATE ${state}`);
          setTimeout(() => app.quit(), 400);
        })
        .catch((error) => {
          logger.error(`smoke: ${error.message}`);
          app.exit(1);
        });
    }
  });

  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    logger.error(`window: load failed (${code}) ${description} ${url}`);
    showLoadFailure(description, url);
  });

  contents.on('render-process-gone', (_event, details) => {
    logger.error(`window: renderer gone (${details.reason})`);
    if (quitting) return;
    dialog
      .showMessageBox(window, {
        type: 'error',
        title: '页面崩溃',
        message: '界面进程已退出',
        detail: `原因：${details.reason}`,
        buttons: ['重新加载', '退出'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) window.reload();
        else app.quit();
      });
  });

  window.on('close', (event) => {
    if (quitting || !settings.get().closeToTray) return;
    event.preventDefault();
    window.hide();
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const maximized = mainWindow.isMaximized();
      const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
      settings.patch({ window: { ...bounds, maximized } });
    }, 300);
    boundsTimer.unref?.();
  };
  window.on('resize', saveBounds);
  window.on('move', saveBounds);
  window.on('maximize', saveBounds);
  window.on('unmaximize', saveBounds);
}

function buildEnv() {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  // The shell may itself be started by another Electron app.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function startBackend({ restart = false } = {}) {
  if (quitting || starting) return;
  starting = true;
  let backendReady = false;
  try {
    const config = settings.get();

    if (config.attachUrl) {
      starting = false;
      logger.info(`backend: attaching to ${config.attachUrl}`);
      await loadUrl(config.attachUrl);
      return;
    }

    const found = locateDsh({ explicit: config.dshCommand });
    if (!found.command) {
      starting = false;
      await promptMissingDsh(found.tried);
      return;
    }

    // A retry after a failed page load must not leave the previous server bound.
    if (backend?.running) {
      await backend.stop().catch((error) => logger.warn(`backend: stop failed: ${error.message}`));
    }
    backend?.removeAllListeners();
    backend = new DshBackend({
      command: found.command,
      host: config.host,
      port: config.port,
      workspace: config.workspace || app.getPath('home'),
      extraArgs: config.extraArgs,
      env: buildEnv(),
    });

    backend.on('log', ({ stream, text }) => {
      for (const line of text.split(/\r?\n/)) if (line.trim()) logger.info(`[dsh:${stream}] ${line.trimEnd()}`);
    });
    backend.on('crash', ({ code, signal }) => {
      logger.warn(`backend: exited unexpectedly (code=${code ?? 'null'} signal=${signal ?? 'none'})`);
      scheduleRestart();
    });

    logger.info(`backend: using ${found.command} (${found.source})`);
    const { url } = await backend.start();
    backendReady = true;
    restartFailures = 0;
    logger.info(`backend: ready at ${url.replace(/([?&]token=)[^&]+/u, '$1***')}`);

    await loadUrl(url);
  } catch (error) {
    logger.error(`backend: ${error.message}`);
    starting = false;
    if (restart) {
      scheduleRestart();
    } else if (backendReady) {
      // The server is fine; only the page failed. `did-fail-load` usually owns
      // the dialog, so this is the fallback when it did not fire.
      if (!loadFailureDialogOpen) showLoadFailure(error.message, backend?.url ?? '');
    } else {
      await promptStartFailure(error);
    }
    return;
  } finally {
    starting = false;
  }
}

async function loadUrl(url) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (settings.get().spoofBrowserUA) {
    const userAgent = stripElectronUA(session.defaultSession.getUserAgent());
    if (userAgent) mainWindow.webContents.setUserAgent(userAgent);
  }

  try {
    await mainWindow.loadURL(url);
  } catch (error) {
    if (error?.code === 'ERR_ABORTED') return;
    logger.error(`window: cannot load ${url}: ${error.message}`);
    throw error;
  }
}

function scheduleRestart() {
  if (quitting) return;
  restartFailures += 1;
  if (restartFailures > 5) {
    dialog.showErrorBox('后端反复退出', 'dsh web 连续多次异常退出，请查看日志后手动重启应用。');
    return;
  }
  const wait = Math.min(30_000, 1_000 * 2 ** (restartFailures - 1));
  logger.warn(`backend: restarting in ${Math.round(wait / 1000)}s`);
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startBackend({ restart: true });
  }, wait);
  restartTimer.unref?.();
}

async function promptMissingDsh(tried) {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: '找不到 dsh',
    message: '未找到 DeepSeek Harness CLI',
    detail: [
      'Asuka Shell 只提供一个桌面外壳，需要本机已安装官方 CLI：',
      '',
      '    npm i -g @deepseek-ai/dsh',
      '',
      '也可以在设置文件里填写 "dshCommand" 指向可执行文件。',
      '',
      '已尝试：',
      ...tried.slice(0, 8).map((item) => `  • ${item}`),
    ].join('\n'),
    buttons: ['重试', '打开设置文件', '退出'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (response === 0) {
    // Defer so the current startBackend() call unwinds and clears `starting`.
    setTimeout(() => startBackend(), 50);
    return;
  }
  if (response === 1) {
    settings.saveNow();
    await shell.openPath(settings.file);
    setTimeout(() => startBackend(), 50);
    return;
  }
  quitting = true;
  app.quit();
}

async function promptStartFailure(error) {
  if (failureDialogOpen) return;
  failureDialogOpen = true;
  try {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: '后端启动失败',
      message: 'dsh web 未能启动',
      detail: `${error.message}\n\n完整输出见日志：${logger.file}`,
      buttons: ['重试', '打开日志', '退出'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 0) setTimeout(() => startBackend(), 50);
    else if (response === 1) await openLogs();
    else {
      quitting = true;
      app.quit();
    }
  } finally {
    failureDialogOpen = false;
  }
}

function showLoadFailure(description, url) {
  if (!mainWindow || mainWindow.isDestroyed() || loadFailureDialogOpen) return;
  loadFailureDialogOpen = true;
  dialog
    .showMessageBox(mainWindow, {
      type: 'error',
      title: '页面加载失败',
      message: '无法加载 dsh web 页面',
      detail: `${description}\n${url}`,
      buttons: ['重新加载', '重启后端', '退出'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    .then(({ response }) => {
      if (response === 0) mainWindow?.webContents.reload();
      else if (response === 1) restartBackend();
      else app.quit();
    })
    .finally(() => {
      loadFailureDialogOpen = false;
    });
}

async function restartBackend() {
  restartFailures = 0;
  clearTimeout(restartTimer);
  restartTimer = null;
  await backend?.stop().catch((error) => logger.warn(`backend: stop failed: ${error.message}`));
  await startBackend({ restart: true });
}

function registerIpc() {
  const fromPicker = (event) =>
    Boolean(pickerWindow && !pickerWindow.isDestroyed() && event.sender === pickerWindow.webContents);
  const fromMain = (event) =>
    Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);

  ipcMain.handle('skins:list', (event) => {
    if (!fromPicker(event)) throw new Error('rejected sender');
    return skins.list();
  });

  ipcMain.handle('skins:apply', async (event, id) => {
    if (!fromPicker(event) || typeof id !== 'string') throw new Error('rejected sender');
    await setSkin(id);
    return skins.list();
  });

  ipcMain.handle('skins:set-enabled', async (event, value) => {
    if (!fromPicker(event) || typeof value !== 'boolean') throw new Error('rejected sender');
    await setSkinEnabled(value);
    return skins.list();
  });

  ipcMain.handle('skins:set-transparent-root', async (event, value) => {
    if (!fromPicker(event) || typeof value !== 'boolean') throw new Error('rejected sender');
    await setTransparentRoot(value);
    return skins.list();
  });

  ipcMain.handle('skins:import', async (event) => {
    if (!fromPicker(event)) throw new Error('rejected sender');
    const { canceled, filePaths } = await dialog.showOpenDialog(pickerWindow, {
      title: '选择一张图片作为壁纸',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif'] }],
    });
    if (canceled || filePaths.length === 0) return null;
    const id = skins.importImage(filePaths[0]);
    await setSkin(id);
    return id;
  });

  ipcMain.handle('skins:open-folder', async (event) => {
    if (!fromPicker(event)) throw new Error('rejected sender');
    await skins.openFolder();
  });

  ipcMain.handle('skins:reload', async (event) => {
    if (!fromPicker(event)) throw new Error('rejected sender');
    skins.refresh();
    await applySkin();
    buildMenu();
    return skins.list();
  });

  ipcMain.handle('skins:close', (event) => {
    if (!fromPicker(event)) throw new Error('rejected sender');
    pickerWindow.close();
  });

  ipcMain.handle('shell:locale', (event) => {
    if (!fromPicker(event)) throw new Error('rejected sender');
    return app.getLocale();
  });

  // Requests from the in-page wallpaper button (preload-main.cjs).
  ipcMain.handle('shell:pick-image', async (event) => {
    if (!fromMain(event)) throw new Error('rejected sender');
    return pickImageFromDialog();
  });

  ipcMain.handle('shell:import-image', async (event, filePath) => {
    if (!fromMain(event) || typeof filePath !== 'string' || filePath.length > 4096) {
      throw new Error('rejected sender');
    }
    return importImagePath(filePath);
  });

  ipcMain.handle('shell:open-picker', (event) => {
    if (!fromMain(event)) throw new Error('rejected sender');
    openPicker();
    return { ok: true };
  });
}

/** Native file dialog used by the floating button. */
async function pickImageFromDialog() {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, canceled: true };
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择壁纸图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif'] }],
  });
  if (canceled || !filePaths[0]) return { ok: false, canceled: true };
  return importImagePath(filePaths[0]);
}

/** Copy an image into the user skin directory and apply it. Never throws. */
async function importImagePath(filePath) {
  try {
    const id = skins.importImage(filePath);
    await setSkin(id);
    return { ok: true, id };
  } catch (error) {
    logger.warn(`skin: import failed: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function syncFloatingButton() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (settings.get().floatingButton) await injectFloatingButton(mainWindow.webContents);
    else await removeFloatingButton(mainWindow.webContents);
  } catch (error) {
    logger.warn(`page: floating button failed: ${error.message}`);
  }
}

async function applySkin() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    await skins.apply(mainWindow.webContents).catch((error) => logger.warn(`skin: ${error.message}`));
  }
}

async function setSkin(id) {
  if (!skins) return;
  skins.setCurrent(id);
  settings.patch({ skin: id });
  await applySkin();
  buildMenu();
}

async function setSkinEnabled(value) {
  skins.setEnabled(value);
  settings.patch({ skinEnabled: value });
  await applySkin();
  buildMenu();
}

async function setTransparentRoot(value) {
  skins.setTransparentRoot(value);
  settings.patch({ transparentRoot: value });
  await applySkin();
  buildMenu();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const data = skins?.list();
  const list = data?.skins ?? [];
  const current = data?.current;

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: '关于 Asuka Shell' },
              { type: 'separator' },
              { role: 'hide', label: '隐藏' },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '显示全部' },
              { type: 'separator' },
              { role: 'quit', label: '退出' },
            ],
          },
        ]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '更换皮肤…', accelerator: 'CmdOrCtrl+Shift+K', click: openPicker },
        {
          label: '重启后端',
          click: () => {
            if (settings.get().attachUrl && mainWindow) mainWindow.webContents.reload();
            else restartBackend();
          },
        },
        { label: '打开日志目录', click: () => openLogs() },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '皮肤',
      submenu: [
        {
          label: '启用壁纸',
          type: 'checkbox',
          checked: Boolean(data?.enabled),
          click: (item) => setSkinEnabled(item.checked).catch((error) => logger.warn(`skin: ${error.message}`)),
        },
        {
          label: '壁纸透出应用背景',
          type: 'checkbox',
          checked: settings.get().transparentRoot,
          click: (item) => setTransparentRoot(item.checked).catch((error) => logger.warn(`skin: ${error.message}`)),
        },
        {
          label: '页面悬浮按钮',
          type: 'checkbox',
          checked: settings.get().floatingButton,
          click: (item) => {
            settings.patch({ floatingButton: item.checked });
            syncFloatingButton();
          },
        },
        { type: 'separator' },
        ...list.map((skin) => ({
          label: skin.name,
          type: 'radio',
          checked: skin.id === current,
          click: () => setSkin(skin.id).catch((error) => logger.warn(`skin: ${error.message}`)),
        })),
        { type: 'separator' },
        { label: '管理皮肤…', click: openPicker },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于 Asuka Shell', click: showAbout },
        { label: 'Asuka Shell 仓库', click: () => shell.openExternal('https://github.com/AyanamiRay/AsukaShell') },
        { label: 'DeepSeek Harness 仓库', click: () => shell.openExternal(DSH_REPO) },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openPicker() {
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.show();
    pickerWindow.focus();
    return;
  }
  pickerWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    parent: mainWindow ?? undefined,
    title: '皮肤',
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PICKER_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  pickerWindow.loadFile(PICKER).catch((error) => logger.error(`picker: ${error.message}`));
  pickerWindow.on('closed', () => {
    pickerWindow = null;
  });
}

function showAbout() {
  const options = {
    type: 'info',
    title: '关于 Asuka Shell',
    message: `Asuka Shell ${app.getVersion()}`,
    detail: [
      'DeepSeek Harness 的可换肤桌面外壳。',
      '',
      '所有功能（模型切换、工具、会话、插件）均由官方 dsh web 提供，',
      '本程序只负责窗口、托盘与壁纸层。',
      '',
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    ].join('\n'),
    buttons: ['好'],
    noLink: true,
  };
  if (mainWindow && !mainWindow.isDestroyed()) dialog.showMessageBox(mainWindow, options);
  else dialog.showMessageBox(options);
}

function setupTray() {
  try {
    trayHandle = createTray({
      iconPath: TRAY_ICON,
      logger,
      onToggle: toggleWindow,
      onSkins: openPicker,
      onRestart: () => restartBackend(),
      onLogs: () => openLogs(),
      onQuit: () => app.quit(),
    });
  } catch (error) {
    logger.warn(`tray: unavailable: ${error.message}`);
  }
}

function registerShortcut() {
  const accelerator = settings.get().globalShortcut;
  if (!accelerator) return;
  try {
    const ok = globalShortcut.register(accelerator, toggleWindow);
    if (!ok) logger.warn(`shortcut: ${accelerator} is already taken`);
  } catch (error) {
    logger.warn(`shortcut: cannot register ${accelerator}: ${error.message}`);
  }
}

function registerProtocol() {
  if (!settings.get().registerProtocol) return;
  try {
    if (!app.isDefaultProtocolClient('dsh')) app.setAsDefaultProtocolClient('dsh');
  } catch (error) {
    logger.warn(`protocol: ${error.message}`);
  }
}

function handleDeepLink(argv) {
  const link = argv.find((value) => typeof value === 'string' && value.startsWith('dsh://'));
  if (!link) return;
  logger.info(`deeplink: ${link}`);
  showWindow();
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showWindow();
}

async function openLogs() {
  const dir = join(app.getPath('userData'), 'logs');
  await shell.openPath(dir);
}

function fatal(error) {
  logger?.error?.(`fatal: ${error.stack ?? error.message}`);
  dialog.showErrorBox('Asuka Shell 无法启动', String(error.stack ?? error.message));
  app.exit(1);
}
