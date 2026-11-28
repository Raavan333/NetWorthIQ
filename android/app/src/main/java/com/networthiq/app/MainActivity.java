package com.networthiq.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);
        super.onCreate(savedInstanceState);

        try {
            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                WebSettings settings = webView.getSettings();
                settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
                // Strictly offline: do not launch external URLs from WebView downloads
                webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {});
            }
        } catch (Exception ignored) {
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    moveTaskToBack(true);
                    return;
                }
                webView.evaluateJavascript(
                    "(function(){return typeof window.__networthiqHandleBack==='function'?window.__networthiqHandleBack():'exit';})()",
                    result -> {
                        if (result == null || !result.contains("handled")) {
                            moveTaskToBack(true);
                        }
                    }
                );
            }
        });
    }
}
