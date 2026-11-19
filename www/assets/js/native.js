/* ─────────────────────────────────────────────────────────────
   native.js — 原生桥

   两种运行环境：
   · 纯浏览器 → 降级到 Web API
   · APK（Capacitor）→ 调用 JianSuNative 插件

   插件方法：
     enterImmersive / setSystemBars
     getInsets                取真实安全区，喂给 CSS 变量
     openWebView({url,id})    原生 WebView 开页
     closeWebView / webViewBack / webViewForward / webViewReload
     webViewEval({id,code})   evaluateJavascript，可跨域
     webViewZoom / webViewInfo
     webViewClearData
     addShortcut / removeShortcut
     clearSiteData / clearAllData
     requestPermission({type})
     readClipboard / writeClipboard
     setKeepAlive
     checkUpdate
   ───────────────────────────────────────────────────────────── */

const cap = () => globalThis.Capacitor;
const plugin = () => cap()?.Plugins?.JianSuNative || null;

export const isNative = () => Boolean(cap()?.isNativePlatform?.());
export const platform = () => cap()?.getPlatform?.() || 'web';

function call(name, args = {}) {
  const p = plugin();
  if (!p || typeof p[name] !== 'function') return Promise.reject(new Error('原生能力不可用'));
  return Promise.resolve(p[name](args));
}

/* ── 系统栏 ───────────────────────────────────────────────── */
export function readThemeBg() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  return v || '#EDF1F4';
}

export function isLightColor(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return true;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  return L > 0.42;
}

export function setMetaTheme(color) {
  let m = document.getElementById('metaTheme');
  if (!m) {
    m = document.createElement('meta');
    m.name = 'theme-color';
    m.id = 'metaTheme';
    document.head.appendChild(m);
  }
  m.setAttribute('content', color);
}

export async function enterImmersive() {
  const c = readThemeBg();
  const dark = isLightColor(c);
  setMetaTheme(c);
  await applyInsets();
  if (!isNative()) return { mode: 'web' };
  try { return await call('enterImmersive', { color: c, darkIcons: dark }); }
  catch { return { mode: 'native-failed' }; }
}

export async function syncSystemBars() {
  const c = readThemeBg();
  setMetaTheme(c);
  if (!isNative()) return;
  try { await call('setSystemBars', { color: c, darkIcons: isLightColor(c) }); } catch {}
}

/**
 * APK 里 env(safe-area-inset-*) 在 WebView 中常常返回 0，
 * 状态栏文字会压在内容上。这里从原生取真实值写进 CSS 变量。
 */
export async function applyInsets() {
  if (!isNative()) return;
  try {
    const r = await call('getInsets');
    const root = document.documentElement.style;
    if (typeof r?.top === 'number') root.setProperty('--safe-t', `${r.top}px`);
    if (typeof r?.bottom === 'number') root.setProperty('--safe-b', `${r.bottom}px`);
    if (typeof r?.left === 'number') root.setProperty('--safe-l', `${r.left}px`);
    if (typeof r?.right === 'number') root.setProperty('--safe-r', `${r.right}px`);
  } catch {}
}

/* ── 原生 WebView 网页层 ─────────────────────────────────── */
export const webview = {
  async open({ id, url }) {
    if (!isNative()) return { ok: false, mode: 'web' };
    try { return await call('openWebView', { id, url }); }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  },
  async close(id) {
    if (!isNative()) return;
    try { await call('closeWebView', { id }); } catch {}
  },
  async back(id) {
    if (!isNative()) return { canGoBack: false };
    try { return await call('webViewBack', { id }); } catch { return {}; }
  },
  async forward(id) {
    if (!isNative()) return { canGoForward: false };
    try { return await call('webViewForward', { id }); } catch { return {}; }
  },
  async reload(id) {
    if (!isNative()) return;
    try { await call('webViewReload', { id }); } catch {}
  },
  async eval(id, code) {
    if (!isNative()) return { ok: false, error: '原生能力不可用' };
    try { return await call('webViewEval', { id, code }); }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  },
  async zoom(id, percent) {
    if (!isNative()) return;
    try { await call('webViewZoom', { id, zoom: percent }); } catch {}
  },
  async info(id) {
    if (!isNative()) return null;
    try { return await call('webViewInfo', { id }); } catch { return null; }
  },
  async clearData(url) {
    if (!isNative()) return false;
    try { await call('webViewClearData', { url }); return true; } catch { return false; }
  },
  async setVisible(id) {
    if (!isNative()) return;
    try { await call('webViewVisible', { id }); } catch {}
  },
  async hideAll() {
    if (!isNative()) return;
    try { await call('webViewHideAll'); } catch {}
  },
};

/* ── 桌面快捷方式 / PWA ──────────────────────────────────── */
export async function addShortcut({ url, title, icon }) {
  if (isNative()) {
    try {
      const r = await call('addShortcut', {
        url, title, icon: icon || '', shortLabel: (title || '').slice(0, 8),
      });
      return { ok: true, ...r };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }
  return { ok: false, error: '浏览器内无法写入桌面图标' };
}

export async function removeShortcut(url) {
  if (!isNative()) return;
  try { await call('removeShortcut', { url }); } catch {}
}

/* ── 数据 ─────────────────────────────────────────────────── */
export async function clearSiteData(url) {
  if (isNative()) {
    try { await call('clearSiteData', { url }); return true; } catch {}
  }
  try {
    document.cookie.split(';').forEach((c) => {
      const n = c.split('=')[0].trim();
      document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
  } catch {}
  return true;
}

export async function clearAllData() {
  if (isNative()) {
    try { await call('clearAllData'); } catch {}
  }
  try {
    if (globalThis.caches) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
}

export async function keepAlive(id, on) {
  if (!isNative()) return;
  try { await call('setKeepAlive', { id, enabled: Boolean(on) }); } catch {}
}

/* ── 权限 ─────────────────────────────────────────────────── */
export async function requestPermission(type) {
  if (isNative()) {
    try { return await call('requestPermission', { type }); }
    catch (e) { return { granted: false, error: String(e?.message || e) }; }
  }
  // Web 侧尽力而为
  try {
    if (type === 'notifications' && 'Notification' in window) {
      const p = await Notification.requestPermission();
      return { granted: p === 'granted', status: p };
    }
    if (type === 'clipboard-read' && navigator.permissions) {
      const s = await navigator.permissions.query({ name: 'clipboard-read' });
      return { granted: s.state === 'granted', status: s.state };
    }
    if (type === 'clipboard-write' && navigator.permissions) {
      const s = await navigator.permissions.query({ name: 'clipboard-write' });
      return { granted: s.state === 'granted', status: s.state };
    }
  } catch {}
  return { granted: false, status: 'unavailable' };
}

export async function readClipboard() {
  try {
    if (navigator.clipboard?.readText) return { ok: true, text: await navigator.clipboard.readText() };
  } catch {}
  if (isNative()) {
    try { const r = await call('readClipboard'); return { ok: true, text: r?.value ?? '' }; } catch {}
  }
  return { ok: false, text: '' };
}

export async function writeClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  if (isNative()) {
    try { await call('writeClipboard', { text }); return true; } catch {}
  }
  return false;
}

/* ── 应用内更新 ──────────────────────────────────────────── */
export async function checkUpdate(currentVersion) {
  const repo = 'yyasat/yeobaek';
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return { ok: false, error: '暂时无法检查更新' };
    const d = await res.json();
    const latest = String(d.tag_name || '').replace(/^v/, '');
    const apk = (d.assets || []).find((a) => /\.apk$/i.test(a.name));
    return {
      ok: true,
      latest,
      current: currentVersion,
      newer: compareVersion(latest, currentVersion) > 0,
      url: apk?.browser_download_url || d.html_url,
      notes: d.body || '',
    };
  } catch {
    return { ok: false, error: '网络不可用' };
  }
}

export function compareVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export async function installApk(url) {
  if (isNative()) {
    try { await call('installApk', { url }); return true; } catch {}
  }
  window.open(url, '_blank', 'noopener');
  return false;
}

/* ── 系统返回键 ──────────────────────────────────────────── */
export function onBackButton(handler) {
  if (!isNative()) {
    history.pushState(null, '', location.pathname);
    window.addEventListener('popstate', () => handler());
    return;
  }
  try {
    cap()?.Plugins?.App?.addListener('backButton', () => handler());
  } catch {}
}

export function exitApp() {
  try { cap()?.Plugins?.App?.exitApp?.(); } catch {}
}
