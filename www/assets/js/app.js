/* ─────────────────────────────────────────────────────────────
   app.js — 主控
   ───────────────────────────────────────────────────────────── */

import * as store from './store.js';
import * as native from './native.js';
import { normalizeUrl, isSearchQuery, searchUrl, hostOf, prettyName, resolveMeta } from './metadata.js';
import { TabManager } from './tabs.js';
import { generate, pageFacts, SNIPPETS } from './ai.js';

const THEMES = [
  { id: 'haneul',     name: '하늘',    sw: ['#EEF2F5', '#E2E9EE', '#6C8296', '#1E272E'] },
  { id: 'mulan-gae',  name: '물안개',  sw: ['#EDF0F2', '#E0E6E9', '#6B7C88', '#1F272B'] },
  { id: 'cheonghoe',  name: '청회',    sw: ['#E9EEF2', '#DAE3EA', '#5C7488', '#1C262E'] },
  { id: 'meok',       name: '먹',      sw: ['#151A1E', '#262E34', '#8FA5B4', '#E4EBF0'] },
  { id: 'joyakdol',   name: '조약돌',  sw: ['#ECEFF0', '#DFE4E5', '#6B8487', '#1E2626'] },
  { id: 'saebyeok',   name: '새벽',    sw: ['#EDEFF5', '#E1E4ED', '#7080A0', '#1F2530'] },
];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const S = {
  cats: [],
  favs: [],
  recent: [],
  settings: { theme: 'haneul', fs: 15, zoom: 100, engine: 'bing' },
  activeCat: 'all',
  editing: false,
  aiCode: '',
};

/* ── 状态载入 ─────────────────────────────────────────────── */
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
  S.settings = Object.assign(S.settings, await store.get('settings', {}));
  applySettings();
}

function saveFavs() { store.set('favs', S.favs); }
function saveCats() { store.set('cats', S.cats); }
function saveSettings() { store.set('settings', S.settings); }
function saveRecent() { store.set('recent', S.recent.slice(0, 24)); }

/* ── 设置应用 ─────────────────────────────────────────────── */
function applySettings() {
  const { theme, fs, zoom } = S.settings;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--fs', `${fs}px`);
  document.documentElement.style.setProperty('--zoom', `${zoom}%`);
  const meta = document.querySelector('meta[name="color-scheme"]');
  const dark = THEMES.find((t) => t.id === theme)?.sw[0] === '#151A1E';
  if (meta) meta.content = dark ? 'dark' : 'light';
  tabs?.setZoomDefault(zoom);
  syncBars();
}

let barsTimer = null;
function syncBars() {
  clearTimeout(barsTimer);
  barsTimer = setTimeout(() => {
    native.syncSystemBars(native.readThemeBg(), native.isLightColor(native.readThemeBg()));
  }, 60);
}

/* ── 视图切换 ─────────────────────────────────────────────── */
function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
  if (name === 'console') renderConsoleTarget();
  if (name === 'tabs') renderTabList();
  if (name === 'settings') renderSettings();
}

/* ── 首页渲染 ─────────────────────────────────────────────── */
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
}

function iconTile(fav) {
  const tile = el('div', 'fav-tile');
  const letter = el('span', 'fav-letter', (fav.title || '?').trim().charAt(0).toUpperCase());
  letter.hidden = false;
  const img = el('img');
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.style.display = 'none';
  img.addEventListener('load', () => { img.style.display = 'block'; letter.hidden = true; });
  img.addEventListener('error', () => { img.style.display = 'none'; letter.hidden = false; });
  img.src = fav.icon || `https://icons.duckduckgo.com/ip3/${fav.host}.ico`;
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
    const btn = el('button', '');
    btn.type = 'button';
    btn.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;min-width:0;width:100%';
    btn.append(iconTile(fav));
    btn.append(el('span', 'fav-name', fav.title));
    btn.addEventListener('click', () => {
      if (S.editing) return;
      openUrl(fav.url, fav.title);
    });

    const del = el('button', 'fav-del');
    del.type = 'button';
    del.setAttribute('aria-label', `移除 ${fav.title}`);
    del.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-x"/></svg>';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      S.favs = S.favs.filter((f) => f.id !== fav.id);
      saveFavs(); renderFavs(); renderChips();
      toast('已移除');
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
    const b = el('button');
    b.type = 'button';
    b.append(el('span', 'r-dot'));
    const body = el('span', 'r-body');
    body.append(el('span', 'r-t', r.title));
    body.append(el('span', 'r-h', hostOf(r.url)));
    b.append(body);
    b.addEventListener('click', () => openUrl(r.url, r.title));
    li.append(b);
    list.append(li);
  });
}

/* ── 打开网页 ─────────────────────────────────────────────── */
function pushRecent(url, title) {
  S.recent = [{ url, title, at: Date.now() }, ...S.recent.filter((r) => r.url !== url)].slice(0, 24);
  saveRecent();
  renderRecent();
}

function openUrl(raw, title) {
  const url = normalizeUrl(raw);
  if (!url) { toast('网址无法识别'); return; }
  tabs.create(url, { title });
  pushRecent(url, title || prettyName(url));
  showView('home');
  syncBars();
}

function go(input) {
  const v = String(input || '').trim();
  if (!v) return;
  if (isSearchQuery(v)) {
    tabs.create(searchUrl(v, S.settings.engine), { title: v });
    return;
  }
  const url = normalizeUrl(v);
  if (!url) { toast('网址无法识别'); return; }
  tabs.create(url, { title: prettyName(url) });
  pushRecent(url, prettyName(url));
  syncBars();
}

/* ── 标签管理 ─────────────────────────────────────────────── */
let tabs = null;

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
    img.alt = ''; img.referrerPolicy = 'no-referrer';
    img.src = `https://icons.duckduckgo.com/ip3/${t.host}.ico`;
    img.addEventListener('error', () => { ic.textContent = (t.title || '?')[0].toUpperCase(); img.remove(); });
    ic.append(img);

    const body = el('button', 'tab-body');
    body.type = 'button';
    body.style.cssText = 'border:0;background:none;padding:0;text-align:left';
    body.append(el('span', 'tab-t', t.title || hostOf(t.url)));
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
  const pre = el('pre', '', fmt(text));
  line.append(pre);
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

function runCode(code) {
  log('in', code);
  const r = tabs?.evaluate(code);
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

  $('consoleForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('consoleInput').value.trim();
    if (!code) return;
    runCode(code);
    $('consoleInput').value = '';
  });

  $('consoleClear').addEventListener('click', () => { logBox().innerHTML = ''; });

  $('aiForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('aiInput').value.trim();
    if (!q) return;
    let facts = {};
    try {
      const t = tabs?.current();
      if (t) facts = pageFacts(t.iframe.contentWindow);
    } catch {}
    const out = generate(q, facts);
    S.aiCode = out.code;
    const pre = $('aiOut');
    pre.hidden = false;
    pre.textContent = out.code;
    $('aiActions').hidden = false;
    log('sys', out.note);
  });

  $('aiRun').addEventListener('click', () => { if (S.aiCode) runCode(S.aiCode); });
  $('aiInsert').addEventListener('click', () => { $('consoleInput').value = S.aiCode; });
}

/* ── 设置 ─────────────────────────────────────────────────── */
function renderSettings() {
  const grid = $('themeGrid');
  grid.innerHTML = '';
  THEMES.forEach((t) => {
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
      saveSettings();
      applySettings();
      renderSettings();
    });
    grid.append(b);
  });

  $('fontRange').value = S.settings.fs;
  $('fontOut').textContent = S.settings.fs;
  $('zoomRange').value = S.settings.zoom;
  $('zoomOut').textContent = `${S.settings.zoom}%`;
  $('buildInfo').textContent = `web ${new Date().getFullYear()} · ${native.isNative() ? 'native ' + native.platform() : 'browser'}`;
  refreshStorage();
  renderDataList();
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

function renderDataList() {
  const ul = $('dataList');
  ul.innerHTML = '';
  const hosts = [...new Set([...S.favs.map((f) => f.host), ...S.recent.map((r) => hostOf(r.url))])].filter(Boolean);
  if (!hosts.length) {
    ul.append(el('li', '', '还没有站点数据。'));
    return;
  }
  hosts.slice(0, 12).forEach((h) => {
    const li = el('li');
    li.append(el('span', 'd-host', h));
    const b = el('button', 'btn ghost sm', '清除');
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (!confirm(`清除 ${h} 的全部 Cookie、缓存与存储？`)) return;
      await native.clearSiteData(`https://${h}`);
      S.favs = S.favs.filter((f) => f.host !== h);
      saveFavs();
      renderFavs(); renderDataList();
      toast(`${h} 已清除`);
    });
    li.append(b);
    ul.append(li);
  });
}

function bindSettings() {
  $('fontRange').addEventListener('input', (e) => {
    S.settings.fs = Number(e.target.value);
    $('fontOut').textContent = S.settings.fs;
    document.documentElement.style.setProperty('--fs', `${S.settings.fs}px`);
    saveSettings();
  });
  $('zoomRange').addEventListener('input', (e) => {
    S.settings.zoom = Number(e.target.value);
    $('zoomOut').textContent = `${S.settings.zoom}%`;
    tabs?.setZoomDefault(S.settings.zoom);
    saveSettings();
  });

  $('btnPersist').addEventListener('click', async () => {
    const r = await store.requestPersist();
    if (r === null) toast('此环境不支持持久化申请');
    else if (r) toast('已获得持久化存储');
    else toast('系统未授予，可稍后再试');
    refreshStorage();
  });

  $('btnBackup').addEventListener('click', async () => {
    const data = { cats: S.cats, favs: S.favs, recent: S.recent, settings: S.settings, at: Date.now() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yeobaek-${new Date().toISOString().slice(0, 10)}.json`;
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
        if (d.settings) { S.settings = Object.assign(S.settings, d.settings); saveSettings(); applySettings(); }
        renderChips(); renderFavs(); renderRecent(); renderSettings();
        toast('已恢复');
      } catch { toast('文件无法解析'); }
    });
    inp.click();
  });

  $('btnClipRead').addEventListener('click', async () => {
    const r = await native.readClipboard();
    if (!r.ok) { toast('未获得剪贴板权限'); return; }
    if (r.text) { $('omniboxInput').value = r.text.trim(); showView('home'); }
    toast(r.text ? '已粘贴到地址栏' : '剪贴板为空');
  });

  $('btnClipWrite').addEventListener('click', async () => {
    const ok = await native.writeClipboard('여백 · 留白');
    toast(ok ? '已写入剪贴板' : '写入被拒绝');
  });

  $('btnNotify').addEventListener('click', async () => {
    const p = await native.requestNotifications();
    toast(p === 'granted' ? '通知已开启' : p === 'unsupported' ? '此环境不支持' : '未授权');
  });

  $('btnWipeAll').addEventListener('click', async () => {
    if (!confirm('清除本站全部数据：收藏、分类、标签、设置。此操作不可撤销。')) return;
    await native.clearAllData();
    S.favs = []; S.recent = []; S.cats = [{ id: 'all', name: '全部' }];
    saveFavs(); saveCats(); saveRecent();
    renderChips(); renderFavs(); renderRecent();
    toast('已清除');
  });
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
  const extra = el('option', '', '新建分类…');
  extra.value = '__new';
  sel.append(extra);

  $('addUrl').value = $('omniboxInput').value.trim();
  $('addTitle').value = '';
  $('dlgAdd').showModal();
}

async function commitAdd() {
  const raw = $('addUrl').value.trim();
  const url = normalizeUrl(raw);
  if (!url) { toast('网址无法识别'); return; }

  let cat = $('addCat').value;
  if (cat === '__new') {
    const name = prompt('新分类名称');
    if (!name) return;
    const id = 'c' + Date.now().toString(36);
    S.cats.push({ id, name: name.trim() });
    saveCats();
    cat = id;
  }

  const fav = { id: 'f' + Date.now().toString(36), url, title: $('addTitle').value.trim(), cat, host: hostOf(url), icon: '' };
  const meta = await resolveMeta(url);
  if (!fav.title) fav.title = meta.title;
  fav.icon = meta.icon;

  S.favs.unshift(fav);
  saveFavs();
  renderChips(); renderFavs();
  toast('已添加到首页');
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
  await loadState();

  const layer = $('pageLayer');
  tabs = new TabManager({
    root: $('frames'),
    layer,
    els: {
      title: $('pgTitle'), host: $('pgHost'), progress: $('pgProgress'),
      zoomLabel: $('zoomLabel'), blocked: $('pgBlocked'),
    },
    onOpen: (tab) => {
      if (!tab) return;
      $('pgTitle').textContent = tab.title;
      $('pgHost').textContent = tab.host;
      native.syncSystemBars(native.readThemeBg(), native.isLightColor(native.readThemeBg()));
      renderConsoleTarget();
    },
    onUpdate: () => { if (document.querySelector('#view-tabs.is-active')) renderTabList(); renderConsoleTarget(); },
  });

  // 导航
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.addEventListener('click', () => showView(b.dataset.view));
  });

  // 地址栏
  $('omnibox').addEventListener('submit', (e) => {
    e.preventDefault();
    go($('omniboxInput').value);
    $('omniboxInput').blur();
  });

  // 收藏
  renderChips(); renderFavs(); renderRecent();
  $('btnAddFav').addEventListener('click', openAddDialog);
  $('addSave').addEventListener('click', (e) => {
    e.preventDefault();
    commitAdd().then(() => $('dlgAdd').close());
  });

  // 标签
  $('btnNewTab').addEventListener('click', () => {
    showView('home');
    $('omniboxInput').focus();
  });

  bindConsole();
  bindSettings();
  bindPageLayer();

  // 顶栏投影
  window.addEventListener('scroll', () => {
    document.getElementById('shell').classList.toggle('is-scrolled', window.scrollY > 4);
  }, { passive: true });

  // 主题在系统切换时应保持，但仍同步栏色
  window.addEventListener('resize', syncBars);

  await native.enterImmersive(native.readThemeBg());
  await store.requestPersist().catch(() => {});
  showView('home');
}

function bindPageLayer() {
  $('pgBack').addEventListener('click', () => tabs.back());
  $('pgReload').addEventListener('click', () => tabs.reload());
  $('pgOpen').addEventListener('click', () => {
    const t = tabs.current();
    if (t) window.open(t.url, '_blank', 'noopener');
  });
  $('zoomInBtn').addEventListener('click', () => tabs.zoom(10));
  $('zoomOutBtn').addEventListener('click', () => tabs.zoom(-10));
  $('pgBlockedOpen').addEventListener('click', () => {
    const t = tabs.current();
    if (t) window.open(t.url, '_blank', 'noopener');
  });
}

document.addEventListener('DOMContentLoaded', boot);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncBars();
});

/* 安卓返回键：先退页面层，再退视图 */
window.addEventListener('popstate', () => {
  if (tabs?.current()) { tabs.hideLayer(); history.pushState(null, '', location.pathname); }
});
history.pushState(null, '', location.pathname);
