package com.networthiq.app;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.DownloadListener;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);
        super.onCreate(savedInstanceState);
        try {
            WebView webView = this.getBridge().getWebView();
            if (webView != null) {
                webView.setDownloadListener(new DownloadListener() {
                    @Override
                    public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                        try {
                            if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                                Intent intent = new Intent(Intent.ACTION_VIEW);
                                intent.setData(Uri.parse(url));
                                startActivity(intent);
                            }
                        } catch (Exception ignored) {
                        }
                    }
                });
            }
        } catch (Exception ignored) {
        }
    }
}
