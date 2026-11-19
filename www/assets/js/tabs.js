/* ─────────────────────────────────────────────────────────────
   tabs.js — 标签页
   APK：每个标签是一个原生 WebView，evaluateJavascript 可跨域注入。
   浏览器：退回 iframe，跨域时明确报错，不假装成功。
   ───────────────────────────────────────────────────────────── */

import { normalizeUrl, hostOf } from './metadata.js';
import { webview, isNative } from './native.js';

export class TabManager {
  constructor({ root, layer, els, onOpen, onUpdate }) {
    this.root = root;
    this.layer = layer;
    this.els = els;
    this.onOpen = onOpen;
    this.onUpdate = onUpdate;
    this.tabs = [];
    this.activeId = null;
    this.zoomDefault = 100;
  }

  get nativeMode() { return isNative(); }

  setZoomDefault(v) { this.zoomDefault = Number(v) || 100; }

  async create(url, { title, zoom } = {}) {
    const u = normalizeUrl(url);
    if (!u) return null;

    const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const tab = {
      id, url: u,
      title: title || hostOf(u) || '新页面',
      host: hostOf(u),
      zoom: zoom || this.zoomDefault,
      keepAlive: true,
      mode: this.nativeMode ? 'native' : 'iframe',
      ready: false,
      canBack: false,
      canForward: false,
    };

    if (this.nativeMode) {
      const r = await webview.open({ id, url: u });
      tab.ready = Boolean(r?.ok);
      if (r?.title) tab.title = r.title;
    } else {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen');
      iframe.dataset.tabId = id;
      iframe.src = u;
      iframe.addEventListener('load', () => {
        tab.ready = true;
        this.els.blocked.hidden = true;
        try {
          const t = iframe.contentDocument?.title;
          if (t) { tab.title = t.slice(0, 60); this._paintBar(tab); }
        } catch {}
        this._emit();
      });
      tab.iframe = iframe;
      this.root.appendChild(iframe);
    }

    this.tabs.push(tab);
    await this.activate(id);
    return tab;
  }

  async activate(id) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.activeId = id;

    if (this.nativeMode) {
      await webview.setVisible(id);
    } else {
      this.tabs.forEach((t) => t.iframe?.classList.toggle('is-active', t.id === id));
    }

    this.layer.hidden = false;
    this.els.blocked.hidden = true;
    this._paintBar(tab);
    this._applyZoom(tab);
    this.onOpen?.(tab);
    this._emit();
  }

  _paintBar(tab) {
    if (!tab) {
      this.els.title.textContent = '页面';
      this.els.host.textContent = '';
      return;
    }
    this.els.title.textContent = tab.title || tab.host || '页面';
    this.els.host.textContent = tab.host || tab.url;
    this.els.zoomLabel && (this.els.zoomLabel.textContent = `${tab.zoom}%`);
  }

  _applyZoom(tab) {
    if (!tab) return;
    const z = tab.zoom / 100;
    if (this.nativeMode) {
      webview.zoom(tab.id, tab.zoom);
    } else if (tab.iframe) {
      tab.iframe.style.width = `${100 / z}%`;
      tab.iframe.style.height = `${100 / z}%`;
      tab.iframe.style.transform = z === 1 ? 'none' : `scale(${z})`;
    }
    this.els.zoomLabel && (this.els.zoomLabel.textContent = `${tab.zoom}%`);
  }

  async zoom(delta) {
    const tab = this.current();
    if (!tab) return;
    tab.zoom = Math.min(200, Math.max(50, tab.zoom + delta));
    this._applyZoom(tab);
    this._paintBar(tab);
    this._emit();
    this.onZoom?.(tab.zoom, tab.host);
    return tab.zoom;
  }

  async setZoom(value) {
    const tab = this.current();
    if (!tab) return;
    tab.zoom = Math.min(200, Math.max(50, Number(value) || 100));
    this._applyZoom(tab);
    this._paintBar(tab);
    this._emit();
    this.onZoom?.(tab.zoom, tab.host);
  }

  async reload() {
    const tab = this.current();
    if (!tab) return;
    if (this.nativeMode) await webview.reload(tab.id);
    else {
      try { tab.iframe.contentWindow.location.reload(); }
      catch { tab.iframe.src = tab.url; }
    }
  }

  async back() {
    const tab = this.current();
    if (!tab) return false;
    if (this.nativeMode) {
      const r = await webview.back(tab.id);
      tab.canBack = Boolean(r?.canGoBack);
      return tab.canBack;
    }
    try {
      const w = tab.iframe.contentWindow;
      if (w.history.length > 1) { w.history.back(); return true; }
    } catch {}
    return false;
  }

  async forward() {
    const tab = this.current();
    if (!tab) return false;
    if (this.nativeMode) {
      const r = await webview.forward(tab.id);
      tab.canForward = Boolean(r?.canGoForward);
      return tab.canForward;
    }
    try { tab.iframe.contentWindow.history.forward(); return true; } catch {}
    return false;
  }

  async close(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const tab = this.tabs[i];

    if (tab.mode === 'native') await webview.close(tab.id);
    else tab.iframe?.remove();

    this.tabs.splice(i, 1);

    if (this.activeId === id) {
      const next = this.tabs[Math.max(0, i - 1)] || this.tabs[0];
      if (next) await this.activate(next.id);
      else await this.hideLayer();
    }
    this._emit();
  }

  current() { return this.tabs.find((t) => t.id === this.activeId) || null; }

  async hideLayer() {
    this.layer.hidden = true;
    this.activeId = null;
    if (this.nativeMode) await webview.hideAll();
    this.onOpen?.(null);
    this._emit();
  }

  /**
   * 在网页内执行代码。
   * 原生 WebView 走 evaluateJavascript，不受同源限制；
   * iframe 方案下跨域会明确返回失败原因。
   */
  async evaluate(code) {
    const tab = this.current();
    if (!tab) return { ok: false, error: '没有打开的页面' };

    if (tab.mode === 'native') {
      const r = await webview.eval(tab.id, code);
      return r?.ok ? r : { ok: false, error: r?.error || '执行失败' };
    }

    let win;
    try { win = tab.iframe.contentWindow; } catch { return { ok: false, error: '页面不可访问' }; }
    try { void win.document.title; }
    catch {
      return {
        ok: false,
        crossOrigin: true,
        error: '跨域页面：iframe 方案下浏览器不允许父页面读取它的 DOM。请安装 APK 版本，原生 WebView 不受此限制。',
      };
    }
    try { return { ok: true, value: win.eval(code) }; }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }

  _emit() { this.onUpdate?.(this.tabs, this.activeId); }
}
