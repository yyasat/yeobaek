/* ─────────────────────────────────────────────────────────────
   tabs.js — 标签页与网页层
   每个标签一个 iframe，切走不销毁（后台保持存活）。
   跨域页面无法被父文档读取 DOM，所以控制台注入会先尝试同源访问，
   失败则明确告知需要一个可注入的桥（原生 WebView 版可跨域 eval）。
   ───────────────────────────────────────────────────────────── */

import { normalizeUrl, resolveMeta, faviconCandidates, hostOf } from './metadata.js';

export class TabManager {
  constructor({ root, layer, els, onOpen, onUpdate }) {
    this.root = root;                 // #frames
    this.layer = layer;               // #pageLayer
    this.els = els;
    this.onOpen = onOpen;             // 通知外壳（打开层时同步系统栏）
    this.onUpdate = onUpdate;
    this.tabs = [];                   // {id,url,title,host,iframe,zoom,loaded,error}
    this.activeId = null;
    this.zoomDefault = 100;
    this.progressTimer = null;
  }

  setZoomDefault(v) { this.zoomDefault = Number(v) || 100; }

  create(url, { title } = {}) {
    const u = normalizeUrl(url);
    if (!u) return null;

    const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
    iframe.setAttribute('loading', 'eager');
    iframe.dataset.tabId = id;
    iframe.src = u;

    const tab = {
      id, url: u, title: title || hostOf(u), host: hostOf(u),
      iframe, zoom: this.zoomDefault, loaded: false, error: false,
    };

    iframe.addEventListener('load', () => {
      tab.loaded = true;
      tab.error = false;
      this.els.blocked.hidden = true;
      this._readTitle(tab);
      this._emitUpdate();
    });
    iframe.addEventListener('error', () => { tab.error = true; });

    this.root.appendChild(iframe);
    this.tabs.push(tab);
    this.activate(id);
    return tab;
  }

  _readTitle(tab) {
    try {
      const t = tab.iframe.contentDocument?.title;
      if (t) { tab.title = t.slice(0, 60); tab.host = hostOf(tab.url); }
    } catch { /* 跨域，保持原样 */ }
  }

  activate(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.activeId = id;
    this.tabs.forEach((t) => t.iframe.classList.toggle('is-active', t.id === id));
    this.layer.hidden = false;
    this._paintBar(tab);
    this._applyZoom(tab);
    this._progress(true);
    this.onOpen?.(tab);
  }

  _paintBar(tab) {
    this.els.title.textContent = tab.title || hostOf(tab.url) || '页面';
    this.els.host.textContent = tab.host || tab.url;
  }

  _applyZoom(tab) {
    const z = tab.zoom / 100;
    tab.iframe.style.width = `${100 / z}%`;
    tab.iframe.style.height = `${100 / z}%`;
    tab.iframe.style.transform = z === 1 ? 'none' : `scale(${z})`;
    this.els.zoomLabel.textContent = `${tab.zoom}%`;
  }

  zoom(delta) {
    const tab = this.current();
    if (!tab) return;
    tab.zoom = Math.min(200, Math.max(50, tab.zoom + delta));
    this._applyZoom(tab);
    this._emitUpdate();
  }

  reload() {
    const tab = this.current();
    if (!tab) return;
    this._progress(true);
    try { tab.iframe.contentWindow.location.reload(); }
    catch { tab.iframe.src = tab.url; }
  }

  close(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.tabs[i].iframe.remove();
    this.tabs.splice(i, 1);
    if (this.activeId === id) {
      const next = this.tabs[Math.max(0, i - 1)] || this.tabs[0];
      if (next) this.activate(next.id);
      else this.hideLayer();
    }
    this._emitUpdate();
  }

  current() { return this.tabs.find((t) => t.id === this.activeId) || null; }

  hideLayer() {
    this.layer.hidden = true;
    this.activeId = null;
    this.onOpen?.(null);
  }

  back() {
    const tab = this.current();
    if (!tab) { this.hideLayer(); return; }
    try { tab.iframe.contentWindow.history.back(); }
    catch { this.hideLayer(); }
  }

  /** 在 iframe 内执行代码。同源可注入，跨域返回明确失败原因。 */
  evaluate(code) {
    const tab = this.current();
    if (!tab) return { ok: false, error: '没有打开的页面' };
    let win;
    try { win = tab.iframe.contentWindow; } catch { return { ok: false, error: '页面不可访问' }; }
    try {
      // 触发同源检测
      void win.document.title;
    } catch {
      return {
        ok: false,
        error: '跨域页面：浏览器不允许父页面读取它的 DOM。请在设置里查看「控制台说明」。',
      };
    }
    try {
      const result = win.eval(code);
      return { ok: true, value: result };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  _progress(on) {
    clearTimeout(this.progressTimer);
    const el = this.els.progress;
    if (on) {
      el.classList.add('is-on');
      el.style.width = '30%';
      this.progressTimer = setTimeout(() => { el.style.width = '78%'; }, 220);
      setTimeout(() => {
        el.style.width = '100%';
        setTimeout(() => { el.classList.remove('is-on'); el.style.width = '0'; }, 260);
      }, 900);
    } else {
      el.classList.remove('is-on');
      el.style.width = '0';
    }
  }

  _emitUpdate() { this.onUpdate?.(this.tabs, this.activeId); }
}
