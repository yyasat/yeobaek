package com.yeobaek.browser;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * TabHost — 每个标签一个真实 WebView。
 *
 * 之所以自己管 WebView 而不是用 iframe：
 *   1. evaluateJavascript 能跨域读写 DOM，控制台才真正可用
 *   2. 没有 X-Frame-Options 限制
 *   3. 输入法、下载、缩放都走系统原生行为
 */
public class TabHost {

    static class Tab {
        final String id;
        final WebView web;
        final FrameLayout frame;
        String url;
        boolean keepAlive = true;

        Tab(String id, WebView web, FrameLayout frame, String url) {
            this.id = id;
            this.web = web;
            this.frame = frame;
            this.url = url;
        }

        String title() {
            String t = web.getTitle();
            if (t == null || t.trim().isEmpty()) {
                try { t = Uri.parse(web.getUrl()).getHost(); } catch (Exception e) { t = "网页"; }
            }
            return t == null ? "网页" : t;
        }
    }

    private final Activity activity;
    private final WebView shellWebView;
    private final Map<String, Tab> tabs = new LinkedHashMap<>();
    private FrameLayout container;
    private String currentId;
    private int imeBottomPx = 0;

    TabHost(Activity activity, WebView shellWebView) {
        this.activity = activity;
        this.shellWebView = shellWebView;
    }

    /* ── 容器挂载 ──────────────────────────────────────────── */

    void attach() {
        if (container != null) return;

        ViewGroup root = (ViewGroup) activity.findViewById(android.R.id.content);
        container = new FrameLayout(activity);
        container.setBackgroundColor(Color.TRANSPARENT);
        container.setVisibility(View.GONE);

        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
        root.addView(container, lp);

        // 键盘弹出时把当前输入框滚进可视区（第 p4 条）
        ViewCompat.setOnApplyWindowInsetsListener(container, (v, insets) -> {
            androidx.core.graphics.Insets ime =
                    insets.getInsets(WindowInsetsCompat.Type.ime());
            androidx.core.graphics.Insets bars =
                    insets.getInsets(WindowInsetsCompat.Type.systemBars());

            int bottom = Math.max(ime.bottom, bars.bottom);
            if (bottom != imeBottomPx) {
                imeBottomPx = bottom;
                v.setPadding(0, 0, 0, ime.bottom);
                v.requestLayout();
                if (ime.bottom > 0) scrollFocusedIntoView();
            }
            return insets;
        });
    }

    /**
     * 部分网站不会在键盘弹出时主动上移页面，这里补一刀：
     * 找到当前焦点元素，把它滚到可视范围内。
     */
    private void scrollFocusedIntoView() {
        Tab t = get(currentId);
        if (t == null) return;
        String js =
            "(function(){var e=document.activeElement;"
          + "if(!e||e===document.body)return;"
          + "var r=e.getBoundingClientRect();"
          + "var h=window.innerHeight*0.55;"
          + "if(r.bottom>h){window.scrollBy({top:r.bottom-h+24,behavior:'smooth'})}"
          + "})()";
        try { t.web.evaluateJavascript(js, null); } catch (Exception ignored) {}
    }

    /* ── 打开 / 显示 / 关闭 ────────────────────────────────── */

    Tab open(String id, String url) {
        attach();
        Tab existing = tabs.get(id);
        if (existing != null) {
            show(id);
            return existing;
        }

        WebView web = buildWebView();
        FrameLayout frame = new FrameLayout(activity);
        frame.setBackgroundColor(Color.TRANSPARENT);
        frame.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        container.addView(frame, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        Tab tab = new Tab(id, web, frame, url);
        tabs.put(id, tab);

        web.loadUrl(url);
        show(id);
        return tab;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView buildWebView() {
        WebView web = new WebView(activity);
        WebSettings s = web.getSettings();

        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setLoadsImagesAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(false);

        // 关键：不要强制「整页适配」，否则页面会缩成一小块还能缩放
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);

        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(true);
        }

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setBackgroundColor(Color.TRANSPARENT);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // 下载：blob: 与普通链接都接住
        web.addJavascriptInterface(new BlobBridge(), "__jiansuBlob");

        final Tab[] self = new Tab[1];

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                String u = req.getUrl().toString();
                if (u.startsWith("http") || u.startsWith("https")) return false;
                // 外部协议（tel: mailto: 等）交给系统
                try {
                    activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
                } catch (Exception ignored) {}
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int progress) {
                // 进度由前端轮询，这里不做额外动作
            }
        });

        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) -> {
            if (url != null && url.startsWith("blob:")) {
                // blob 下载由 JS 桥接管，见 BlobBridge
                return;
            }
            try {
                android.app.DownloadManager.Request req =
                        new android.app.DownloadManager.Request(Uri.parse(url));
                req.setNotificationVisibility(
                        android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType));
                android.app.DownloadManager dm =
                        (android.app.DownloadManager) activity.getSystemService(Activity.DOWNLOAD_SERVICE);
                if (dm != null) dm.enqueue(req);
            } catch (Exception ignored) {}
        });

        return web;
    }

    void show(String id) {
        attach();
        Tab t = tabs.get(id);
        if (t == null) return;

        for (Map.Entry<String, Tab> e : tabs.entrySet()) {
            e.getValue().frame.setVisibility(
                    e.getKey().equals(id) ? View.VISIBLE : View.GONE);
        }
        currentId = id;
        container.setVisibility(View.VISIBLE);
        container.bringToFront();
        t.frame.requestLayout();
    }

    void hideAll() {
        if (container != null) container.setVisibility(View.GONE);
    }

    Tab get(String id) {
        return id == null ? null : tabs.get(id);
    }

    void close(String id) {
        Tab t = tabs.remove(id);
        if (t == null) return;
        try {
            container.removeView(t.frame);
            t.web.stopLoading();
            t.web.loadUrl("about:blank");
            t.web.removeAllViews();
            t.web.destroy();
        } catch (Exception ignored) {}

        if (id.equals(currentId)) {
            currentId = null;
            if (!tabs.isEmpty()) {
                String last = new ArrayList<>(tabs.keySet()).get(tabs.size() - 1);
                show(last);
            } else {
                hideAll();
            }
        }
    }

    /** 清除某站点数据前，先把它名下的页面全部安全销毁。 */
    void closeByHost(String host) {
        if (host == null || host.isEmpty()) return;
        List<String> victims = new ArrayList<>();
        for (Map.Entry<String, Tab> e : tabs.entrySet()) {
            String u = null;
            try { u = e.getValue().web.getUrl(); } catch (Exception ignored) {}
            if (u == null) u = e.getValue().url;
            try {
                String h = Uri.parse(u).getHost();
                if (h != null && (h.equals(host) || h.endsWith("." + host))) {
                    victims.add(e.getKey());
                }
            } catch (Exception ignored) {}
        }
        for (String id : victims) close(id);
    }

    void destroyAll() {
        for (String id : new ArrayList<>(tabs.keySet())) close(id);
        tabs.clear();
        hideAll();
    }

    /**
     * blob: URL 下载桥。
     * 网页点击导出后通常立刻 revokeObjectURL，导致 blob 失效。
     * 这里让 JS 先把数据交过来，再由原生落盘。
     */
    private class BlobBridge {
        @JavascriptInterface
        public void save(String base64, String filename, String mime) {
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null || (!dir.exists() && !dir.mkdirs())) {
                    dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                }
                if (dir == null) return;

                String safe = filename == null || filename.isEmpty()
                        ? "download-" + System.currentTimeMillis()
                        : filename.replaceAll("[\\\\/:*?\"<>|]", "_");

                File out = new File(dir, safe);
                FileOutputStream fos = new FileOutputStream(out);
                fos.write(data);
                fos.flush();
                fos.getFD().sync();   // 确保写完再报告成功
                fos.close();

                final String path = out.getAbsolutePath();
                activity.runOnUiThread(() ->
                        Toast.makeText(activity, "已保存到 " + path, Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                activity.runOnUiThread(() ->
                        Toast.makeText(activity, "保存失败：" + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }
    }
}
