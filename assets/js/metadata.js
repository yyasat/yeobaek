/* ─────────────────────────────────────────────────────────────
   metadata.js — 填入网址后自动取「名称 + 图标」

   取法顺序（逐级降级，任何一步失败都不阻塞保存）：
   1. 本身是「已打开的标签」→ 直接用标签标题
   2. 原生层可用（APK）→ 走 CapacitorHttp，绕过 CORS 读 <title>
   3. 同源 / 允许 CORS → fetch 读 <title>
   4. 全部失败 → 用域名推导一个干净的名字
   图标一律走站点自身 /favicon.ico，失败再退到公共图标服务，最后退到首字母方块。
   ───────────────────────────────────────────────────────────── */

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (/^(javascript|data|vbscript|file):/i.test(s)) return null;

  // 像域名的，补 https
  const looksLikeHost = /^[\w-]+(\.[\w-]+)+(\/|$|:|\?)/.test(s) || /^localhost(:\d+)?/.test(s);
  if (looksLikeHost && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;

  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.toString();
  } catch { return null; }
}

export function isSearchQuery(input) {
  const s = String(input || '').trim();
  if (!s) return false;
  if (/\s/.test(s)) return true;                       // 有空格 → 搜索
  if (/^[\w-]+(\.[\w-]+)+(\/|$|:|\?)/.test(s)) return false;
  if (/^localhost(:\d+)?/.test(s)) return false;
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(s);
}

export function searchUrl(q, engine = 'bing') {
  const e = {
    bing: 'https://www.bing.com/search?q=',
    google: 'https://www.google.com/search?q=',
    duck: 'https://duckduckgo.com/?q=',
  }[engine] || 'https://www.bing.com/search?q=';
  return e + encodeURIComponent(q);
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function prettyName(url) {
  const host = hostOf(url);
  if (!host) return '网页';
  const core = host.split('.').slice(0, -1).join('.') || host;
  const last = core.split('.').pop();
  return last.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function faviconCandidates(url) {
  let origin = '';
  try { origin = new URL(url).origin; } catch {}
  const host = hostOf(url);
  const list = [];
  if (origin) list.push(`${origin}/favicon.ico`);
  if (host) list.push(`https://icons.duckduckgo.com/ip3/${host}.ico`);
  if (host) list.push(`https://www.google.com/s2/favicons?domain=${host}&sz=64`);
  return list;
}

async function nativeGet(url) {
  const cap = globalThis.Capacitor;
  if (!cap?.Plugins?.CapacitorHttp) return null;
  try {
    const res = await cap.Plugins.CapacitorHttp.get({ url, responseType: 'text', readTimeout: 6000 });
    if (res?.status >= 200 && res.status < 400) return String(res.data || '');
  } catch {}
  return null;
}

function titleFromHtml(html) {
  if (!html) return null;
  const m = html.match(/<title[^>]*>([\s\S]{1,200}?)<\/title>/i);
  if (!m) return null;
  const t = m[1].replace(/\s+/g, ' ').trim();
  if (!t || t.length < 1) return null;
  return t.length > 42 ? t.slice(0, 40) + '…' : t;
}

export async function resolveMeta(url) {
  const out = { url, title: '', icon: '', host: hostOf(url) };

  const viaNative = await nativeGet(url);
  out.title = titleFromHtml(viaNative) || '';

  if (!out.title) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', mode: 'cors' });
      clearTimeout(t);
      if (res.ok) out.title = titleFromHtml(await res.text()) || '';
    } catch { /* CORS 或超时，降级 */ }
  }

  if (!out.title) out.title = prettyName(url);
  out.icon = faviconCandidates(url)[0];
  out.iconFallbacks = faviconCandidates(url);
  return out;
}

/* 图标在 <img> 上逐级回退 */
export function attachIconFallback(imgEl, candidates, letterEl) {
  let i = 0;
  const next = () => {
    if (i >= candidates.length) {
      imgEl.remove();
      if (letterEl) letterEl.hidden = false;
      return;
    }
    imgEl.src = candidates[i++];
  };
  imgEl.addEventListener('error', next, { once: false });
  next();
}
