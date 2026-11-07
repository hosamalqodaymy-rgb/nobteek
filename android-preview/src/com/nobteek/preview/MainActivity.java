package com.nobteek.preview;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private final String[] screens = {"PublicBooking", "BookingList", "BookingConfirmed", "BookingEmpty"};
    private final String[] labels = {"طلب المراجع", "الاستقبال — طلب معلق", "الاستقبال — حجز مؤكد", "قائمة فارغة"};
    private WebView web;
    private Spinner screen;
    private Button zoom;
    private boolean largeText = false;
    private boolean syncingSelection = false;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setBackgroundColor(Color.rgb(245, 248, 250));
        TextView notice = new TextView(this);
        notice.setText("معاينة محلية P06 · الحجوزات محاكاة ولا تُحفظ في الخادم");
        notice.setTextColor(Color.rgb(20, 54, 75));
        notice.setTextSize(13);
        notice.setPadding(dp(12), dp(7), dp(12), dp(7));
        root.addView(notice);
        screen = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        screen.setAdapter(adapter);
        screen.setContentDescription("اختر شاشة التجربة");
        root.addView(screen, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        LinearLayout controls = new LinearLayout(this);
        zoom = new Button(this);
        zoom.setText("النص 100%");
        Button guide = new Button(this);
        guide.setText("طريقة الاختبار");
        controls.addView(zoom, new LinearLayout.LayoutParams(0, dp(48), 1));
        controls.addView(guide, new LinearLayout.LayoutParams(0, dp(48), 1));
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
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        if (Build.VERSION.SDK_INT >= 30) getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBlockNetworkLoads(true);
        settings.setTextZoom(100);
        WebView.setWebContentsDebuggingEnabled(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String path = uri.getPath();
                if (!HOST.equals(uri.getHost()) || path == null || !path.startsWith("/assets/web/") || path.contains("..") || path.contains("\\")) return response("text/plain", new ByteArrayInputStream(new byte[0]), 403);
                try {
                    String asset = "web/" + path.substring("/assets/web/".length());
                    return response(mime(asset), getAssets().open(asset), 200);
                } catch (Exception e) { return response("text/plain", new ByteArrayInputStream(new byte[0]), 404); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !HOST.equals(request.getUrl().getHost()); }
            @Override public void onPageFinished(WebView view, String url) {
                String selected = Uri.parse(url).getQueryParameter("screen");
                for (int i = 0; i < screens.length; i++) if (screens[i].equals(selected) && screen.getSelectedItemPosition() != i) {
                    syncingSelection = true; screen.setSelection(i); syncingSelection = false;
                }
                applyTextSize();
            }
        });
        screen.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { if (!syncingSelection) load(position); }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        zoom.setOnClickListener(view -> { largeText = !largeText; zoom.setText(largeText ? "النص 200%" : "النص 100%"); applyTextSize(); });
        guide.setOnClickListener(view -> new AlertDialog.Builder(this).setTitle("اختبار الجوال P06").setMessage(
            "هذه معاينة واجهات محلية فقط بلا دخول حقيقي أو حجز على الخادم. تتجدد البيانات عند تغيير الشاشة.\n\n" +
            "1 افتح طلب المراجع واختر الجلسة والنافذة واكتب اسما وهميا ورقم 700000099 ثم أرسل الطلب.\n" +
            "2 افتح الاستقبال وجرب تأكيد حجز المثال وتأجيله وإلغاءه.\n" +
            "3 افتح لوحة المفاتيح وتأكد أن الاسم ورقم الهاتف وزر الإرسال ظاهرة ويمكن الوصول إليها.\n" +
            "4 اضغط النص 200% وجرب حقل يوم الجلسة والتمرير.\n" +
            "5 أدر الجوال ثم أخبرني بأي قص للنص أو زر لا يستجيب، وأرسل صورة للمشكلة.").setPositiveButton("فهمت", null).show());
        load(0);
    }
    private void load(int position) { web.loadUrl("https://" + HOST + "/assets/web/phone-preview-frame.html?screen=" + screens[position] + "&zoom=" + (largeText ? "200" : "100")); }
    private void applyTextSize() { web.evaluateJavascript("document.documentElement.style.fontSize='" + (largeText ? "200%" : "100%") + "';", null); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private String mime(String file) {
        if (file.endsWith(".html")) return "text/html";
        if (file.endsWith(".js")) return "application/javascript";
        if (file.endsWith(".css")) return "text/css";
        if (file.endsWith(".svg")) return "image/svg+xml";
        if (file.endsWith(".png")) return "image/png";
        if (file.endsWith(".woff")) return "font/woff";
        if (file.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }
    private WebResourceResponse response(String type, InputStream stream, int status) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'");
        return new WebResourceResponse(type, "UTF-8", status, status == 200 ? "OK" : "Unavailable", headers, stream);
    }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { if (web != null) { web.stopLoading(); web.destroy(); } super.onDestroy(); }
}
