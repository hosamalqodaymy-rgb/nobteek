package com.nobteek.dhamarqa;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String HOST = "nobteek-dhamar-qa-20261125.onrender.com";
    private static final String ORIGIN = "https://" + HOST;
    private static final int FILE_REQUEST = 19;
    private WebView web;
    private int textZoom = 100;
    private ValueCallback<Uri[]> fileChooser;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setBackgroundColor(Color.rgb(243, 247, 247));
        TextView notice = new TextView(this);
        notice.setText("نوبتيك · تجربة ذمار · استخدم بيانات وهمية");
        notice.setTextColor(Color.rgb(21, 56, 61));
        notice.setTextSize(14);
        notice.setPadding(dp(12), dp(3), dp(12), dp(3));
        root.addView(notice);
        LinearLayout controls = new LinearLayout(this);
        addButton(controls, "الدليل", view -> open("/qa-guide.php"));
        addButton(controls, "مساحة العمل", view -> open("/workspace"));
        addButton(controls, "النص 100٪", view -> {
            textZoom = textZoom == 100 ? 200 : 100;
            web.getSettings().setTextZoom(textZoom);
            ((Button) view).setText("النص " + textZoom + "٪");
        });
        root.addView(controls);
        web = new WebView(this);
        web.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
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
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(textZoom);
        WebView.setWebContentsDebuggingEnabled(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !allowed(request.getUrl());
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse error) {
                if (request.isForMainFrame() && error.getStatusCode() == 403 && allowed(request.getUrl())) {
                    open("/qa-access.php");
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
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
        web.setDownloadListener((url, agent, disposition, mime, size) -> saveTestFile(url, disposition));
        open("/qa-access.php");
    }

    private void addButton(LinearLayout controls, String label, View.OnClickListener action) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(12);
        button.setMinWidth(0);
        button.setPadding(dp(4), 0, dp(4), 0);
        button.setOnClickListener(action);
        controls.addView(button, new LinearLayout.LayoutParams(0, dp(43), 1));
    }

    private void saveTestFile(String url, String disposition) {
        Uri uri = Uri.parse(url);
        if (!allowed(uri)) return;
        String path = uri.getPath();
        if (path == null) return;
        boolean report = path.equals("/v1/operations/report.csv") || path.equals("/v1/patients/export");
        boolean proof = path.equals("/qa-guide.php") && "1".equals(uri.getQueryParameter("proof"))
            || path.matches("^/(platform|v1)/billing/proofs/[0-9a-f-]{36}$");
        if (!report && !proof) return;

        String extension = "pdf";
        if (disposition != null) {
            if (disposition.contains(".png")) extension = "png";
            if (disposition.contains(".jpeg") || disposition.contains(".jpg")) extension = "jpg";
        }
        String name = report ? "Nobteek_Test_Report.csv" : "Nobteek_Test_Proof." + extension;
        DownloadManager.Request request = new DownloadManager.Request(uri)
            .setTitle(name)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, System.currentTimeMillis() + "_" + name)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null) request.addRequestHeader("Cookie", cookies);
        try {
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            Toast.makeText(this, "بدأ تنزيل ملف الاختبار", Toast.LENGTH_SHORT).show();
        } catch (RuntimeException error) {
            Toast.makeText(this, "تعذر تنزيل الملف", Toast.LENGTH_SHORT).show();
        }
    }

    private boolean allowed(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void open(String path) { web.loadUrl(ORIGIN + path); }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_REQUEST && fileChooser != null) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            fileChooser.onReceiveValue(uri != null && "content".equals(uri.getScheme()) ? new Uri[]{uri} : null);
            fileChooser = null;
        }
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
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
