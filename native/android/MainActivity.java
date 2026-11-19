package com.yeobaek.browser;

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

        // 沉浸式：内容铺到状态栏下面，栏底透明
        Window w = getWindow();
        WindowCompat.setDecorFitsSystemWindows(w, false);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);

        // 键盘弹出时压缩布局而不是遮住内容（p4：IME Insets）
        w.setSoftInputMode(
                android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                | android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_UNSPECIFIED);

        WebSettings s = getBridge().getWebView().getSettings();

        // 壳 WebView 的视口设置：
        // 不要用 loadWithOverviewMode，它会把整页缩小塞进屏幕，
        // 这正是之前「浏览器大小古怪、能放大缩小」的根源。
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);

        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setJavaScriptEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        android.webkit.CookieManager cm = android.webkit.CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(getBridge().getWebView(), true);

        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);

        // 手势冲突：不让系统的手势导航区吞掉网页边缘滑动
        getBridge().getWebView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
}
