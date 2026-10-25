import { Menu, nativeImage, Tray } from 'electron';

/**
 * Tray icon with the actions that make sense while the window is hidden.
 * On Linux the click event is unreliable, so the context menu is the primary
 * interaction and the click handler is a bonus.
 */
export function createTray({ iconPath, onToggle, onSkins, onRestart, onLogs, onQuit, logger }) {
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    logger?.warn?.('tray: icon could not be loaded, tray disabled');
    return null;
  }
  if (process.platform !== 'darwin') image = image.resize({ width: 22, height: 22 });

  const tray = new Tray(image);
  tray.setToolTip('Asuka Harness');

  const rebuild = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示 / 隐藏', click: onToggle },
        { type: 'separator' },
        { label: '更换皮肤…', click: onSkins },
        { label: '重启后端', click: onRestart },
        { label: '打开日志目录', click: onLogs },
        { type: 'separator' },
        { label: '退出', click: onQuit },
      ]),
    );
  };

  rebuild();
  tray.on('click', onToggle);

  return tray;
}
