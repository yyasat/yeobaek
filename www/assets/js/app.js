/* ─────────────────────────────────────────────────────────────
   app.js — 见素 · 主控
   ───────────────────────────────────────────────────────────── */

import * as store from './store.js';
import * as native from './native.js';
import { normalizeUrl, isSearchQuery, hostOf, prettyName, resolveMeta, faviconCandidates } from './metadata.js';
import { TabManager } from './tabs.js';
import { generate, pageFacts, SNIPPETS } from './ai.js';

const APP_VERSION = '1.1.0';

const THEMES = [
  { id: 'su',      name: '素',   sw: ['#EDF1F4', '#E1E8ED', '#5D7688', '#1B242B'] },
  { id: 'wu',      name: '雾',   sw: ['#EEF0F1', '#E2E6E7', '#6A7C85', '#1F2629'] },
  { id: 'qinghui', name: '青灰', sw: ['#E8EEF2', '#D9E3EA', '#527085', '#1A242C'] },
  { id: 'mo',      name: '墨',   sw: ['#141A1E', '#252E34', '#8CA3B3', '#E3EAF0'] },
  { id: 'luanshi', name: '卵石', sw: ['#EBEEEE', '#DEE3E4', '#66807F', '#1D2525'] },
  { id: 'fuxiao',  name: '拂晓', sw: ['#ECEFF5', '#E0E4EE', '#6B7C9E', '#1E242F'] },
];

const DEFAULT_ENGINES = [
  { id: 'bing',      name: '必应',   url: 'https://www.bing.com/search?q={q}',      icon: 'https://www.bing.com/favicon.ico' },
  { id: 'baidu',     name: '百度',   url: 'https://www.baidu.com/s?wd={q}',          icon: 'https://www.baidu.com/favicon.ico' },
  { id: 'google',    name: '谷歌',   url: 'https://www.google.com/search?q={q}',     icon: 'https://www.google.com/favicon.ico' },
  { id: 'sogou',     name: '搜狗',   url: 'https://www.sogou.com/web?query={q}',     icon: 'https://www.sogou.com/favicon.ico' },
  { id: 'so360',     name: '360',   url: 'https://www.so.com/s?q={q}',              icon: 'https://www.so.com/favicon.ico' },
  { id: 'duck',      name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={q}',       icon: 'https://duckduckgo.com/favicon.ico' },
  { id: 'brave',     name: 'Brave',  url: 'https://search.brave.com/search?q={q}',   icon: 'https://search.brave.com/favicon.ico' },
];

const DEFAULT_HERO = [
  '把网页放回安静的地方|今天想\n读点什么。',
  '不急着去哪|先看看这里。',
  '留白也是内容|读点什么好。',
];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const S = {
  cats: [], favs: [], recent: [], heroLines: [], presets: [], engines: [],
  settings: {
    theme: 'su', dayNight: 'auto', fs: 15, zoom: 100, engine: 'bing',
    customColor: null, fullscreen: true,
  },
  activeCat: 'all',
  editing: false,
  aiCode: '',
};

let tabs = null;
let mediaQuery = null;

/* ── 首帧同步水合 ─────────────────────────────────────────── */
function hydrateSync() {
  S.cats = store.getSync('cats', S.cats.length ? S.cats : [
    { id: 'all', name: '全部' },
    { id: 'read', name: '阅读' },
    { id: 'tool', name: '工具' },
    { id: 'later', name: '稍后' },
  ]);
  S.favs = store.getSync('favs', []);
  S.recent = store.getSync('recent', []);
  S.heroLines = store.getSync('heroLines', DEFAULT_HERO.slice());
  S.presets = store.getSync('presets', []);
  S.engines = store.getSync('engines', DEFAULT_ENGINES.slice());
  S.settings = Object.assign(S.settings, store.getSync('settings', {}));
}

/* ── 载入 ─────────────────────────────────────────────────── */
async function loadState() {
  await store.migrateLegacy();
  S.cats = await store.get('cats', [
    { id: 'all', name: '全部' },
    { id: 'read', name: '阅读' },
    { id: 'tool', name: '工具' },
    { id: 'later', name: '稍后' },
  ]);
  S.favs = await store.get('favs', []);
  S.recent = await store.get('recent', []);
  S.heroLines = await store.get('heroLines', DEFAULT_HERO.slice());
  S.presets = await store.get('presets', []);
  S.engines = await store.get('engines', S.engines.length ? S.engines : DEFAULT_ENGINES.slice());
  S.settings = Object.assign(S.settings, await store.get('settings', {}));
}

const save = (k, v) => store.set(k, v);
const saveFavs = () => save('favs', S.favs);
const saveCats = () => save('cats', S.cats);
const saveRecent = () => save('recent', S.recent.slice(0, 30));
const saveHero = () => save('heroLines', S.heroLines);
const saveSettings = () => save('settings', S.settings);
const savePresets = () => save('presets', S.presets);
const saveEngines = () => save('engines', S.engines);

/* ── 主题 ─────────────────────────────────────────────────── */
function resolveTheme() {
  const { dayNight, theme } = S.settings;
  const isNight = dayNight === 'night'
    || (dayNight === 'auto' && mediaQuery?.matches);
  // 夜间统一使用「墨」，日间保留所选浅色主题
  if (isNight) return 'mo';
  return theme === 'mo' ? 'su' : theme;
}

function applyTheme() {
  const id = resolveTheme();
  document.documentElement.dataset.theme = id;

  const c = S.settings.customColor;
  if (c && id !== 'mo') {
    applyCustomVars(c);
  } else {
    clearCustomVars();
  }

  document.documentElement.style.setProperty('--fs', `${S.settings.fs}px`);
  tabs?.setZoomDefault(S.settings.zoom);

  const dark = id === 'mo';
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = dark ? 'dark' : 'light';

  syncBars();
}

function applyCustomVars(c) {
  const root = document.documentElement.style;
  root.setProperty('--bg', c.bg);
  root.setProperty('--elev', c.elev);
  root.setProperty('--elev-2', c.elev2);
  root.setProperty('--fg', c.fg);
  root.setProperty('--fg-dim', c.dim);
  root.setProperty('--fg-faint', c.faint);
  root.setProperty('--accent', c.accent);
  root.setProperty('--accent-ink', c.elev);
  root.setProperty('--accent-wash', c.wash);
  root.setProperty('--line', c.line);
  root.setProperty('--line-strong', c.lineStrong);
}

function clearCustomVars() {
  const root = document.documentElement.style;
  ['--bg', '--elev', '--elev-2', '--fg', '--fg-dim', '--fg-faint',
   '--accent', '--accent-ink', '--accent-wash', '--line', '--line-strong']
    .forEach((k) => root.removeProperty(k));
}

let barsTimer = null;
function syncBars() {
  clearTimeout(barsTimer);
  barsTimer = setTimeout(() => native.syncSystemBars(), 60);
}

/* ── 视图 ─────────────────────────────────────────────────── */
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
  if (name === 'console') { renderConsoleTarget(); updateConsoleNote(); }
  if (name === 'tabs') renderTabList();
  if (name === 'settings') renderSettings();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ── 首页问候 ─────────────────────────────────────────────── */
function renderHero() {
  const pool = S.heroLines.length ? S.heroLines : DEFAULT_HERO;
  const line = pool[Math.floor(Math.random() * pool.length)];
  const [kicker, body] = line.includes('|') ? line.split('|') : ['', line];
  $('heroKicker').textContent = kicker || '';
  $('heroKicker').hidden = !kicker;

  const t = $('heroTitle');
  t.innerHTML = '';
  String(body).split('\n').forEach((seg) => {
    if (seg.trim()) t.append(el('span', 'ln', seg));
  });
}

/* ── 分类 ─────────────────────────────────────────────────── */
function renderChips() {
  const box = $('catChips');
  box.innerHTML = '';
  S.cats.forEach((c) => {
    const b = el('button', 'chip');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(S.activeCat === c.id));
    b.append(document.createTextNode(c.name));
    if (c.id !== 'all') {
      const n = S.favs.filter((f) => f.cat === c.id).length;
      b.append(el('span', 'cnt', String(n)));
    }
    b.addEventListener('click', () => { S.activeCat = c.id; renderChips(); renderFavs(); });
    box.append(b);
  });

  const m = el('button', 'chip is-manage', '管理');
  m.type = 'button';
  m.addEventListener('click', openCatDialog);
  box.append(m);
}

/* ── 收藏 ─────────────────────────────────────────────────── */
function iconTile(fav) {
  const tile = el('div', 'fav-tile');
  const letter = el('span', 'fav-letter', (fav.title || '?').trim().charAt(0).toUpperCase());
  const img = el('img');
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.style.display = 'none';
  img.addEventListener('load', () => { img.style.display = 'block'; letter.hidden = true; });
  img.addEventListener('error', () => { img.style.display = 'none'; letter.hidden = false; });
  img.src = fav.icon || faviconCandidates(fav.url)[1];
  tile.append(letter, img);
  return tile;
}

function renderFavs() {
  const grid = $('favGrid');
  grid.innerHTML = '';
  const list = S.activeCat === 'all' ? S.favs : S.favs.filter((f) => f.cat === S.activeCat);
  $('favEmpty').hidden = list.length > 0;

  list.forEach((fav) => {
    const item = el('div', 'fav');
    const btn = el('button', 'fav-btn');
    btn.type = 'button';
    btn.append(iconTile(fav));
    btn.append(el('span', 'fav-name', fav.title));
    btn.addEventListener('click', () => { if (!S.editing) openUrl(fav.url, fav.title); });

    const del = el('button', 'fav-del');
    del.type = 'button';
    del.setAttribute('aria-label', `移除 ${fav.title}`);
    del.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-x"/></svg>';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      S.favs = S.favs.filter((f) => f.id !== fav.id);
      saveFavs(); renderFavs(); renderChips();
      toast('已删除');
    });

    btn.querySelector('.fav-tile').append(del);
    item.append(btn);
    grid.append(item);
  });
}

function renderRecent() {
  const list = $('recentList');
  list.innerHTML = '';
  if (!S.recent.length) {
    const li = el('li');
    li.append(el('p', 'empty quiet', '打开过的页面会出现在这里。'));
    list.append(li);
    return;
  }
  S.recent.forEach((r) => {
    const li = el('li');
    const go = el('button', 'r-go');
    go.type = 'button';
    go.append(el('span', 'r-dot'));
    const body = el('span', 'r-body');
    body.append(el('span', 'r-t', r.title));
    body.append(el('span', 'r-h', hostOf(r.url)));
    go.append(body);
    go.addEventListener('click', () => openUrl(r.url, r.title));

    const del = el('button', 'icon-btn sm');
    del.type = 'button';
    del.setAttribute('aria-label', '删除这条记录');
    del.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-x"/></svg>';
    del.addEventListener('click', () => {
      S.recent = S.recent.filter((x) => x.url !== r.url);
      saveRecent(); renderRecent();
    });

    li.append(go, del);
    list.append(li);
  });
}

/* ── 全屏模式（按网页，1 有顶栏 / 2 有状态栏 / 3 完全全屏）── */
const MODE_LABEL = { 1: '有顶栏', 2: '有状态栏', 3: '完全全屏' };

async function getPageMode(url) {
  const host = hostOf(url);
  const v = await store.get('mode:' + host, null);
  if (v) return Number(v);
  // 首次访问：默认模式②（无顶栏，保留系统状态栏，状态栏取页面色）
  return 2;
}

async function setPageMode(host, mode) {
  await store.set('mode:' + host, Number(mode));
}

/** 把当前标签的全屏模式同步到原生 + 页面壳。 */
function applyPageMode(tab) {
  if (!tab) return;
  const m = Number(tab.mode || 2);
  document.documentElement.classList.toggle('in-page-immersive', m === 3);
  if (tabs?.nativeMode) native.webview.setMode(tab.id, m);
  native.syncSystemBars();
}

/* ── 打开网页 ─────────────────────────────────────────────── */
function pushRecent(url, title) {
  S.recent = [{ url, title, at: Date.now() }, ...S.recent.filter((r) => r.url !== url)].slice(0, 30);
  saveRecent();
  renderRecent();
}

async function openUrl(raw, title, forceMode) {
  const url = normalizeUrl(raw);
  if (!url) { toast('网址无法识别'); return; }
  const host = hostOf(url);
  const savedZoom = await store.get('zoom:' + host, null);
  // 外部链接 / 桌面快捷方式会指定模式，否则读该站点的设置
  const mode = forceMode ? Number(forceMode) : await getPageMode(url);

  await tabs.create(url, { title, zoom: savedZoom || S.settings.zoom, mode });
  pushRecent(url, title || prettyName(url));
  syncBars();
}

function currentEngine() {
  return S.engines.find((e) => e.id === S.settings.engine) || S.engines[0] || DEFAULT_ENGINES[0];
}

function renderEngineIcon() {
  const btn = $('btnEngine');
  if (!btn) return;
  const caret = btn.querySelector('.engine-caret');
  btn.querySelectorAll('img, .fallback').forEach((n) => n.remove());
  const e = currentEngine();

  let node;
  if (e.icon) {
    const img = document.createElement('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = e.icon;
    img.addEventListener('error', () => {
      const f = el('span', 'fallback', e.name.charAt(0));
      img.replaceWith(f);
    }, { once: true });
    node = img;
  } else {
    node = el('span', 'fallback', e.name.charAt(0));
  }
  btn.insertBefore(node, caret);
}

function engineSearchUrl(q) {
  const e = currentEngine();
  return e.url.includes('{q}')
    ? e.url.replace('{q}', encodeURIComponent(q))
    : e.url;
}

function go(input) {
  const v = String(input || '').trim();
  if (!v) return;
  if (isSearchQuery(v)) {
    openUrl(engineSearchUrl(v), v);
    return;
  }
  const url = normalizeUrl(v);
  if (!url) { toast('网址无法识别'); return; }
  openUrl(url, prettyName(url));
}

/* ── 标签条：多页并行 ─────────────────────────────────────── */
function renderTabStrip() {
  const strip = $('tabStrip');
  if (!strip) return;
  strip.innerHTML = '';
  if (!tabs || !tabs.tabs.length) return;

  tabs.tabs.forEach((t) => {
    const chip = el('div', 'strip-tab' + (t.id === tabs.activeId ? ' is-on' : ''));
    chip.setAttribute('role', 'tab');
    chip.setAttribute('aria-selected', String(t.id === tabs.activeId));

    const pick = el('button', '');
    pick.type = 'button';
    pick.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;border:0;background:none;padding:0';
    pick.append(el('span', 'st-name', t.title || t.host || '页面'));
    pick.addEventListener('click', () => { tabs.activate(t.id); syncBars(); });

    const x = el('button', 'st-x');
    x.type = 'button';
    x.setAttribute('aria-label', '关闭标签');
    x.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-x"/></svg>';
    x.addEventListener('click', async (e) => {
      e.stopPropagation();
      await tabs.close(t.id);
      syncBars();
    });

    chip.append(pick, x);
    strip.append(chip);
  });

  const add = el('button', 'strip-new');
  add.type = 'button';
  add.setAttribute('aria-label', '新建标签');
  add.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-plus"/></svg>';
  add.addEventListener('click', () => {
    // 留在网页层，直接开一个空白新标签的工作态
    const url = prompt('输入网址', '');
    if (!url) return;
    openUrl(url, prettyName(normalizeUrl(url) || url));
  });
  strip.append(add);

  // 让当前标签滚进可视区
  const on = strip.querySelector('.is-on');
  on?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ── 标签列表 ─────────────────────────────────────────────── */
function renderTabList() {
  const ul = $('tabList');
  ul.innerHTML = '';
  if (!tabs || !tabs.tabs.length) {
    ul.append(el('li', 'empty', '还没有打开的页面。'));
    return;
  }
  tabs.tabs.forEach((t) => {
    const li = el('li');
    const row = el('div', 'tab-item' + (t.id === tabs.activeId ? ' is-current' : ''));

    const ic = el('div', 'tab-favicon');
    const img = el('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = faviconCandidates(t.url)[1];
    img.addEventListener('error', () => { ic.textContent = (t.title || '?')[0].toUpperCase(); img.remove(); });
    ic.append(img);

    const body = el('button', 'tab-body');
    body.type = 'button';
    body.append(el('span', 'tab-t', t.title || t.host));
    body.append(el('span', 'tab-h', t.host));
    body.addEventListener('click', () => { tabs.activate(t.id); syncBars(); });

    const close = el('button', 'icon-btn sm');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭');
    close.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-x"/></svg>';
    close.addEventListener('click', () => { tabs.close(t.id); renderTabList(); });

    row.append(ic, body, close);
    li.append(row);
    ul.append(li);
  });
}

/* ── 控制台 ───────────────────────────────────────────────── */
const logBox = () => $('consoleLog');

function log(kind, text) {
  const line = el('div', `log-line ${kind}`);
  line.append(el('span', 'tag', kind === 'in' ? '>' : kind === 'err' ? '!' : '·'));
  line.append(el('pre', '', fmt(text)));
  logBox().append(line);
  logBox().scrollTop = logBox().scrollHeight;
}

function fmt(v) {
  if (typeof v === 'string') return v;
  if (v === undefined) return 'undefined';
  try { return JSON.stringify(v, null, 1); } catch { return String(v); }
}

function renderConsoleTarget() {
  const t = tabs?.current();
  $('consoleTarget').textContent = t ? `${t.title} · ${t.host}` : '未连接页面';
}

function updateConsoleNote() {
  const t = tabs?.current();
  const note = $('consoleNote');
  if (native.isNative()) {
    note.textContent = '原生 WebView 模式：代码在网页自身的上下文里执行，可跨域操作页面。';
  } else if (t) {
    note.textContent = '当前是浏览器预览模式。同源页面可直接执行；跨域页面受同源策略限制，会明确提示失败。安装 APK 后不受此限制。';
  } else {
    note.textContent = '先打开一个网页，再回到这里执行代码。';
  }
}

async function runCode(code) {
  log('in', code);
  const r = await tabs?.evaluate(code);
  if (!r) return;
  if (r.ok) log('out', r.value === undefined ? 'undefined' : r.value);
  else log('err', r.error);
}

function bindConsole() {
  const quick = $('quickRow');
  SNIPPETS.forEach((s) => {
    const b = el('button', 'quick', s.label);
    b.type = 'button';
    b.addEventListener('click', () => { $('aiInput').value = s.q; });
    quick.append(b);
  });

  $('consoleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('consoleInput').value.trim();
    if (!code) return;
    await runCode(code);
    $('consoleInput').value = '';
  });

  $('consoleClear').addEventListener('click', () => { logBox().innerHTML = ''; });

  $('aiForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('aiInput').value.trim();
    if (!q) return;
    let facts = {};
    try {
      const t = tabs?.current();
      if (t && t.iframe) facts = pageFacts(t.iframe.contentWindow);
      else if (t) {
        const r = await tabs.evaluate('({title:document.title,paras:document.querySelectorAll("p").length,imgs:document.images.length,links:document.querySelectorAll("a[href]").length,bodyFont:parseFloat(getComputedStyle(document.body).fontSize)||16})');
        if (r.ok && r.value) facts = r.value;
      }
    } catch {}
    const out = generate(q, facts);
    S.aiCode = out.code;
    const pre = $('aiOut');
    pre.hidden = false;
    pre.textContent = out.code;
    $('aiActions').hidden = false;
    log('sys', out.note);
  });

  $('aiRun').addEventListener('click', async () => { if (S.aiCode) await runCode(S.aiCode); });
  $('aiInsert').addEventListener('click', () => { $('consoleInput').value = S.aiCode; });
}

/* ── 搜索引擎管理 ─────────────────────────────────────────── */
function renderEngineList() {
  const ul = $('engineList');
  ul.innerHTML = '';
  S.engines.forEach((e) => {
    const li = el('li' + (e.id === S.settings.engine ? '' : ''));
    if (e.id === S.settings.engine) li.classList.add('is-on');

    const pick = el('button', 'eg-pick');
    pick.type = 'button';

    if (e.icon) {
      const img = el('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.src = e.icon;
      img.addEventListener('error', () => {
        img.replaceWith(el('span', 'eg-fallback', e.name.charAt(0)));
      }, { once: true });
      pick.append(img);
    } else {
      pick.append(el('span', 'eg-fallback', e.name.charAt(0)));
    }

    pick.append(el('span', 'eg-name', e.name));
    pick.addEventListener('click', () => {
      S.settings.engine = e.id;
      saveSettings();
      renderEngineIcon();
      renderEngineList();
      $('dlgEngine').close();
    });
    li.append(pick);

    if (!e.builtin) {
      const del = el('button', 'eg-del');
      del.type = 'button';
      del.setAttribute('aria-label', `删除 ${e.name}`);
      del.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-x"/></svg>';
      del.addEventListener('click', () => {
        S.engines = S.engines.filter((x) => x.id !== e.id);
        if (S.settings.engine === e.id) S.settings.engine = S.engines[0]?.id || 'bing';
        saveEngines(); saveSettings();
        renderEngineIcon(); renderEngineList();
      });
      li.append(del);
    }

    ul.append(li);
  });
}

function bindEngines() {
  $('btnEngine').addEventListener('click', () => {
    renderEngineList();
    $('dlgEngine').showModal();
  });

  $('btnNewEngine').addEventListener('click', () => {
    $('engName').value = '';
    $('engUrl').value = '';
    $('engIcon').value = '';
    $('dlgNewEngine').showModal();
  });

  $('engSave').addEventListener('click', async () => {
    const name = $('engName').value.trim();
    const url = $('engUrl').value.trim();
    const icon = $('engIcon').value.trim();
    if (!name || !url) { toast('名称和地址都要填'); return; }

    let iconUrl = icon;
    if (!iconUrl) {
      // 自动取站点图标
      try {
        const origin = new URL(url.replace('{q}', '')).origin;
        iconUrl = `${origin}/favicon.ico`;
      } catch {}
    }

    S.engines.push({ id: 'e' + Date.now().toString(36), name, url, icon: iconUrl, builtin: false });
    saveEngines();
    $('dlgNewEngine').close();
    renderEngineList();
    toast('已添加');
  });

  // 设置页的「管理」按钮打开同一个引擎弹窗
  const manageBtn = $('btnManageEngine');
  if (manageBtn) {
    manageBtn.addEventListener('click', () => {
      renderEngineList();
      $('dlgEngine').showModal();
    });
  }

  // 旧版 segEngine 若还存在，绑定兼容
  document.querySelectorAll('#segEngine button').forEach((b) => {
    b.addEventListener('click', () => {
      S.settings.engine = b.dataset.engine;
      saveSettings(); renderEngineIcon(); renderSettings();
    });
  });
}

/* ── 设置渲染 ─────────────────────────────────────────────── */
function renderSettings() {
  // 日夜
  document.querySelectorAll('#segDayNight button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === S.settings.dayNight));
  });

  // 引擎：设置页显示当前引擎名
  const sub = $('engineSub');
  if (sub) sub.textContent = `当前：${currentEngine().name}`;
  document.querySelectorAll('#segEngine button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.engine === S.settings.engine));
  });

  // 主题
  const grid = $('themeGrid');
  grid.innerHTML = '';
  const all = THEMES.concat(S.presets);
  all.forEach((t) => {
    const b = el('button', 'theme-card');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(S.settings.theme === t.id));
    const sw = el('div', 'sw-row');
    t.sw.forEach((c) => {
      const d = el('i', 'sw');
      d.style.background = c;
      sw.append(d);
    });
    b.append(sw, el('span', 'nm', t.name));
    b.addEventListener('click', () => {
      S.settings.theme = t.id;
      // 预设自带变量，普通主题清掉自定义色
      S.settings.customColor = t.vars || null;
      saveSettings();
      document.documentElement.dataset.theme = t.custom ? 'custom' : t.id;
      if (t.vars) applyCustomVars(t.vars);
      else clearCustomVars();
      document.documentElement.style.setProperty('--fs', `${S.settings.fs}px`);
      native.syncSystemBars();
      renderSettings();
    });

    if (t.custom) {
      const del = el('span', 'theme-del');
      del.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-x"/></svg>';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        S.presets = S.presets.filter((p) => p.id !== t.id);
        savePresets();
        if (S.settings.theme === t.id) S.settings.theme = 'su';
        saveSettings(); applyTheme(); renderSettings();
      });
      b.append(del);
    }
    grid.append(b);
  });

  $('fontRange').value = S.settings.fs;
  $('fontOut').textContent = S.settings.fs;

  refreshStorage();
  renderSiteList();
  $('verLabel').textContent = APP_VERSION;
  $('buildInfo').textContent = `见素 ${APP_VERSION} · ${native.isNative() ? '原生 ' + native.platform() : '浏览器预览'}`;
}

async function refreshStorage() {
  const persisted = await store.isPersisted();
  $('persistState').textContent = persisted === null ? '不支持' : persisted ? '已持久化' : '未持久化';
  const est = await store.storageEstimate();
  if (est) {
    $('quotaUsed').textContent = `${store.fmtBytes(est.usage)} / ${store.fmtBytes(est.quota)}`;
    const pct = est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
    $('quotaBar').style.width = `${Math.max(1, pct).toFixed(1)}%`;
  } else {
    $('quotaUsed').textContent = '—';
  }
}

async function renderSiteList() {
  const ul = $('siteList');
  ul.innerHTML = '';
  const hosts = [...new Set([
    ...S.favs.map((f) => f.host),
    ...S.recent.map((r) => hostOf(r.url)),
    ...(tabs?.tabs || []).map((t) => t.host),
  ])].filter(Boolean);

  if (!hosts.length) {
    ul.append(el('li', '', '还没有站点数据。'));
    return;
  }

  for (const h of hosts.slice(0, 20)) {
    const li = el('li');
    const body = el('button', 'd-body');
    body.type = 'button';
    body.style.cssText = 'border:0;background:none;padding:0;text-align:left';
    body.append(el('span', 'd-host', h));

    const zoom = await store.get('zoom:' + h, null);
    const keep = await store.get('keep:' + h, null);
    const mode = await store.get('mode:' + h, null);
    const bits = [];
    bits.push(MODE_LABEL[mode || 2] || '有状态栏');
    if (zoom) bits.push(`缩放 ${zoom}%`);
    bits.push(keep === false ? '不保活' : '保活');
    body.append(el('span', 'd-meta', bits.join(' · ')));
    body.addEventListener('click', () => openSiteView(h));
    li.append(body);

    const b = el('button', 'icon-btn sm');
    b.type = 'button';
    b.setAttribute('aria-label', `管理 ${h}`);
    b.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-chev"/></svg>';
    b.addEventListener('click', () => openSiteView(h));
    li.append(b);
    ul.append(li);
  }
}

/* ── 站点独立设置页（P1）─────────────────────────────────── */
let siteHost = '';

async function openSiteView(host) {
  siteHost = host;
  $('siteTitle').textContent = host;
  $('siteHostLabel').textContent = '这些设置只作用于这一个站点。';

  const mode = Number(await store.get('mode:' + host, S.settings.pageMode || 2));
  const zoom = await store.get('zoom:' + host, null);
  const keep = await store.get('keep:' + host, null);

  document.querySelectorAll('#siteModeGrid .mode-card').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.mode) === mode));
  });
  $('siteZoomOut').textContent = zoom ? `${zoom}%` : '默认';
  document.querySelectorAll('#siteKeepSeg button').forEach((b) => {
    b.setAttribute('aria-pressed', String((b.dataset.keep === '1') === (keep !== false)));
  });

  showView('site');
}

function bindSiteView() {
  $('siteBack').addEventListener('click', () => showView('settings'));

  document.querySelectorAll('#siteModeGrid .mode-card').forEach((b) => {
    b.addEventListener('click', async () => {
      const m = Number(b.dataset.mode);
      await setPageMode(siteHost, m);
      document.querySelectorAll('#siteModeGrid .mode-card').forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b));
      });
      // 若该站点正在打开，立即生效
      const t = tabs?.tabs.find((x) => x.host === siteHost);
      if (t) { t.mode = m; if (t.id === tabs.activeId) applyPageMode(t); }
      toast(`已设为「${MODE_LABEL[m]}」`);
    });
  });

  $('siteZoomClear').addEventListener('click', async () => {
    await store.remove('zoom:' + siteHost);
    $('siteZoomOut').textContent = '默认';
    const t = tabs?.tabs.find((x) => x.host === siteHost);
    if (t) { t.zoom = S.settings.zoom; if (t.id === tabs.activeId) tabs._applyZoom(t); }
    toast('已清除缩放');
  });

  document.querySelectorAll('#siteKeepSeg button').forEach((b) => {
    b.addEventListener('click', async () => {
      const on = b.dataset.keep === '1';
      await store.set('keep:' + siteHost, on);
      document.querySelectorAll('#siteKeepSeg button').forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b));
      });
      const t = tabs?.tabs.find((x) => x.host === siteHost);
      if (t) await native.keepAlive(t.id, on);
      toast(on ? '已开启保活' : '已关闭保活');
    });
  });

  $('siteClear').addEventListener('click', () => {
    const host = siteHost;
    confirmDialog(`清除 ${host} 的全部数据？`,
      '将移除 Cookie、缓存、本地存储，以及它在见素里的缩放、全屏与保活设置。此操作不可撤销。',
      async () => {
        try {
          await native.clearSiteData(`https://${host}`);
          await store.remove('zoom:' + host);
          await store.remove('keep:' + host);
          await store.remove('mode:' + host);
          S.favs = S.favs.filter((f) => f.host !== host);
          S.recent = S.recent.filter((r) => hostOf(r.url) !== host);
          saveFavs(); saveRecent();
          toast(`${host} 已清除`);
          showView('settings');
        } catch (e) {
          console.warn(e);
          toast('部分数据未能清除');
        }
      });
  });
}

/* ── 设置交互 ─────────────────────────────────────────────── */
function bindSettings() {
  document.querySelectorAll('#segDayNight button').forEach((b) => {
    b.addEventListener('click', () => {
      S.settings.dayNight = b.dataset.mode;
      saveSettings(); applyTheme(); renderSettings();
    });
  });

  document.querySelectorAll('#segEngine button').forEach((b) => {
    b.addEventListener('click', () => {
      S.settings.engine = b.dataset.engine;
      saveSettings(); renderSettings();
    });
  });

  $('fontRange').addEventListener('input', (e) => {
    S.settings.fs = Number(e.target.value);
    $('fontOut').textContent = S.settings.fs;
    document.documentElement.style.setProperty('--fs', `${S.settings.fs}px`);
    saveSettings();
  });

  $('btnAddPreset').addEventListener('click', () => {
    if (!S.settings.customColor) { toast('先在「自定义配色」里调一个'); return; }
    const c = S.settings.customColor;
    S.presets.push({
      id: 'p' + Date.now().toString(36),
      name: '自定义' + (S.presets.length + 1),
      custom: true,
      sw: [c.bg, c.elev2, c.accent, c.fg],
      vars: c,
    });
    savePresets();
    renderSettings();
    toast('已存为预设');
  });

  $('btnCustomColor').addEventListener('click', openColorDialog);

  $('btnPersist').addEventListener('click', async () => {
    const r = await store.requestPersist();
    if (r === null) toast('此环境不支持');
    else if (r) toast('已获得持久化存储');
    else toast('系统未授予，可稍后再试');
    refreshStorage();
  });

  $('btnBackup').addEventListener('click', async () => {
    const data = {
      cats: S.cats, favs: S.favs, recent: S.recent, settings: S.settings,
      heroLines: S.heroLines, presets: S.presets, at: Date.now(), version: APP_VERSION,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jiansu-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  $('btnRestore').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        if (d.favs) { S.favs = d.favs; saveFavs(); }
        if (d.cats) { S.cats = d.cats; saveCats(); }
        if (d.recent) { S.recent = d.recent; saveRecent(); }
        if (d.heroLines) { S.heroLines = d.heroLines; saveHero(); }
        if (d.presets) { S.presets = d.presets; savePresets(); }
        if (d.settings) { S.settings = Object.assign(S.settings, d.settings); saveSettings(); }
        applyTheme(); renderChips(); renderFavs(); renderRecent(); renderHero(); renderSettings();
        toast('已恢复');
      } catch { toast('文件无法解析'); }
    });
    inp.click();
  });

  $('btnClipRead').addEventListener('click', async () => {
    const perm = await native.requestPermission('clipboard-read');
    if (!perm?.granted) { toast('未获得剪贴板权限'); return; }
    const r = await native.readClipboard();
    if (!r.ok) { toast('读取失败'); return; }
    if (r.text) { $('omniboxInput').value = r.text.trim(); showView('home'); }
    toast(r.text ? '已粘贴到地址栏' : '剪贴板为空');
  });

  $('btnClipWrite').addEventListener('click', async () => {
    const perm = await native.requestPermission('clipboard-write');
    if (!perm?.granted) { toast('未获得写入权限'); return; }
    const ok = await native.writeClipboard('见素');
    toast(ok ? '已写入剪贴板' : '写入被拒绝');
  });

  $('btnNotify').addEventListener('click', async () => {
    const p = await native.requestPermission('notifications');
    toast(p?.granted ? '通知已开启' : '未授权');
  });

  $('btnCheckUpdate').addEventListener('click', checkForUpdate);

  $('btnWipeAll').addEventListener('click', () => {
    confirmDialog('清除全部数据？',
      '将移除所有收藏、分类、标签、设置与站点数据。此操作不可撤销。',
      async () => {
        try {
          await native.clearAllData();
          S.favs = []; S.recent = []; S.presets = [];
          S.cats = [{ id: 'all', name: '全部' }];
          S.heroLines = DEFAULT_HERO.slice();
          saveFavs(); saveCats(); saveRecent(); savePresets(); saveHero();
          renderChips(); renderFavs(); renderRecent(); renderHero(); renderSettings();
          toast('已清除');
        } catch (e) {
          console.warn(e);
          toast('清除未完全成功');
        }
      });
  });
}

/* ── 颜色 ─────────────────────────────────────────────────── */
function hsl(h, s, l) {
  return `hsl(${h} ${s}% ${l}%)`;
}

function buildColorFrom(hue, light, sat) {
  const isDark = light < 45;
  const lift = (d) => Math.min(100, Math.max(0, light + d));
  return {
    bg: hsl(hue, sat, light),
    elev: hsl(hue, sat, lift(isDark ? 4 : 6)),
    elev2: hsl(hue, sat, lift(isDark ? 8 : -4)),
    fg: hsl(hue, Math.min(sat, 12), isDark ? 92 : 14),
    dim: hsl(hue, Math.min(sat, 14), isDark ? 62 : 48),
    faint: hsl(hue, Math.min(sat, 14), isDark ? 42 : 64),
    accent: hsl(hue, Math.min(sat + 8, 26), isDark ? 68 : 38),
    wash: `hsla(${hue}, ${Math.min(sat + 8, 26)}%, ${isDark ? 68 : 38}%, .14)`,
    line: `hsla(${hue}, ${Math.min(sat, 14)}%, ${isDark ? 92 : 14}%, .10)`,
    lineStrong: `hsla(${hue}, ${Math.min(sat, 14)}%, ${isDark ? 92 : 14}%, .20)`,
  };
}

let colorDraft = { hue: 205, light: 93, sat: 8 };

function openColorDialog() {
  const c = S.settings.customColor;
  colorDraft = c
    ? { hue: c.hue ?? 205, light: c.light ?? 93, sat: c.sat ?? 8 }
    : { hue: 205, light: 93, sat: 8 };

  $('hueRange').value = colorDraft.hue;
  $('lightRange').value = colorDraft.light;
  $('satRange').value = colorDraft.sat;
  updateColorPreview();
  $('dlgColor').showModal();
}

function updateColorPreview() {
  const row = $('previewRow');
  if (!row) return;
  row.innerHTML = '';
  const c = buildColorFrom(colorDraft.hue, colorDraft.light, colorDraft.sat);
  [c.bg, c.elev2, c.accent, c.fg].forEach((v) => {
    const d = el('i', 'swatch');
    d.style.background = v;
    row.append(d);
  });
}

function bindColorDialog() {
  ['hueRange', 'lightRange', 'satRange'].forEach((id) => {
    $(id).addEventListener('input', (e) => {
      colorDraft.hue = Number($('hueRange').value);
      colorDraft.light = Number($('lightRange').value);
      colorDraft.sat = Number($('satRange').value);
      updateColorPreview();
    });
  });

  $('applyColor').addEventListener('click', () => {
    const c = buildColorFrom(colorDraft.hue, colorDraft.light, colorDraft.sat);
    c.hue = colorDraft.hue; c.light = colorDraft.light; c.sat = colorDraft.sat;
    S.settings.customColor = c;
    S.settings.theme = 'custom';
    saveSettings();
    // custom 主题需要行内变量承载
    document.documentElement.dataset.theme = 'custom';
    applyCustomVars(c);
    document.documentElement.style.setProperty('--fs', `${S.settings.fs}px`);
    native.syncSystemBars();
    $('dlgColor').close();
    renderSettings();
    toast('已应用配色');
  });
}

/* ── 问候编辑 ─────────────────────────────────────────────── */
function openHeroDialog() {
  renderHeroList();
  $('dlgHero').showModal();
}

function renderHeroList() {
  const ul = $('heroLineList');
  ul.innerHTML = '';
  S.heroLines.forEach((line, i) => {
    const li = el('li');
    li.append(el('span', 'txt', line.replace('|', ' / ').replace('\n', ' ')));
    if (S.heroLines.length > 1) {
      const rm = el('button', 'rm');
      rm.type = 'button';
      rm.setAttribute('aria-label', '删除');
      rm.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-x"/></svg>';
      rm.addEventListener('click', () => {
        S.heroLines.splice(i, 1);
        saveHero(); renderHeroList(); renderHero();
      });
      li.append(rm);
    }
    ul.append(li);
  });
}

/* ── 分类管理 ─────────────────────────────────────────────── */
function openCatDialog() {
  renderCatList();
  $('newCatName').value = '';
  $('dlgCats').showModal();
}

function renderCatList() {
  const ul = $('catList');
  ul.innerHTML = '';
  S.cats.filter((c) => c.id !== 'all').forEach((c) => {
    const li = el('li');
    li.append(el('span', 'txt', c.name));
    const rm = el('button', 'rm');
    rm.type = 'button';
    rm.setAttribute('aria-label', `删除分类 ${c.name}`);
    rm.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-x"/></svg>';
    rm.addEventListener('click', () => {
      S.cats = S.cats.filter((x) => x.id !== c.id);
      S.favs.forEach((f) => { if (f.cat === c.id) f.cat = 'all'; });
      if (S.activeCat === c.id) S.activeCat = 'all';
      saveCats(); saveFavs();
      renderCatList(); renderChips(); renderFavs();
    });
    li.append(rm);
    ul.append(li);
  });
  if (!ul.children.length) ul.append(el('li', '', '还没有分类。'));
}

/* ── 确认弹窗 ─────────────────────────────────────────────── */
let confirmHandler = null;
function confirmDialog(title, body, onYes, { okLabel = '确认', cancel = true, tone = 'danger' } = {}) {
  $('confirmTitle').textContent = title;
  $('confirmBody').textContent = body;

  const yes = $('confirmYes');
  const no = $('confirmNo');
  yes.textContent = okLabel;
  yes.className = tone === 'danger' ? 'btn danger' : 'btn';
  no.hidden = !cancel;

  confirmHandler = onYes;
  $('dlgConfirm').showModal();
}

/* ── 添加收藏 ─────────────────────────────────────────────── */
function openAddDialog() {
  const sel = $('addCat');
  sel.innerHTML = '';
  S.cats.filter((c) => c.id !== 'all').forEach((c) => {
    const o = el('option', '', c.name);
    o.value = c.id;
    sel.append(o);
  });
  $('addUrl').value = $('omniboxInput').value.trim();
  $('addTitle').value = '';
  $('dlgAdd').showModal();
}

async function commitAdd() {
  const raw = $('addUrl').value.trim();
  const url = normalizeUrl(raw);
  if (!url) { toast('网址无法识别'); return; }

  const fav = {
    id: 'f' + Date.now().toString(36),
    url,
    title: $('addTitle').value.trim(),
    cat: $('addCat').value || 'all',
    host: hostOf(url),
    icon: '',
  };

  const saveBtn = $('addSave');
  saveBtn.textContent = '获取中…';
  saveBtn.disabled = true;
  try {
    const meta = await resolveMeta(url);
    if (!fav.title) fav.title = meta.title;
    fav.icon = meta.icon;
  } catch {
    if (!fav.title) fav.title = prettyName(url);
  } finally {
    saveBtn.textContent = '保存';
    saveBtn.disabled = false;
  }

  S.favs.unshift(fav);
  saveFavs();
  renderChips(); renderFavs();
  toast('已添加到首页');
}

/* ── 网页菜单 ─────────────────────────────────────────────── */
function openPageMenu() {
  const t = tabs?.current();
  if (!t) return;
  $('zoomSub').textContent = `当前 ${t.zoom}% · 仅对本网页生效`;

  document.querySelectorAll('#modeGrid .mode-card').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.mode) === Number(t.mode)));
  });
  $('modeSub').textContent = `当前「${MODE_LABEL[t.mode] || '有状态栏'}」· 下次打开此网页生效`;

  document.querySelectorAll('#segKeep button').forEach((b) => {
    b.setAttribute('aria-pressed', String((b.dataset.keep === '1') === (t.keepAlive !== false)));
  });
  $('dlgPageMore').showModal();
}

/* ── 应用内更新 ───────────────────────────────────────────── */
async function checkForUpdate() {
  $('updSub').textContent = '正在检查…';
  $('updBody').innerHTML = '';
  $('dlgUpdate').showModal();

  const r = await native.checkUpdate(APP_VERSION);
  if (!r.ok) {
    $('updSub').textContent = '';
    $('updBody').append(el('p', 'note', r.error || '检查失败'));
    return;
  }

  $('updSub').textContent = `当前 ${r.current} · 最新 ${r.latest}`;
  const box = $('updBody');

  if (!r.newer) {
    box.append(el('p', 'note', '已经是最新版本。'));
    return;
  }

  box.append(el('p', 'note', `发现新版本 ${r.latest}。`));
  if (r.notes) {
    const pre = el('pre', 'ai-out', r.notes.slice(0, 800));
    box.append(pre);
  }
  const btn = el('button', 'btn', '下载并安装');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    await native.installApk(r.url);
    toast('已开始下载');
  });
  const row = el('div', 'btn-row');
  row.append(btn);
  box.append(row);
}

/* ── toast ────────────────────────────────────────────────── */
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 1900);
}

/* ── 启动 ─────────────────────────────────────────────────── */
async function boot() {
  // 第一帧：先用 localStorage 镜像立刻画出来，不等 IndexedDB
  hydrateSync();
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener?.('change', () => {
    if (S.settings.dayNight === 'auto') applyTheme();
  });
  applyTheme();
  renderHero();
  renderChips();
  renderFavs();
  renderRecent();
  renderEngineIcon();

  // 第二帧：IndexedDB 到位后校正
  await loadState();
  mediaQuery = mediaQuery || window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme();
  renderChips();
  renderFavs();
  renderRecent();
  renderEngineIcon();

  tabs = new TabManager({
    root: $('frames'),
    layer: $('pageLayer'),
    els: {
      title: $('pgTitle'),
      host: $('pgHost'),
      progress: $('pgProgress'),
      zoomLabel: null,
      blocked: $('pgBlocked'),
    },
    onOpen: (tab) => {
      if (!tab) {
        // 退出网页层：恢复壳页面自己的系统栏
        document.documentElement.classList.remove('in-page-immersive');
        native.syncSystemBars();
        return;
      }
      $('pgTitle').textContent = tab.title;
      $('pgHost').textContent = tab.host;
      applyPageMode(tab);
      renderConsoleTarget();
      updateConsoleNote();
    },
    onUpdate: () => {
      if (document.querySelector('#view-tabs.is-active')) renderTabList();
      renderTabStrip();
      renderConsoleTarget();
    },
    onZoom: (percent, host) => {
      if (host) store.set('zoom:' + host, percent);
    },
  });

  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => showView(b.dataset.view));
  });

  $('omnibox').addEventListener('submit', (e) => {
    e.preventDefault();
    go($('omniboxInput').value);
    $('omniboxInput').blur();
  });

  renderChips(); renderFavs(); renderRecent();

  $('btnAddFav').addEventListener('click', openAddDialog);
  $('addSave').addEventListener('click', commitAdd);
  $('btnEditFavs').addEventListener('click', () => {
    S.editing = !S.editing;
    $('shell').classList.toggle('is-editing', S.editing);
    $('btnEditFavs').textContent = S.editing ? '完成' : '编辑';
  });
  $('btnClearRecent').addEventListener('click', () => {
    confirmDialog('清空最近记录？', '只移除「最近」列表，不影响收藏和站点数据。', () => {
      S.recent = [];
      saveRecent();
      renderRecent();
    });
  });

  $('btnNewTab').addEventListener('click', () => { showView('home'); $('omniboxInput').focus(); });
  $('btnEditHero').addEventListener('click', openHeroDialog);

  $('btnNewHeroLine').addEventListener('click', () => {
    const v = $('newHeroLine').value.trim();
    if (!v) return;
    S.heroLines.push(v);
    $('newHeroLine').value = '';
    saveHero(); renderHeroList(); renderHero();
  });

  $('btnNewCat').addEventListener('click', () => {
    const name = $('newCatName').value.trim();
    if (!name) return;
    S.cats.push({ id: 'c' + Date.now().toString(36), name });
    $('newCatName').value = '';
    saveCats(); renderCatList(); renderChips();
  });

  $('confirmNo').addEventListener('click', () => { confirmHandler = null; $('dlgConfirm').close(); });
  $('confirmYes').addEventListener('click', async () => {
    const fn = confirmHandler;
    confirmHandler = null;
    $('dlgConfirm').close();
    if (fn) await fn();
  });

  document.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => { $(b.dataset.close)?.close(); });
  });

  bindConsole();
  bindSettings();
  bindColorDialog();
  bindEngines();
  bindSiteView();
  bindPageLayer();

  // 网页内的控制台浮钮 → 切到控制台视图
  try {
    globalThis.Capacitor?.Plugins?.JianSuNative?.addListener?.('consoleRequested', () => {
      showView('console');
    });
  } catch {}

  // 从外部链接（默认浏览器 / 桌面快捷方式）进入
  window.__jiansuLaunch = (url, mode) => {
    if (!url) return;
    openUrl(url, prettyName(url), mode || 3);
  };
  try {
    const r = await native.rawLaunchUrl();
    if (r) window.__jiansuLaunch(r.url, r.mode);
  } catch {}

  // 返回键逐级退栈：原生先问网页历史，再问这里
  window.__jiansuBack = () => {
    // 1. 网页层开着 → 收起
    if (!document.getElementById('pageLayer').hidden) {
      tabs.hideLayer();
      syncBars();
      return true;
    }
    // 2. 不在首页 → 回首页
    const active = document.querySelector('.view.is-active')?.id;
    if (active && active !== 'view-home') {
      showView('home');
      return true;
    }
    // 3. 首页 → 交给原生最小化
    return false;
  };

  window.addEventListener('scroll', () => {
    $('shell').classList.toggle('is-scrolled', window.scrollY > 4);
  }, { passive: true });

  window.addEventListener('resize', syncBars);

  // 返回键由原生 onBackPressed 接管（见 MainActivity），
  // 这里不再注册 backButton 监听，避免两边抢事件导致直接退出。

  await native.enterImmersive();
  await native.applyInsets();
  await store.requestPersist().catch(() => {});
  showView('home');
}

function bindPageLayer() {
  $('pgBack').addEventListener('click', async () => {
    const went = await tabs.back();
    if (!went) { await tabs.hideLayer(); syncBars(); }
  });
  $('pgFwd').addEventListener('click', () => tabs.forward());
  $('pgReload').addEventListener('click', () => tabs.reload());
  $('pgMenu').addEventListener('click', openPageMenu);
  $('pgBlockedOpen').addEventListener('click', () => {
    const t = tabs.current();
    if (t) window.open(t.url, '_blank', 'noopener');
  });
  $('pgBlockedBack').addEventListener('click', async () => { await tabs.hideLayer(); syncBars(); });

  $('pmZoomIn').addEventListener('click', async () => {
    const z = await tabs.zoom(10);
    $('zoomSub').textContent = `当前 ${z}% · 仅对本网页生效`;
  });
  $('pmZoomOut').addEventListener('click', async () => {
    const z = await tabs.zoom(-10);
    $('zoomSub').textContent = `当前 ${z}% · 仅对本网页生效`;
  });
  $('pmZoomReset').addEventListener('click', async () => {
    await tabs.setZoom(100);
    $('zoomSub').textContent = '当前 100% · 仅对本网页生效';
  });

  document.querySelectorAll('#modeGrid .mode-card').forEach((b) => {
    b.addEventListener('click', async () => {
      const t = tabs.current();
      if (!t) return;
      const m = Number(b.dataset.mode);
      t.mode = m;
      await setPageMode(t.host, m);

      document.querySelectorAll('#modeGrid .mode-card').forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b));
      });
      $('modeSub').textContent = `当前「${MODE_LABEL[m]}」· 下次打开此网页生效`;

      applyPageMode(t);
      toast(`已设为「${MODE_LABEL[m]}」`);
    });
  });

  document.querySelectorAll('#segKeep button').forEach((b) => {
    b.addEventListener('click', async () => {
      const t = tabs.current();
      if (!t) return;
      t.keepAlive = b.dataset.keep === '1';
      await store.set('keep:' + t.host, t.keepAlive);
      await native.keepAlive(t.id, t.keepAlive);
      document.querySelectorAll('#segKeep button').forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b));
      });
      toast(t.keepAlive ? '已开启保活' : '已关闭保活');
    });
  });

  $('pmPersist').addEventListener('click', async () => {
    const r = await store.requestPersist();
    if (r) {
      confirmDialog('持久化已开启',
        '这个站点的数据不会因为系统空间紧张而被优先清理。你可以随时在设置里单独清除它。',
        () => {}, { okLabel: '知道了', cancel: false, tone: 'normal' });
    } else {
      toast('系统未授予持久化');
    }
  });

  $('pmShortcut').addEventListener('click', async () => {
    const t = tabs.current();
    if (!t) return;
    const r = await native.addShortcut({
      url: t.url, title: t.title, icon: t.icon, mode: 3,
    });
    toast(r.ok ? '已请求创建桌面图标（默认全屏）' : (r.error || '创建失败'));
  });

  $('pmConsole').addEventListener('click', () => {
    $('dlgPageMore').close();
    showView('console');
  });

  $('pmClearSite').addEventListener('click', () => {
    const t = tabs.current();
    if (!t) return;
    $('dlgPageMore').close();
    confirmDialog(`清除 ${t.host} 的数据？`,
      '将移除该站点的 Cookie、缓存、本地存储、缩放与保活设置。此操作不可撤销。',
      async () => {
        try {
          await native.clearSiteData(t.url);
          await store.remove('zoom:' + t.host);
          await store.remove('keep:' + t.host);
          toast('已清除');
          renderSiteList();
        } catch (e) {
          console.warn(e);
          toast('部分数据未能清除');
        }
      });
  });

  $('pmClose').addEventListener('click', async () => {
    $('dlgPageMore').close();
    const t = tabs.current();
    if (t) await tabs.close(t.id);
    if (!tabs.tabs.length) syncBars();
  });

  $('zoomInBtn')?.addEventListener('click', () => tabs.zoom(10));
  $('zoomOutBtn')?.addEventListener('click', () => tabs.zoom(-10));
}

document.addEventListener('DOMContentLoaded', boot);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { syncBars(); native.applyInsets(); }
});
