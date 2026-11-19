package com.yeobaek.browser;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 先注册插件，再交给 Bridge 初始化
        registerPlugin(YeobaekNativePlugin.class);
        super.onCreate(savedInstanceState);

        // 让 WebView 自己处理视口与缩放，避免系统再次缩放导致错位
        WebSettings s = getBridge().getWebView().getSettings();
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setJavaScriptEnabled(true);
        // 页面需要 cookie 才能在 APK 内保持登录态
        android.webkit.CookieManager.getInstance().setAcceptCookie(true);
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(
                getBridge().getWebView(), true);
    }
}
