package com.yeobaek.browser;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebSettings;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(JianSuNativePlugin.class);
        super.onCreate(savedInstanceState);

        // 让返回键走我们自己的退栈逻辑
        try {
            com.getcapacitor.Plugin p = getBridge().getPlugin("JianSuNative");
            if (p instanceof JianSuNativePlugin) pluginRef = (JianSuNativePlugin) p;
        } catch (Exception ignored) {}

        Window w = getWindow();
        WindowCompat.setDecorFitsSystemWindows(w, false);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);

        // 键盘弹出时压缩布局而非遮挡（P2：输入法协调）
        w.setSoftInputMode(
                android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                | android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED);

        WebSettings s = getBridge().getWebView().getSettings();

        // 关键修正：不要 loadWithOverviewMode，
        // 它会强制整页缩小塞进屏幕，导致「浏览器大小古怪、可缩放」
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);

        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setJavaScriptEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        // 壳页面也要能长按复制
        getBridge().getWebView().setLongClickable(true);
        getBridge().getWebView().setHapticFeedbackEnabled(false);

        android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(getBridge().getWebView(), true);

        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);

        getBridge().getWebView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);

        handleExternalUrl(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleExternalUrl(intent);
    }

    /**
     * 返回键：逐级退栈，绝不直接退出应用。
     * 顺序：网页历史 → 收起网页层 → 回到外壳首页 → 最小化到后台。
     * 全程不销毁任何 WebView，网页数据完整保留。
     */
    @Override
    public void onBackPressed() {
        JianSuNativePlugin plugin = pluginRef;
        if (plugin != null && plugin.handleBack()) return;
        moveTaskToBack(true);
    }

    /** 注册插件时留一个引用给返回键用。 */
    public JianSuNativePlugin pluginRef;

    private void handleExternalUrl(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        final String url = intent.getData().toString();
        if (!url.startsWith("http")) return;

        getBridge().getWebView().postDelayed(() -> {
            getBridge().getWebView().evaluateJavascript(
                    "window.__jiansuLaunch && window.__jiansuLaunch("
                            + org.json.JSONObject.quote(url) + ")", null);
        }, 320);
    }
}
