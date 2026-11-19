package com.yeobaek.browser;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebView;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;

@CapacitorPlugin(name = "JianSuNative")
public class JianSuNativePlugin extends Plugin {

    private static final int REQ_NOTIF = 5301;

    private TabHost tabHost;
    private PluginCall pendingPermCall;

    private TabHost host() {
        if (tabHost == null) {
            tabHost = new TabHost(getActivity(), getBridge().getWebView());
            tabHost.attach();
            tabHost.setConsoleListener(tabId -> notifyConsole(tabId));
        }
        return tabHost;
    }

    /** 网页里点浮钮 → 通知前端切到控制台视图。 */
    private void notifyConsole(String tabId) {
        JSObject data = new JSObject();
        data.put("tabId", tabId);
        notifyListeners("consoleRequested", data);
    }

    @Override
    protected void handleOnDestroy() {
        if (tabHost != null) tabHost.destroyAll();
        super.handleOnDestroy();
    }

    /* ── 系统栏 ────────────────────────────────────────────── */

    @PluginMethod
    public void enterImmersive(PluginCall call) {
        applyBars(call.getBoolean("darkIcons", true));
        JSObject r = new JSObject();
        r.put("mode", "native");
        call.resolve(r);
    }

    @PluginMethod
    public void setSystemBars(PluginCall call) {
        applyBars(call.getBoolean("darkIcons", true));
        call.resolve();
    }

    private void applyBars(boolean darkIcons) {
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            WindowCompat.setDecorFitsSystemWindows(w, false);
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
            WindowInsetsControllerCompat c =
                    WindowCompat.getInsetsController(w, w.getDecorView());
            c.setAppearanceLightStatusBars(darkIcons);
            c.setAppearanceLightNavigationBars(darkIcons);
            c.show(WindowInsetsCompat.Type.statusBars());
            c.show(WindowInsetsCompat.Type.navigationBars());
        });
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        View root = getActivity().getWindow().getDecorView();
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
        float d = getActivity().getResources().getDisplayMetrics().density;

        JSObject r = new JSObject();
        if (insets != null) {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            androidx.core.graphics.Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            r.put("top", bars.top / d);
            r.put("bottom", Math.max(bars.bottom, ime.bottom) / d);
            r.put("left", bars.left / d);
            r.put("right", bars.right / d);
            r.put("imeBottom", ime.bottom / d);
        } else {
            r.put("top", 24); r.put("bottom", 0); r.put("left", 0); r.put("right", 0); r.put("imeBottom", 0);
        }
        call.resolve(r);
    }

    /**
     * 返回键的退栈顺序，全程不销毁 WebView：
     *   1. 当前网页还能后退 → 后退
     *   2. 网页层开着 → 收起，回到外壳
     *   3. 外壳不在首页 → 回首页
     *   4. 都不满足 → 返回 false，由 Activity 最小化到后台
     */
    public boolean handleBack() {
        if (tabHost == null) return false;

        String id = tabHost.currentId();
        if (id != null) {
            TabHost.Tab t = tabHost.get(id);
            if (t != null && t.web.canGoBack()) {
                getActivity().runOnUiThread(() -> t.web.goBack());
                return true;
            }
        }

        // 让前端收网页层 / 回首页；前端处理后返回 true
        final boolean[] handled = {false};
        final java.util.concurrent.CountDownLatch latch =
                new java.util.concurrent.CountDownLatch(1);

        getActivity().runOnUiThread(() -> {
            try {
                getBridge().getWebView().evaluateJavascript(
                    "(function(){return (window.__jiansuBack&&window.__jiansuBack())?'1':'0'})()",
                    value -> {
                        handled[0] = value != null && value.contains("1");
                        latch.countDown();
                    });
            } catch (Exception e) {
                latch.countDown();
            }
        });

        try { latch.await(320, java.util.concurrent.TimeUnit.MILLISECONDS); }
        catch (InterruptedException ignored) {}

        return handled[0];
    }

    /* ── 网页层 ────────────────────────────────────────────── */

    @PluginMethod
    public void openWebView(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        int mode = call.getInt("mode", TabHost.MODE_STATUS);
        if (id == null || url == null) { call.reject("缺少参数"); return; }

        getActivity().runOnUiThread(() -> {
            TabHost.Tab t = host().open(id, url, mode);
            JSObject r = new JSObject();
            r.put("ok", t != null);
            r.put("title", t == null ? "" : t.title());
            call.resolve(r);
        });
    }

    @PluginMethod
    public void setWebViewMode(PluginCall call) {
        String id = call.getString("id");
        int mode = call.getInt("mode", TabHost.MODE_STATUS);
        getActivity().runOnUiThread(() -> host().applyMode(id, mode));
        call.resolve();
    }

    @PluginMethod
    public void webViewVisible(PluginCall call) {
        String id = call.getString("id");
        getActivity().runOnUiThread(() -> host().show(id));
        call.resolve();
    }

    @PluginMethod
    public void webViewHideAll(PluginCall call) {
        getActivity().runOnUiThread(() -> host().hideAll());
        call.resolve();
    }

    @PluginMethod
    public void closeWebView(PluginCall call) {
        String id = call.getString("id");
        getActivity().runOnUiThread(() -> host().close(id));
        call.resolve();
    }

    @PluginMethod
    public void webViewBack(PluginCall call) {
        String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            TabHost.Tab t = host().get(id);
            JSObject r = new JSObject();
            if (t != null && t.web.canGoBack()) {
                t.web.goBack();
                r.put("canGoBack", true);
            } else {
                r.put("canGoBack", false);
            }
            call.resolve(r);
        });
    }

    /**
     * 后退：先在网页历史里退，退不动就逐级退应用层级。
     * 返回 handled=false 表示调用方该退一层界面。
     */
    @PluginMethod
    public void webViewForward(PluginCall call) {
        String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            TabHost.Tab t = host().get(id);
            JSObject r = new JSObject();
            if (t != null && t.web.canGoForward()) {
                t.web.goForward();
                r.put("canGoForward", true);
            } else {
                r.put("canGoForward", false);
            }
            call.resolve(r);
        });
    }

    @PluginMethod
    public void webViewReload(PluginCall call) {
        String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            TabHost.Tab t = host().get(id);
            if (t != null) t.web.reload();
        });
        call.resolve();
    }

    @PluginMethod
    public void webViewEval(PluginCall call) {
        String id = call.getString("id");
        String code = call.getString("code", "");

        getActivity().runOnUiThread(() -> {
            TabHost.Tab t = host().get(id);
            JSObject r = new JSObject();

            if (t == null) {
                r.put("ok", false);
                r.put("error", "页面不存在");
                call.resolve(r);
                return;
            }

            String wrapped =
                "(function(){try{"
              + "var __o=[];var __ol=console.log;"
              + "console.log=function(){__ol.apply(console,arguments);"
              + "try{__o.push(Array.prototype.map.call(arguments,function(a){"
              + "try{return typeof a==='object'?JSON.stringify(a):String(a)}catch(e){return String(a)}"
              + "}).join(' '))}catch(e){}};"
              + "var __r=eval(" + JSONObject.quote(code) + ");"
              + "console.log=__ol;"
              + "return JSON.stringify({ok:true,value:__r===undefined?null:String(__r),logs:__o})"
              + "}catch(e){return JSON.stringify({ok:false,error:String(e&&e.message||e)})}})()";

            t.web.evaluateJavascript(wrapped, result -> {
                JSObject out = new JSObject();
                if (result == null || "null".equals(result)) {
                    out.put("ok", true);
                    call.resolve(out);
                    return;
                }
                try {
                    String json = result;
                    if (json.startsWith("\"") && json.endsWith("\"")) {
                        json = new org.json.JSONArray("[" + json + "]").getString(0);
                    }
                    JSONObject o = new JSONObject(json);
                    out.put("ok", o.optBoolean("ok", false));
                    if (o.has("value")) out.put("value", o.opt("value"));
                    if (o.has("error")) out.put("error", o.optString("error"));
                    if (o.has("logs")) out.put("logs", o.opt("logs"));
                    call.resolve(out);
                } catch (Exception e) {
                    out.put("ok", true);
                    out.put("value", result);
                    call.resolve(out);
                }
            });
        });
    }

    @PluginMethod
    public void webViewInfo(PluginCall call) {
        String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            TabHost.Tab t = host().get(id);
            JSObject r = new JSObject();
            if (t == null) { r.put("exists", false); call.resolve(r); return; }
            r.put("exists", true);
            r.put("title", t.title());
            r.put("url", t.web.getUrl());
            r.put("canGoBack", t.web.canGoBack());
            r.put("canGoForward", t.web.canGoForward());
            call.resolve(r);
        });
    }

    @PluginMethod
    public void webViewZoom(PluginCall call) {
        String id = call.getString("id");
        int zoom = call.getInt("zoom", 100);
        getActivity().runOnUiThread(() -> {
            TabHost.Tab t = host().get(id);
            if (t != null) t.web.getSettings().setTextZoom(Math.max(50, Math.min(200, zoom)));
        });
        call.resolve();
    }

    @PluginMethod
    public void setKeepAlive(PluginCall call) {
        String id = call.getString("id");
        boolean on = call.getBoolean("enabled", true);
        getActivity().runOnUiThread(() -> {
            TabHost.Tab t = host().get(id);
            if (t != null) t.keepAlive = on;
        });
        call.resolve();
    }

    /* ── 数据清除（不闪退）────────────────────────────────── */

    @PluginMethod
    public void clearSiteData(PluginCall call) {
        String rawUrl = call.getString("url", "");
        String host = "";
        try { host = Uri.parse(rawUrl).getHost(); } catch (Exception ignored) {}

        final String fHost = host == null ? "" : host;

        getActivity().runOnUiThread(() -> {
            try { host().closeByHost(fHost); } catch (Exception ignored) {}

            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    if (!fHost.isEmpty()) {
                        CookieManager cm = CookieManager.getInstance();
                        String probe = "https://" + fHost + "/";
                        String cookies = null;
                        try { cookies = cm.getCookie(probe); } catch (Exception ignored) {}
                        if (cookies != null) {
                            for (String pair : cookies.split(";")) {
                                String name = pair.split("=")[0].trim();
                                if (name.isEmpty()) continue;
                                try { cm.setCookie(probe, name + "=; Max-Age=0; path=/"); } catch (Exception ignored) {}
                                try { cm.setCookie(probe, name + "=; Max-Age=0; path=/; domain=." + fHost); } catch (Exception ignored) {}
                            }
                        }
                        try { cm.flush(); } catch (Exception ignored) {}
                        try { WebStorage.getInstance().deleteOrigin(probe); } catch (Exception ignored) {}
                    }
                } catch (Throwable ignored) {}

                JSObject r = new JSObject();
                r.put("ok", true);
                call.resolve(r);
            }, 180);
        });
    }

    @PluginMethod
    public void clearAllData(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { host().destroyAll(); } catch (Exception ignored) {}
            try {
                CookieManager cm = CookieManager.getInstance();
                cm.removeAllCookies(null);
                cm.flush();
            } catch (Exception ignored) {}
            try { WebStorage.getInstance().deleteAllData(); } catch (Exception ignored) {}
            call.resolve();
        });
    }

    /* ── 桌面快捷方式 ──────────────────────────────────────── */

    @PluginMethod
    public void addShortcut(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "网页");
        String shortLabel = call.getString("shortLabel", title);
        if (url == null) { call.reject("缺少网址"); return; }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("需要 Android 8.0 及以上");
            return;
        }

        android.content.pm.ShortcutManager sm =
                getContext().getSystemService(android.content.pm.ShortcutManager.class);
        if (sm == null || !sm.isRequestPinShortcutSupported()) {
            call.reject("当前桌面不支持固定快捷方式");
            return;
        }

        Intent intent = new Intent(getContext(), MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        // 桌面快捷方式默认完全全屏（模式③），按站点设置可覆盖
        int mode = call.getInt("mode", TabHost.MODE_IMMERSIVE);
        intent.putExtra("jiansu_mode", mode);

        android.content.pm.ShortcutInfo info =
                new android.content.pm.ShortcutInfo.Builder(getContext(), "js_" + Math.abs(url.hashCode()))
                        .setShortLabel(shortLabel)
                        .setLongLabel(title)
                        .setIcon(Icon.createWithBitmap(letterIcon(shortLabel)))
                        .setIntent(intent)
                        .build();

        JSObject r = new JSObject();
        r.put("ok", sm.requestPinShortcut(info, null));
        call.resolve(r);
    }

    @PluginMethod
    public void removeShortcut(PluginCall call) {
        String url = call.getString("url", "");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.content.pm.ShortcutManager sm =
                    getContext().getSystemService(android.content.pm.ShortcutManager.class);
            if (sm != null) {
                try {
                    sm.removeDynamicShortcuts(
                            Collections.singletonList("js_" + Math.abs(url.hashCode())));
                } catch (Exception ignored) {}
            }
        }
        call.resolve();
    }

    private Bitmap letterIcon(String label) {
        int size = 432;
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);

        Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        bg.setColor(Color.parseColor("#EDF1F4"));
        c.drawRoundRect(new RectF(0, 0, size, size), size * 0.22f, size * 0.22f, bg);

        Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(size * 0.035f);
        ring.setColor(Color.parseColor("#5D7688"));
        c.drawRoundRect(new RectF(size * 0.10f, size * 0.10f, size * 0.90f, size * 0.90f),
                size * 0.16f, size * 0.16f, ring);

        String ch = (label == null || label.isEmpty()) ? "素" : label.substring(0, 1);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(Color.parseColor("#1B242B"));
        p.setTextSize(size * 0.40f);
        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        p.setTextAlign(Paint.Align.CENTER);
        Paint.FontMetrics fm = p.getFontMetrics();
        c.drawText(ch, size / 2f, size / 2f - (fm.ascent + fm.descent) / 2f, p);

        return bmp;
    }

    /* ── 权限 ──────────────────────────────────────────────── */

    @PluginMethod
    public void requestPermission(PluginCall call) {
        String type = call.getString("type", "");

        if ("clipboard-read".equals(type) || "clipboard-write".equals(type)) {
            JSObject r = new JSObject();
            r.put("granted", true);
            r.put("status", "granted");
            call.resolve(r);
            return;
        }

        if (!"notifications".equals(type)) {
            call.reject("未知权限类型");
            return;
        }

        if (Build.VERSION.SDK_INT < 33) {
            JSObject r = new JSObject();
            r.put("granted", true);
            r.put("status", "granted");
            call.resolve(r);
            return;
        }

        String perm = "android.permission.POST_NOTIFICATIONS";
        if (getActivity().checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED) {
            JSObject r = new JSObject();
            r.put("granted", true);
            r.put("status", "granted");
            call.resolve(r);
            return;
        }

        pendingPermCall = call;
        getActivity().requestPermissions(new String[]{perm}, REQ_NOTIF);
    }

    public void handleRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;

        if (pendingPermCall != null) {
            JSObject r = new JSObject();
            r.put("granted", granted);
            r.put("status", granted ? "granted" : "denied");
            pendingPermCall.resolve(r);
            pendingPermCall = null;
        }
    }

    /* ── 剪贴板 ────────────────────────────────────────────── */

    @PluginMethod
    public void readClipboard(PluginCall call) {
        ClipboardManager cm =
                (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        JSObject r = new JSObject();
        if (cm != null && cm.hasPrimaryClip()) {
            ClipData clip = cm.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) {
                CharSequence t = clip.getItemAt(0).coerceToText(getContext());
                r.put("value", t == null ? "" : t.toString());
                call.resolve(r);
                return;
            }
        }
        r.put("value", "");
        call.resolve(r);
    }

    @PluginMethod
    public void writeClipboard(PluginCall call) {
        String text = call.getString("text", "");
        ClipboardManager cm =
                (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) {
            cm.setPrimaryClip(ClipData.newPlainText("见素", text));
            call.resolve();
        } else {
            call.reject("剪贴板不可用");
        }
    }

    /* ── 网络（标题抓取，绕过 CORS）────────────────────────── */

    @PluginMethod
    public void httpGet(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("缺少网址"); return; }

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                conn.setRequestProperty("User-Agent",
                        "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
                conn.setInstanceFollowRedirects(true);

                int status = conn.getResponseCode();
                InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (in == null) {
                    JSObject r = new JSObject();
                    r.put("status", status);
                    r.put("data", "");
                    call.resolve(r);
                    return;
                }

                java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n, total = 0;
                while ((n = in.read(chunk)) > 0 && total < 262144) {
                    buf.write(chunk, 0, n);
                    total += n;
                }
                in.close();

                JSObject r = new JSObject();
                r.put("status", status);
                r.put("data", buf.toString("UTF-8"));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /* ── 应用内更新 ────────────────────────────────────────── */

    @PluginMethod
    public void installApk(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("缺少下载地址"); return; }

        new Thread(() -> {
            try {
                File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) dir = getContext().getCacheDir();
                File apk = new File(dir, "jiansu-update.apk");

                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(true);
                conn.connect();

                int status = conn.getResponseCode();
                if (status < 200 || status >= 400) { call.reject("下载失败：" + status); return; }

                long expected = conn.getContentLengthLong();
                InputStream in = conn.getInputStream();
                FileOutputStream out = new FileOutputStream(apk);
                byte[] buf = new byte[16384];
                long written = 0;
                int n;
                while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); written += n; }
                out.flush();
                out.getFD().sync();
                out.close();
                in.close();
                conn.disconnect();

                if (expected > 0 && written != expected) { call.reject("文件不完整"); return; }

                Intent it = new Intent(Intent.ACTION_VIEW);
                it.setDataAndType(
                        androidx.core.content.FileProvider.getUriForFile(
                                getContext(),
                                getContext().getPackageName() + ".fileprovider",
                                apk),
                        "application/vnd.android.package-archive");
                it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

                getActivity().runOnUiThread(() -> getContext().startActivity(it));
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        }).start();
    }

    /* ── 从外部链接进入（默认浏览器注册）─────────────────── */

    @PluginMethod
    public void getLaunchUrl(PluginCall call) {
        JSObject r = new JSObject();
        String url = "";
        int mode = 0;
        try {
            Intent it = getActivity().getIntent();
            if (it != null) {
                if (it.getData() != null) url = it.getData().toString();
                mode = it.getIntExtra("jiansu_mode", 0);
            }
        } catch (Exception ignored) {}
        r.put("url", url);
        r.put("mode", mode);
        call.resolve(r);
    }
}
