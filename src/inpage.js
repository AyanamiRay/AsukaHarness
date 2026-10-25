/**
 * In-page wallpaper button.
 *
 * The button is pure markup: behaviour lives in `preload-main.cjs`, which
 * shares the DOM but exposes no bridge to the page. The element is re-created
 * after every navigation and can be moved by dragging (position is stored in
 * localStorage by the preload).
 */

export const FAB_ID = 'asuka-wallpaper-fab';

const CREATE = `(() => {
  if (document.getElementById('${FAB_ID}')) return true;
  const fab = document.createElement('div');
  fab.id = '${FAB_ID}';
  fab.setAttribute('role', 'button');
  fab.setAttribute('aria-label', '更换壁纸');
  fab.tabIndex = 0;
  fab.title = '更换壁纸：点击选择图片，或把图片拖到这里；右键打开皮肤管理；可拖动位置';
  fab.style.cssText = [
    'position:fixed',
    'right:18px',
    'bottom:18px',
    'width:44px',
    'height:44px',
    'border-radius:50%',
    'display:grid',
    'place-items:center',
    'cursor:pointer',
    'background:rgba(17,19,26,0.78)',
    'border:1px solid rgba(255,255,255,0.18)',
    'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
    'backdrop-filter:blur(10px)',
    'color:#e8eaf0',
    'z-index:2147483000',
    'transition:transform .15s ease,border-color .15s ease,background .15s ease',
    'user-select:none',
    '-webkit-user-select:none',
    'touch-action:none'
  ].join(';');
  fab.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"></rect><circle cx="8.5" cy="9.5" r="1.5"></circle><path d="m4 17 5-5 4 4 3-3 4 4"></path></svg>';
  fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.06)'; });
  fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; });
  document.body.appendChild(fab);
  return true;
})()`;

const REMOVE = `(() => {
  const fab = document.getElementById('${FAB_ID}');
  if (fab) fab.remove();
  return true;
})()`;

export async function injectFloatingButton(webContents) {
  if (!webContents || webContents.isDestroyed()) return false;
  return webContents.executeJavaScript(CREATE, true);
}

export async function removeFloatingButton(webContents) {
  if (!webContents || webContents.isDestroyed()) return false;
  return webContents.executeJavaScript(REMOVE, true);
}
