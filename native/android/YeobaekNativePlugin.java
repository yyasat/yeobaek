package com.yeobaek.browser;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;

/**
 * 여백 原生桥。
 *
 * 网页层做不到的三件事在这里落地：
 *  1. 内容铺到状态栏下面（edge-to-edge），栏底透明，图标明暗自适应
 *  2. ShortcutManager 写入桌面图标
 *  3. CookieManager + WebStorage 的彻底清除
 */
@CapacitorPlugin(name = "YeobaekNative")
public class YeobaekNativePlugin extends Plugin {

    /* ── 全屏 / 系统栏 ─────────────────────────────────────── */

    @PluginMethod
    public void enterImmersive(PluginCall call) {
        String color = call.getString("color", "#EEF2F5");
        boolean darkIcons = call.getBoolean("darkIcons", true);

        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();

            // 关键：让 WebView 占满整屏，内容延伸到状态栏与导航栏下方
            WindowCompat.setDecorFitsSystemWindows(w, false);

            // 栏底透明，露出网页自己的底色，于是任何一次换色都自动延伸
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);

            WindowInsetsControllerCompat c =
                    WindowCompat.getInsetsController(w, w.getDecorView());
            c.setAppearanceLightStatusBars(darkIcons);
            c.setAppearanceLightNavigationBars(darkIcons);

            // 状态栏与导航栏都不隐藏：图标仍然可读，但底色由网页决定
            c.show(androidx.core.view.WindowInsetsCompat.Type.statusBars());
            c.show(androidx.core.view.WindowInsetsCompat.Type.navigationBars());
        });

        JSObject ret = new JSObject();
        ret.put("mode", "native");
        ret.put("color", color);
        call.resolve(ret);
    }

    @PluginMethod
    public void setSystemBars(PluginCall call) {
        String color = call.getString("color", "#EEF2F5");
        boolean darkIcons = call.getBoolean("darkIcons", true);

        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            WindowCompat.setDecorFitsSystemWindows(w, false);
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
            WindowInsetsControllerCompat c =
                    WindowCompat.getInsetsController(w, w.getDecorView());
            c.setAppearanceLightStatusBars(darkIcons);
            c.setAppearanceLightNavigationBars(darkIcons);
        });

        JSObject ret = new JSObject();
        ret.put("color", color);
        call.resolve(ret);
    }

    /* ── 桌面快捷方式 ──────────────────────────────────────── */

    @PluginMethod
    public void addShortcut(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "网页");
        String shortLabel = call.getString("shortLabel", title);

        if (url == null) { call.reject("url required"); return; }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("需要 Android 8.0 及以上才能写入桌面图标");
            return;
        }

        ShortcutManager sm = getContext().getSystemService(ShortcutManager.class);
        if (sm == null || !sm.isRequestPinShortcutSupported()) {
            call.reject("当前桌面不支持固定快捷方式");
            return;
        }

        Intent intent = new Intent(getContext(), MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse(url));

        ShortcutInfo info = new ShortcutInfo.Builder(getContext(), "yb_" + Math.abs(url.hashCode()))
                .setShortLabel(shortLabel)
                .setLongLabel(title)
                .setIcon(Icon.createWithBitmap(letterIcon(shortLabel)))
                .setIntent(intent)
                .build();

        boolean ok = sm.requestPinShortcut(info, null);
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    @PluginMethod
    public void removeShortcut(PluginCall call) {
        String url = call.getString("url", "");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ShortcutManager sm = getContext().getSystemService(ShortcutManager.class);
            if (sm != null) {
                String id = "yb_" + Math.abs(url.hashCode());
                try { sm.removeDynamicShortcuts(Collections.singletonList(id)); } catch (Exception ignored) {}
            }
        }
        call.resolve();
    }

    /** 用名称首字画一个方块图标，和网页里的字母占位保持一致。 */
    private Bitmap letterIcon(String label) {
        int size = 192;
        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);

        Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        bg.setColor(Color.parseColor("#EEF2F5"));
        c.drawRoundRect(new RectF(0, 0, size, size), 48, 48, bg);

        Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(9f);
        ring.setColor(Color.parseColor("#5C7488"));
        c.drawRoundRect(new RectF(22, 22, size - 22, size - 22), 40, 40, ring);

        String ch = (label == null || label.isEmpty()) ? "·" : label.substring(0, 1);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(Color.parseColor("#1C262E"));
        p.setTextSize(78f);
        p.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        p.setTextAlign(Paint.Align.CENTER);
        Paint.FontMetrics fm = p.getFontMetrics();
        float y = size / 2f - (fm.ascent + fm.descent) / 2f;
        c.drawText(ch, size / 2f, y, p);

        return bmp;
    }

    /* ── 数据清除 ──────────────────────────────────────────── */

    @PluginMethod
    public void clearSiteData(PluginCall call) {
        String url = call.getString("url", "");
        String host = "";
        try { host = Uri.parse(url).getHost(); } catch (Exception ignored) {}

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);

        // CookieManager 没有按域删除的 API，用逐条过期的方式清
        String cookies = cm.getCookie(url);
        if (cookies != null) {
            for (String pair : cookies.split(";")) {
                String name = pair.split("=")[0].trim();
                if (name.isEmpty()) continue;
                cm.setCookie(url, name + "=; Max-Age=0; path=/");
                cm.setCookie(url, name + "=; Max-Age=0; path=/; domain=." + host);
            }
        }
        cm.flush();

        try { WebStorage.getInstance().deleteOrigin(url); } catch (Exception ignored) {}

        WebView wv = getBridge().getWebView();
        if (wv != null) {
            wv.clearCache(true);
            wv.clearFormData();
            wv.clearHistory();
        }

        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearAllData(PluginCall call) {
        CookieManager cm = CookieManager.getInstance();
        cm.removeAllCookies(null);
        cm.flush();

        try { WebStorage.getInstance().deleteAllData(); } catch (Exception ignored) {}

        WebView wv = getBridge().getWebView();
        if (wv != null) {
            wv.clearCache(true);
            wv.clearFormData();
            wv.clearHistory();
        }

        call.resolve();
    }

    /* ── 剪贴板 ────────────────────────────────────────────── */

    @PluginMethod
    public void readClipboard(PluginCall call) {
        ClipboardManager cm =
                (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        JSObject ret = new JSObject();
        if (cm != null && cm.hasPrimaryClip()) {
            ClipData clip = cm.getPrimaryClip();
            if (clip != null && clip.getItemCount() > 0) {
                CharSequence t = clip.getItemAt(0).coerceToText(getContext());
                ret.put("value", t == null ? "" : t.toString());
                call.resolve(ret);
                return;
            }
        }
        ret.put("value", "");
        call.resolve(ret);
    }

    @PluginMethod
    public void writeClipboard(PluginCall call) {
        String text = call.getString("text", "");
        ClipboardManager cm =
                (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) {
            cm.setPrimaryClip(ClipData.newPlainText("yeobaek", text));
            call.resolve();
        } else {
            call.reject("clipboard unavailable");
        }
    }

    /* ── 启动参数：从桌面图标进来时带的网址 ─────────────────── */

    @PluginMethod
    public void getLaunchUrl(PluginCall call) {
        JSObject ret = new JSObject();
        Intent it = getActivity().getIntent();
        String url = null;
        if (it != null && it.getData() != null) url = it.getData().toString();
        ret.put("url", url == null ? "" : url);
        call.resolve(ret);
    }
}
