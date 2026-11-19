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
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * TabHost — 每个标签一个真实 WebView。
 *
 * 三种全屏模式（按网页设置，互不合并）：
 *   ① FULLSCREEN_NONE  浏览器顶栏 + 系统状态栏 + 导航栏（系统浏览器打开时的样子）
 *   ② FULLSCREEN_STATUS 无顶栏 + 保留系统状态栏，状态栏底色取自页面顶部颜色
 *   ③ FULLSCREEN_IMMERSIVE 无顶栏 + 状态栏被挤掉，内容铺满整屏
 */
public class TabHost {

    public static final int MODE_BAR = 1;        // 模式①
    public static final int MODE_STATUS = 2;     // 模式②
    public static final int MODE_IMMERSIVE = 3;  // 模式③

    static class Tab {
        final String id;
        final WebView web;
        final FrameLayout frame;
        String url;
        int mode = MODE_STATUS;
        boolean keepAlive = true;

        Tab(String id, WebView web, FrameLayout frame, String url) {
            this.id = id;
            this.web = web;
            this.frame = frame;
            this.url = url;
        }

        String title() {
            String t = null;
            try { t = web.getTitle(); } catch (Exception ignored) {}
            if (t == null || t.trim().isEmpty()) {
                try { t = Uri.parse(web.getUrl()).getHost(); } catch (Exception e) { t = "网页"; }
            }
            return t == null ? "网页" : t;
        }
    }

    interface ConsoleListener {
        void onConsoleRequested(String tabId);
    }

    private final Activity activity;
    private final WebView shellWebView;
    private final Map<String, Tab> tabs = new LinkedHashMap<>();
    private final List<WebView> warmPool = new ArrayList<>();

    private FrameLayout container;
    private FrameLayout consolePill;
    private String currentId;
    private int statusBarPx = 0;
    private int navBarPx = 0;
    private int imePx = 0;

    private ConsoleListener consoleListener;

    TabHost(Activity activity, WebView shellWebView) {
        this.activity = activity;
        this.shellWebView = shellWebView;
    }

    void setConsoleListener(ConsoleListener l) { this.consoleListener = l; }

    /* ── 容器 ──────────────────────────────────────────────── */

    void attach() {
        if (container != null) return;

        ViewGroup root = (ViewGroup) activity.findViewById(android.R.id.content);

        container = new FrameLayout(activity);
        container.setBackgroundColor(Color.TRANSPARENT);
        container.setVisibility(View.GONE);
        container.setClipChildren(false);
        container.setClipToPadding(false);

        root.addView(container, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        // 控制台浮钮：叠在网页之上，点它就能从页面内部唤起控制台
        consolePill = new FrameLayout(activity);
        consolePill.setBackground(null);
        consolePill.setVisibility(View.GONE);
        consolePill.setContentDescription("打开控制台");
        consolePill.setOnClickListener(v -> {
            if (consoleListener != null && currentId != null) {
                consoleListener.onConsoleRequested(currentId);
            }
        });

        ViewCompat.setOnApplyWindowInsetsListener(container, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            statusBarPx = bars.top;
            navBarPx = bars.bottom;
            imePx = Math.max(0, ime.bottom - bars.bottom);

            applyModePadding();
            if (ime.bottom > 0) scrollFocusedIntoView();
            return insets;
        });

        activity.runOnUiThread(this::prewarm);
    }

    /** 预热：WebView 构造与内核初始化最慢，先造好备用。 */
    private void prewarm() {
        if (!warmPool.isEmpty()) return;
        try {
            WebView w = buildWebView();
            w.loadUrl("about:blank");
            warmPool.add(w);
        } catch (Exception ignored) {}
    }

    /**
     * 模式决定留白：
     *   ① 让出状态栏 + 浏览器顶栏（46dp），底部让出导航栏
     *   ② 让出状态栏，底部让出导航栏
     *   ③ 全部贴边，什么都不让
     */
    private void applyModePadding() {
        Tab t = get(currentId);
        int mode = t == null ? MODE_STATUS : t.mode;

        int top;
        int bottom;

        if (mode == MODE_BAR) {
            top = statusBarPx + dp(46);
            bottom = Math.max(navBarPx, imePx);
        } else if (mode == MODE_STATUS) {
            top = statusBarPx;
            bottom = Math.max(navBarPx, imePx);
        } else {
            top = 0;
            bottom = imePx;
        }

        container.setPadding(0, top, 0, bottom);
        container.requestLayout();
    }

    private int dp(int v) {
        return Math.round(v * activity.getResources().getDisplayMetrics().density);
    }

    private void scrollFocusedIntoView() {
        Tab t = get(currentId);
        if (t == null) return;
        String js = "(function(){var e=document.activeElement;"
                + "if(!e||e===document.body)return;"
                + "var r=e.getBoundingClientRect();"
                + "var h=window.innerHeight*0.55;"
                + "if(r.bottom>h){window.scrollBy({top:r.bottom-h+24,behavior:'smooth'})}})()";
        try { t.web.evaluateJavascript(js, null); } catch (Exception ignored) {}
    }

    /* ── 开关页 ────────────────────────────────────────────── */

    Tab open(String id, String url, int mode) {
        attach();

        Tab existing = tabs.get(id);
        if (existing != null) {
            existing.mode = mode;
            show(id);
            return existing;
        }

        WebView web = warmPool.isEmpty() ? buildWebView() : warmPool.remove(0);

        FrameLayout frame = new FrameLayout(activity);
        frame.setBackgroundColor(Color.TRANSPARENT);
        frame.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        container.addView(frame, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        Tab tab = new Tab(id, web, frame, url);
        tab.mode = mode;
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
        s.setLoadsImagesAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportZoom(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(true);
        }

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setBackgroundColor(Color.TRANSPARENT);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // 文本可选中复制：不能拦长按，必须开长按与可聚焦
        web.setLongClickable(true);
        web.setHapticFeedbackEnabled(false);
        web.setOnLongClickListener(null);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.requestFocus(View.FOCUS_DOWN);

        web.addJavascriptInterface(new BlobBridge(), "__jiansuBlob");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                String u = req.getUrl().toString();
                if (u.startsWith("http://") || u.startsWith("https://")) return false;
                try {
                    activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                super.onPageFinished(v, url);
                // 模式②：状态栏底色取页面顶部的颜色
                Tab t = null;
                for (Tab cand : tabs.values()) {
                    if (cand.web == v) { t = cand; break; }
                }
                if (t != null && t.mode == MODE_STATUS) sampleStatusColor(v);
            }
        });

        web.setWebChromeClient(new WebChromeClient());

        web.setDownloadListener((url, ua, cd, mime, len) -> {
            if (url == null || url.startsWith("blob:")) return;
            try {
                android.app.DownloadManager.Request req =
                        new android.app.DownloadManager.Request(Uri.parse(url));
                req.setNotificationVisibility(
                        android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        android.webkit.URLUtil.guessFileName(url, cd, mime));
                android.app.DownloadManager dm =
                        (android.app.DownloadManager) activity.getSystemService(Activity.DOWNLOAD_SERVICE);
                if (dm != null) dm.enqueue(req);
            } catch (Exception ignored) {}
        });

        return web;
    }

    /**
     * 取网页最顶端的颜色，喂给系统状态栏。
     * 这是模式②「取离状态栏最近的颜色延伸」的实现。
     */
    private void sampleStatusColor(WebView web) {
        String js =
            "(function(){"
          + "function bg(e){if(!e)return null;var c=getComputedStyle(e).backgroundColor;"
          + "if(!c||c==='rgba(0, 0, 0, 0)'||c==='transparent')return null;"
          + "var m=c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);"
          + "if(!m)return null;return '#'+[m[1],m[2],m[3]].map(function(x){"
          + "var h=parseInt(x,10).toString(16);return h.length===1?'0'+h:h}).join('')}"
          + "var y=2;var x=window.innerWidth/2;var el=document.elementFromPoint(x,y);"
          + "while(el){var c=bg(el);if(c)return c;el=el.parentElement}"
          + "return bg(document.body)||'#FFFFFF'})()";

        try {
            web.evaluateJavascript(js, value -> {
                if (value == null) return;
                String hex = value.replace("\"", "").trim();
                if (hex.startsWith("#") && (hex.length() == 7 || hex.length() == 4)) {
                    try {
                        int c = Color.parseColor(hex);
                        activity.runOnUiThread(() -> {
                            activity.getWindow().setStatusBarColor(c);
                            boolean darkText = luminance(c) > 0.42;
                            WindowInsetsControllerCompat ctl = ViewCompat.getWindowInsetsController(
                                    activity.getWindow().getDecorView());
                            if (ctl != null) ctl.setAppearanceLightStatusBars(darkText);
                        });
                    } catch (Exception ignored) {}
                }
            });
        } catch (Exception ignored) {}
    }

    private double luminance(int color) {
        double[] c = {
            Color.red(color) / 255.0,
            Color.green(color) / 255.0,
            Color.blue(color) / 255.0
        };
        for (int i = 0; i < 3; i++) {
            c[i] = c[i] <= 0.03928 ? c[i] / 12.92 : Math.pow((c[i] + 0.055) / 1.055, 2.4);
        }
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }

    /* ── 全屏三模式 ────────────────────────────────────────── */

    void applyMode(String id, int mode) {
        Tab t = get(id);
        if (t != null) t.mode = mode;

        activity.runOnUiThread(() -> {
            WindowInsetsControllerCompat ctl = ViewCompat.getWindowInsetsController(
                    activity.getWindow().getDecorView());

            if (mode == MODE_IMMERSIVE) {
                // 模式③：挤掉状态栏
                if (ctl != null) {
                    ctl.hide(WindowInsetsCompat.Type.statusBars());
                    ctl.setSystemBarsBehavior(
                            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
                activity.getWindow().setStatusBarColor(Color.TRANSPARENT);
            } else {
                if (ctl != null) ctl.show(WindowInsetsCompat.Type.statusBars());
                if (mode == MODE_BAR) {
                    activity.getWindow().setStatusBarColor(Color.TRANSPARENT);
                }
            }

            applyModePadding();
            updateConsolePill();
        });
    }

    private void updateConsolePill() {
        if (consolePill == null) return;
        // 只在网页层可见时显示
        boolean visible = container != null && container.getVisibility() == View.VISIBLE && currentId != null;
        if (!visible) {
            if (consolePill.getParent() != null) {
                ((ViewGroup) consolePill.getParent()).removeView(consolePill);
            }
            return;
        }

        if (consolePill.getParent() == null) {
            ViewGroup root = (ViewGroup) activity.findViewById(android.R.id.content);
            int w = dp(46);
            int h = dp(30);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(w, h);
            lp.leftMargin = dp(6);
            lp.topMargin = 0;
            lp.gravity = android.view.Gravity.BOTTOM | android.view.Gravity.START;
            // 底部留出导航栏与一点空隙
            lp.bottomMargin = navBarPx + dp(56);
            root.addView(consolePill, lp);
        }

        android.graphics.drawable.GradientDrawable bg =
                new android.graphics.drawable.GradientDrawable();
        bg.setShape(android.graphics.drawable.GradientDrawable.RECTANGLE);
        bg.setCornerRadius(dp(15));
        bg.setColor(Color.parseColor("#E61B2227"));
        consolePill.setBackground(bg);
        consolePill.setVisibility(View.VISIBLE);
        consolePill.bringToFront();

        if (consolePill.getChildCount() == 0) {
            android.widget.TextView tv = new android.widget.TextView(activity);
            tv.setText(">_");
            tv.setTextSize(12);
            tv.setTextColor(Color.parseColor("#E3EAF0"));
            tv.setGravity(android.view.Gravity.CENTER);
            tv.setTypeface(android.graphics.Typeface.MONOSPACE);
            consolePill.addView(tv, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
        }
    }

    void hideConsolePill() {
        if (consolePill != null) consolePill.setVisibility(View.GONE);
    }

    /* ── 显示 / 隐藏 / 关闭 ────────────────────────────────── */

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

        applyMode(id, t.mode);
        t.frame.requestLayout();
        updateConsolePill();
    }

    void hideAll() {
        if (container != null) container.setVisibility(View.GONE);
        hideConsolePill();
        currentId = null;

        // 退出网页层：恢复系统栏常态
        WindowInsetsControllerCompat ctl = ViewCompat.getWindowInsetsController(
                activity.getWindow().getDecorView());
        if (ctl != null) ctl.show(WindowInsetsCompat.Type.statusBars());
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
                List<String> keys = new ArrayList<>(tabs.keySet());
                show(keys.get(keys.size() - 1));
            } else {
                hideAll();
            }
        }
    }

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
        for (WebView w : warmPool) {
            try { w.destroy(); } catch (Exception ignored) {}
        }
        warmPool.clear();
    }

    String currentId() { return currentId; }

    /* ── blob 下载桥 ───────────────────────────────────────── */

    private class BlobBridge {
        @JavascriptInterface
        public void save(String base64, String filename, String mime) {
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null || (!dir.exists() && !dir.mkdirs())) {
                    dir = activity.getCacheDir();
                }
                if (dir == null) return;

                String safe = filename == null || filename.isEmpty()
                        ? "download-" + System.currentTimeMillis()
                        : filename.replaceAll("[\\\\/:*?\"<>|]", "_");

                File out = new File(dir, safe);
                FileOutputStream fos = new FileOutputStream(out);
                fos.write(data);
                fos.flush();
                fos.getFD().sync();
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
