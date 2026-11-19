/* ─────────────────────────────────────────────────────────────
   native.js — 原生桥

   同一个前端跑两种环境：
   · 纯浏览器 → 全部降级到 Web API，功能少但不出错
   · Capacitor APK → 调用 YeobaekNative 插件，拿到系统级能力

   插件方法（android/YeobaekNativePlugin.java 同步实现）：
     enterImmersive(color)      沉浸式全屏 + 状态栏/导航栏底色
     setSystemBars(color, dark) 操作后再次同步栏色与图标明暗
     addShortcut({url,title,icon})   ShortcutManager 桌面图标
     removeShortcut(url)
     clearSiteData(url)          CookieManager + WebStorage 彻底清
     clearAllData()
     requestStoragePermission()
     readClipboard() / writeClipboard(text)
   ───────────────────────────────────────────────────────────── */

const cap = () => globalThis.Capacitor;
const plugin = () => cap()?.Plugins?.YeobaekNative || null;

export const isNative = () => Boolean(cap()?.isNativePlatform?.());
export const platform = () => cap()?.getPlatform?.() || 'web';

function call(name, args = {}) {
  const p = plugin();
  if (!p || typeof p[name] !== 'function') return Promise.reject(new Error('native-unavailable'));
  return Promise.resolve(p[name](args));
}

/* ── 全屏 / 系统栏 ───────────────────────────────────────── */
/** 把状态栏和导航栏都设成给定底色，并把网页铺到状态栏下方。 */
export async function enterImmersive(color, darkIcons) {
  const c = color || readThemeBg();
  const dark = typeof darkIcons === 'boolean' ? darkIcons : isLightColor(c);

  document.documentElement.style.setProperty('--bar-color', c);
  setMetaTheme(c);

  if (!isNative()) {
    // 浏览器：只能尽量把壳铺满，状态栏由系统处理
    await tryWebFullscreen();
    return { mode: 'web' };
  }
  try {
    return await call('enterImmersive', { color: c, darkIcons: dark });
  } catch {
    return { mode: 'native-failed' };
  }
}

/** 每次界面变更后调用（切视图、切主题、开关页面层）。 */
export async function syncSystemBars(color, darkIcons) {
  const c = color || readThemeBg();
  const dark = typeof darkIcons === 'boolean' ? darkIcons : isLightColor(c);
  setMetaTheme(c);
  if (!isNative()) return;
  try { await call('setSystemBars', { color: c, darkIcons: dark }); } catch {}
}

async function tryWebFullscreen() {
  if (document.fullscreenElement) return;
  const el = document.documentElement;
  try { await el.requestFullscreen?.({ navigationUI: 'hide' }); } catch {}
}

export function readThemeBg() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  return v || '#F2F0EA';
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
  // iOS 独立模式下也同步状态栏样式
  let s = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (s) s.content = isLightColor(color) ? 'default' : 'black-translucent';
}

/** 相对亮度判断，用来决定状态栏图标是深色还是浅色。 */
export function isLightColor(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return true;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.42;
}

/* ── 桌面快捷方式 ───────────────────────────────────────── */
export async function addShortcut({ url, title, icon }) {
  if (isNative()) {
    try {
      await call('addShortcut', { url, title, icon: icon || '', shortLabel: (title || '').slice(0, 10) });
      return { ok: true, mode: 'native' };
    } catch (e) { return { ok: false, mode: 'native', error: String(e?.message || e) }; }
  }
  return { ok: false, mode: 'web', error: '浏览器内无法写入桌面图标，请用浏览器菜单「添加到主屏幕」。' };
}

export async function removeShortcut(url) {
  if (!isNative()) return { ok: false };
  try { await call('removeShortcut', { url }); return { ok: true }; } catch { return { ok: false }; }
}

/* ── 数据清除 ───────────────────────────────────────────── */
export async function clearSiteData(url) {
  if (isNative()) {
    try { await call('clearSiteData', { url }); return true; } catch {}
  }
  // Web 侧：尽力清除该源可触达的 Cookie 与缓存
  try {
    document.cookie.split(';').forEach((c) => {
      const name = c.split('=')[0].trim();
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
    if (globalThis.caches) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
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
    if (indexedDB?.databases) {
      const dbs = await indexedDB.databases();
      dbs.forEach((d) => d.name && indexedDB.deleteDatabase(d.name));
    }
  } catch {}
}

export async function requestStoragePermission() {
  if (!isNative()) return { ok: false, mode: 'web' };
  try { return await call('requestStoragePermission'); } catch { return { ok: false }; }
}

/* ── 剪贴板 ─────────────────────────────────────────────── */
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

export async function requestNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}
