package com.tbmreport.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * TBM Report: shows the live report site, so every update and the manager's
 * on/off switch (status.json) reach the app without reinstalling.
 */
public class MainActivity extends Activity {

    private static final String HOST = "anosswb.github.io";
    private static final String START_URL = "https://" + HOST + "/TBM-report/";
    private static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    private WebView web;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " TBMReportApp/" + BuildConfigVersion.name(this));

        web.addJavascriptInterface(new Bridge(), "TBMAndroid");
        web.setWebChromeClient(new WebChromeClient());   // enables confirm() / alert() dialogs
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/TBM-report")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline(view);
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    private void showOffline(WebView view) {
        String html = "<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<body style='margin:0;font:18px system-ui,sans-serif;background:#12324f;color:#fff;display:flex;"
            + "min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px'>"
            + "<div><h2>Sin conexión</h2><p>No connection</p>"
            + "<p style='opacity:.8;font-size:15px'>La primera apertura necesita internet.<br>The first start needs internet.</p>"
            + "<button onclick=\"location.href='" + START_URL + "'\" style='font:inherit;font-weight:700;"
            + "padding:14px 28px;border:0;border-radius:12px;background:#f2a900;color:#1b1300'>"
            + "Reintentar / Retry</button></div></body>";
        view.loadDataWithBaseURL(START_URL, html, "text/html", "utf-8", START_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // ask the page to re-check the on/off switch when the app comes back
        if (web != null) web.evaluateJavascript("window.TBMPortal && TBMPortal.recheck()", null);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }

    /** Called from the page: saves the generated Excel and opens the share sheet. */
    private class Bridge {
        @JavascriptInterface
        public String saveFile(String base64, String name) {
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
                if (!safe.endsWith(".xlsx")) safe += ".xlsx";

                String where = "";
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, XLSX);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/TBM Report");
                    ContentResolver cr = getContentResolver();
                    Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri != null) {
                        try (OutputStream os = cr.openOutputStream(uri)) { if (os != null) os.write(data); }
                        where = "Download/TBM Report/" + safe;
                    }
                }

                File dir = new File(getCacheDir(), "reports");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("cache folder");
                File f = new File(dir, safe);
                try (FileOutputStream fos = new FileOutputStream(f)) { fos.write(data); }
                final Uri share = FileProvider.getUriForFile(MainActivity.this, "com.tbmreport.app.files", f);
                final String msg = where.isEmpty() ? safe : where;

                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "✓ " + msg, Toast.LENGTH_LONG).show();
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(XLSX);
                    send.putExtra(Intent.EXTRA_STREAM, share);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { startActivity(Intent.createChooser(send, "Enviar Excel / Send Excel")); } catch (Exception ignored) { }
                });
                return "ok:" + msg;
            } catch (Exception e) {
                return "error: " + e.getMessage();
            }
        }

        @JavascriptInterface
        public String version() { return BuildConfigVersion.name(MainActivity.this); }
    }
}
