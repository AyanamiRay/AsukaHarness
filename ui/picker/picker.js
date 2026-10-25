const api = window.dshShell;

const STRINGS = {
  zh: {
    title: '皮肤',
    subtitle: '选择一张壁纸，立即生效，不需要重新加载页面',
    import: '导入图片…',
    folder: '打开皮肤目录',
    reload: '刷新',
    enabled: '启用壁纸',
    transparent: '壁纸透出应用背景',
    hint: '点击卡片即可切换',
    builtin: '内置',
    user: '本地',
    footer: (dir) => `自己的图片：把文件夹放进 ${dir}，每个文件夹包含 skin.json 与背景图；也可以直接「导入图片」。`,
    failed: (n) => `${n} 个皮肤无法加载，详见日志。`,
    imported: '已导入并应用',
    applied: '已切换到',
    reloaded: '已刷新皮肤列表',
    empty: '还没有可用的皮肤。点「导入图片…」添加第一张。',
  },
  en: {
    title: 'Skins',
    subtitle: 'Pick a wallpaper — applied instantly, no page reload',
    import: 'Import image…',
    folder: 'Open skin folder',
    reload: 'Refresh',
    enabled: 'Wallpaper enabled',
    transparent: 'Let the wallpaper show through',
    hint: 'Click a card to apply',
    builtin: 'Built-in',
    user: 'Local',
    footer: (dir) => `Your own images: drop folders into ${dir} (each with skin.json + background); or use “Import image”.`,
    failed: (n) => `${n} skin(s) failed to load — see the log.`,
    imported: 'Imported and applied',
    applied: 'Applied',
    reloaded: 'Skin list refreshed',
    empty: 'No skins yet. Use “Import image” to add your first one.',
  },
};

let t = STRINGS.zh;
let state = null;
let toastTimer = null;

const $ = (id) => document.getElementById(id);

function applyStaticText() {
  $('title').textContent = t.title;
  $('subtitle').textContent = t.subtitle;
  $('import').textContent = t.import;
  $('folder').textContent = t.folder;
  $('reload').textContent = t.reload;
  $('enabledLabel').textContent = t.enabled;
  $('transparentLabel').textContent = t.transparent;
  $('hint').textContent = t.hint;
}

function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2400);
}

function card(skin) {
  const element = document.createElement('div');
  element.className = 'card' + (skin.id === state.current ? ' active' : '');
  element.dataset.id = skin.id;
  element.title = skin.description || skin.name;
  element.tabIndex = 0;
  element.setAttribute('role', 'button');
  element.setAttribute('aria-pressed', skin.id === state.current ? 'true' : 'false');

  const preview = document.createElement('div');
  preview.className = 'preview';
  if (skin.thumb) preview.style.backgroundImage = `url("${skin.thumb}")`;

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = skin.source === 'user' ? t.user : t.builtin;

  const check = document.createElement('span');
  check.className = 'check';
  check.textContent = '✓';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = skin.name;
  const desc = document.createElement('span');
  desc.className = 'desc';
  desc.textContent = skin.description || '';
  meta.append(name, desc);

  element.append(preview, badge, check, meta);
  element.addEventListener('click', () => applySkin(skin.id));
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      applySkin(skin.id);
    }
  });
  return element;
}

function render() {
  if (!state) return;
  $('enabled').checked = Boolean(state.enabled);
  $('transparent').checked = Boolean(state.transparentRoot);

  const grid = $('grid');
  if (state.skins.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t.empty;
    grid.replaceChildren(empty);
  } else {
    grid.replaceChildren(...state.skins.map(card));
  }

  const parts = [t.footer(state.userDir ?? '')];
  if (state.warnings?.length) parts.push(t.failed(state.warnings.length));
  $('footer').textContent = parts.join(' ');
}

async function applySkin(id) {
  try {
    state = await api.apply(id);
    render();
    const skin = state.skins.find((item) => item.id === id);
    toast(`${t.applied} ${skin?.name ?? id}`);
  } catch (error) {
    toast(error.message);
  }
}

async function boot() {
  try {
    const locale = await api.locale().catch(() => 'zh');
    if (!String(locale).toLowerCase().startsWith('zh')) t = STRINGS.en;
  } catch {
    /* keep zh */
  }
  applyStaticText();

  try {
    state = await api.list();
    render();
  } catch (error) {
    toast(error.message);
  }
}

$('import').addEventListener('click', async () => {
  try {
    const id = await api.importImage();
    if (!id) return;
    state = await api.list();
    render();
    toast(t.imported);
  } catch (error) {
    toast(error.message);
  }
});

$('folder').addEventListener('click', () => api.openFolder().catch((error) => toast(error.message)));

$('reload').addEventListener('click', async () => {
  try {
    state = await api.reload();
    render();
    toast(t.reloaded);
  } catch (error) {
    toast(error.message);
  }
});

$('enabled').addEventListener('change', async (event) => {
  try {
    state = await api.setEnabled(event.target.checked);
    render();
  } catch (error) {
    toast(error.message);
  }
});

$('transparent').addEventListener('change', async (event) => {
  try {
    state = await api.setTransparentRoot(event.target.checked);
    render();
  } catch (error) {
    toast(error.message);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.close();
});

boot();
