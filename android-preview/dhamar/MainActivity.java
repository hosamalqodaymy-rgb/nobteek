package com.nobteek.dhamarbatch2;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.Button;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String PREFIX = "/assets/web/";
    private static final String INDEX = "https://" + HOST + PREFIX + "index.html";
    private static final Uri CONNECTED_ORIGIN = DhamarBuild.CONNECTED_ORIGIN.isEmpty() ? null : Uri.parse(DhamarBuild.CONNECTED_ORIGIN);
    private static final String CONNECTED_ENTRY = DhamarBuild.CONNECTED_ORIGIN + "/preview/dhamar/index.html";
    private static final int FILE_REQUEST = 19;
    private WebView web;
    private ValueCallback<Uri[]> fileChooser;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setBackgroundColor(Color.rgb(245, 248, 250));
        web = new WebView(this);
        web.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        LinearLayout connectionNotice = CONNECTED_ORIGIN == null ? null : createConnectionNotice();
        if (connectionNotice != null) root.addView(connectionNotice);
        setContentView(root);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        if (Build.VERSION.SDK_INT >= 30) getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(CONNECTED_ORIGIN == null);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(false);
        settings.setBlockNetworkLoads(CONNECTED_ORIGIN == null);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (CONNECTED_ORIGIN != null) return !isConnectedOrigin(request.getUrl());
                String url = request.getUrl().toString();
                return !INDEX.equals(url) && !url.startsWith(INDEX + "#");
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (CONNECTED_ORIGIN != null) {
                    return isConnectedOrigin(uri) ? null : response("text/plain", new ByteArrayInputStream(new byte[0]), 403);
                }
                String path = uri.getPath();
                if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost()) || path == null || !path.startsWith(PREFIX)) {
                    return response("text/plain", new ByteArrayInputStream(new byte[0]), 403);
                }
                String asset = path.substring(PREFIX.length());
                String mime;
                switch (asset) {
                    case "index.html": mime = "text/html"; break;
                    case "discovery.css":
                    case "style.css":
                    case "styles/brand.generated.css": mime = "text/css"; break;
                    case "discovery.js":
                    case "booking.js":
                    case "clinic.js":
                    case "connection.js":
                    case "discovery/demo.js":
                    case "app.js":
                    case "hiring.js":
                    case "jobs.js":
                    case "platform.js":
                    case "support.js": mime = "application/javascript"; break;
                    case "discovery/entrances.webp":
                    case "discovery/consultation.webp":
                    case "discovery/practitioners.webp":
                    case "discovery/services.webp": mime = "image/webp"; break;
                    case "logo-ar.png": mime = "image/png"; break;
                    case "fonts/Tajawal-Regular.woff":
                    case "fonts/Tajawal-Medium.woff":
                    case "fonts/Tajawal-Bold.woff": mime = "font/woff"; break;
                    default: return response("text/plain", new ByteArrayInputStream(new byte[0]), 404);
                }
                try {
                    return response(mime, getAssets().open("web/" + asset), 200);
                } catch (java.io.IOException error) {
                    return response("text/plain", new ByteArrayInputStream(new byte[0]), 404);
                }
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (connectionNotice != null && request.isForMainFrame()) {
                    showConnectionNotice(connectionNotice);
                }
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse error) {
                if (connectionNotice != null && request.isForMainFrame() && error.getStatusCode() >= 500) {
                    showConnectionNotice(connectionNotice);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (CONNECTED_ORIGIN != null) return false;
                if (fileChooser != null) fileChooser.onReceiveValue(null);
                fileChooser = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf", "image/jpeg", "image/png"});
                try {
                    startActivityForResult(pick, FILE_REQUEST);
                } catch (ActivityNotFoundException error) {
                    fileChooser.onReceiveValue(null);
                    fileChooser = null;
                }
                return true;
            }
        });
        web.loadUrl(CONNECTED_ORIGIN == null ? INDEX : CONNECTED_ENTRY);
    }

    private boolean isConnectedOrigin(Uri uri) {
        return "https".equals(uri.getScheme()) && CONNECTED_ORIGIN.getHost().equalsIgnoreCase(uri.getHost())
            && uri.getEncodedUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private LinearLayout createConnectionNotice() {
        LinearLayout notice = new LinearLayout(this);
        notice.setOrientation(LinearLayout.VERTICAL);
        notice.setGravity(Gravity.CENTER);
        notice.setPadding(24, 24, 24, 24);
        notice.setVisibility(View.GONE);
        notice.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        TextView message = new TextView(this);
        message.setText("تعذّر الاتصال بخادم نوبتيك التجريبي. تحقق من الاتصال ثم أعد المحاولة.");
        message.setTextSize(18);
        message.setGravity(Gravity.CENTER);
        notice.addView(message);

        Button retry = new Button(this);
        retry.setText("إعادة المحاولة");
        retry.setOnClickListener(view -> {
            String current = web.getUrl();
            notice.setVisibility(View.GONE);
            web.setVisibility(View.VISIBLE);
            web.loadUrl(current != null && isConnectedOrigin(Uri.parse(current)) ? current : CONNECTED_ENTRY);
        });
        notice.addView(retry);

        return notice;
    }

    private void showConnectionNotice(LinearLayout notice) {
        web.setVisibility(View.GONE);
        notice.setVisibility(View.VISIBLE);
    }

    private WebResourceResponse response(String mime, InputStream body, int status) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
        return new WebResourceResponse(mime, "UTF-8", status, status == 200 ? "OK" : "Unavailable", headers, body);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_REQUEST && fileChooser != null) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            fileChooser.onReceiveValue(uri != null && "content".equals(uri.getScheme()) ? new Uri[]{uri} : null);
            fileChooser = null;
        }
    }

    @Override public void onBackPressed() {
        if (web.getVisibility() == View.VISIBLE && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (fileChooser != null) fileChooser.onReceiveValue(null);
        if (web != null) {
            web.stopLoading();
            web.destroy();
        }
        super.onDestroy();
    }
}
