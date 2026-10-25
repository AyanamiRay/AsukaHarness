const { ipcRenderer, webUtils } = require('electron');

/**
 * Controller for the in-page wallpaper button.
 *
 * This preload does NOT expose anything to the page: it only binds behaviour to
 * the button that `src/inpage.js` injects, using the shared DOM. Keeping the
 * bridge empty means a compromised page cannot ask the shell to read files.
 */

const FAB_ID = 'asuka-wallpaper-fab';
const POS_KEY = 'asuka.fab.pos';
const DEFAULT_TITLE = '更换壁纸：点击选择图片，或把图片拖到这里；右键打开皮肤管理；可拖动位置';
const RESET_COLOR = 'rgba(255, 255, 255, 0.18)';
const HOT_COLOR = 'rgba(124, 92, 255, 0.9)';
const ERROR_COLOR = 'rgba(255, 92, 92, 0.9)';

const closestFab = (target) => {
  try {
    return target && typeof target.closest === 'function' ? target.closest(`#${FAB_ID}`) : null;
  } catch {
    return null;
  }
};

function restore(fab) {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (!saved) return;
    const left = Number.parseFloat(saved.left);
    const top = Number.parseFloat(saved.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    fab.style.left = `${Math.max(8, Math.min(window.innerWidth - 52, left))}px`;
    fab.style.top = `${Math.max(8, Math.min(window.innerHeight - 52, top))}px`;
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  } catch {
    /* ignore corrupted position */
  }
}

function attach(fab) {
  let dragging = null;
  let moved = false;
  let flashTimer = null;
  let busy = false;

  const flash = (message) => {
    fab.style.borderColor = ERROR_COLOR;
    fab.title = message || DEFAULT_TITLE;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      fab.style.borderColor = RESET_COLOR;
      fab.title = DEFAULT_TITLE;
    }, 2400);
  };

  const pick = async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await ipcRenderer.invoke('shell:pick-image');
      if (result && result.ok === false && !result.canceled) flash(result.error || '导入失败');
    } catch {
      flash('无法打开图片选择器');
    } finally {
      busy = false;
    }
  };

  fab.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const rect = fab.getBoundingClientRect();
    dragging = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    moved = false;
    fab.setPointerCapture?.(event.pointerId);
    fab.style.cursor = 'grabbing';
  });

  fab.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    moved = true;
    const left = Math.max(8, Math.min(window.innerWidth - 52, dragging.left + dx));
    const top = Math.max(8, Math.min(window.innerHeight - 52, dragging.top + dy));
    fab.style.left = `${left}px`;
    fab.style.top = `${top}px`;
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  });

  fab.addEventListener('pointerup', async (event) => {
    if (!dragging) return;
    event.stopPropagation();
    fab.releasePointerCapture?.(event.pointerId);
    fab.style.cursor = 'pointer';
    const wasDrag = moved;
    dragging = null;
    if (wasDrag) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({ left: fab.style.left, top: fab.style.top }));
      } catch {
        /* ignore quota errors */
      }
      return;
    }
    await pick();
  });

  fab.addEventListener('pointercancel', () => {
    dragging = null;
    fab.style.cursor = 'pointer';
  });

  fab.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick();
    }
  });

  fab.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    ipcRenderer.invoke('shell:open-picker').catch(() => {});
  });

  // Keep the page from reacting to clicks meant for the wallpaper button.
  fab.addEventListener('click', (event) => event.stopPropagation());

  window.addEventListener(
    'dragover',
    (event) => {
      if (!closestFab(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      fab.style.borderColor = HOT_COLOR;
    },
    true,
  );

  window.addEventListener(
    'dragleave',
    (event) => {
      if (!closestFab(event.target)) return;
      fab.style.borderColor = RESET_COLOR;
    },
    true,
  );

  window.addEventListener(
    'drop',
    async (event) => {
      if (!closestFab(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      fab.style.borderColor = RESET_COLOR;

      const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
      const file = files.find((item) => String(item.type || '').startsWith('image/'));
      if (!file) {
        flash('请拖入图片文件');
        return;
      }

      let filePath = '';
      try {
        filePath = webUtils?.getPathForFile ? webUtils.getPathForFile(file) : file.path;
      } catch {
        filePath = '';
      }
      if (!filePath) {
        flash('请拖入本地图片，或点击选择');
        return;
      }

      try {
        const result = await ipcRenderer.invoke('shell:import-image', filePath);
        if (result && result.ok === false) flash(result.error || '导入失败');
      } catch {
        flash('导入失败');
      }
    },
    true,
  );
}

function bind() {
  const fab = document.getElementById(FAB_ID);
  if (!fab || fab.dataset.asukaBound === '1') return;
  fab.dataset.asukaBound = '1';
  restore(fab);
  attach(fab);
}

const observer = new MutationObserver(() => bind());
const start = () => {
  bind();
  observer.observe(document.documentElement, { childList: true, subtree: true });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
