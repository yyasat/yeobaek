/* ─────────────────────────────────────────────────────────────
   metadata.js — 填网址后自动取「名称 + 图标」
   ───────────────────────────────────────────────────────────── */

export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (/^(javascript|data|vbscript|file|about):/i.test(s)) return null;

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
  if (/\s/.test(s)) return true;
  if (/^[\w-]+(\.[\w-]+)+(\/|$|:|\?)/.test(s)) return false;
  if (/^localhost(:\d+)?/.test(s)) return false;
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(s);
}

export function searchUrl(q, engine = 'bing') {
  const map = {
    bing: 'https://www.bing.com/search?q=',
    baidu: 'https://www.baidu.com/s?wd=',
    google: 'https://www.google.com/search?q=',
  };
  return (map[engine] || map.bing) + encodeURIComponent(q);
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
  if (host) list.push(`https://www.google.com/s2/favicons?domain=${host}&sz=128`);
  return list;
}

async function nativeGet(url) {
  const cap = globalThis.Capacitor;
  if (!cap?.Plugins?.JianSuNative) return null;
  try {
    const res = await cap.Plugins.JianSuNative.httpGet({ url });
    if (res?.status >= 200 && res.status < 400) return String(res.data || '');
  } catch {}
  return null;
}

function titleFromHtml(html) {
  if (!html) return null;
  const m = html.match(/<title[^>]*>([\s\S]{1,200}?)<\/title>/i);
  if (!m) return null;
  const t = m[1].replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > 42 ? t.slice(0, 40) + '…' : t;
}

/**
 * 取网页标题与图标。
 * 优先走原生（无 CORS 限制），失败再试 fetch，最后用域名推导。
 */
export async function resolveMeta(url) {
  const out = { url, title: '', icon: '', host: hostOf(url), iconFallbacks: faviconCandidates(url) };
  out.icon = out.iconFallbacks[0];

  const html = await nativeGet(url);
  out.title = titleFromHtml(html) || '';

  if (!out.title) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', mode: 'cors' });
      clearTimeout(timer);
      if (res.ok) out.title = titleFromHtml(await res.text()) || '';
    } catch {}
  }

  if (!out.title) out.title = prettyName(url);
  return out;
}

/** 图标按候选列表逐个回退，全部失败时显示首字母。 */
export function attachIcon(el, candidates, onAllFail) {
  let i = 0;
  const tryNext = () => {
    if (i >= candidates.length) { onAllFail?.(); return; }
    el.src = candidates[i++];
  };
  el.addEventListener('error', tryNext);
  el.addEventListener('load', () => {
    if (el.naturalWidth <= 1) tryNext();
  });
  tryNext();
}
