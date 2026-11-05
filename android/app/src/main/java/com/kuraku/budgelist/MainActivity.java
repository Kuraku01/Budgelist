package com.kuraku.budgelist;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    private long lastBackPressTime = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().addJavascriptInterface(new WebAppInterface(this), "AndroidBridge");

            try {
                android.content.pm.PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
                android.content.SharedPreferences prefs = getSharedPreferences("budgelist_native_meta", Context.MODE_PRIVATE);
                long lastRecordedUpdate = prefs.getLong("apk_last_update_time", 0L);
                if (lastRecordedUpdate != pInfo.lastUpdateTime) {
                    prefs.edit().putLong("apk_last_update_time", pInfo.lastUpdateTime).apply();
                    final String buildSig = "v" + pInfo.versionName + "_" + pInfo.lastUpdateTime;
                    this.bridge.getWebView().evaluateJavascript(
                        "(function(){" +
                        "try{" +
                        "localStorage.removeItem('budgelist-bundle-app-js');" +
                        "localStorage.removeItem('budgelist-bundle-style-css');" +
                        "localStorage.removeItem('budgelist-bundle-body-html');" +
                        "localStorage.removeItem('budgelist-installed-bundle-key');" +
                        "localStorage.removeItem('budgelist-installed-bundle-channel');" +
                        "localStorage.removeItem('budgelist-installed-bundle-time');" +
                        "localStorage.removeItem('budgelist-skipped-ota-key');" +
                        "localStorage.setItem('budgelist-native-build-key','" + buildSig + "');" +
                        "window.location.reload();" +
                        "}catch(e){}" +
                        "})()",
                        null
                    );
                }
            } catch (Exception e) {
                Log.w("MainActivity", "Failed to check APK update timestamp", e);
            }
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().evaluateJavascript(
                        "(function() { return typeof window.__handleAndroidBack === 'function' ? window.__handleAndroidBack() : 'UNHANDLED'; })()",
                        value -> {
                            if ("\"HANDLED\"".equals(value)) {
                                return;
                            }
                            if ("\"EXIT\"".equals(value)) {
                                finish();
                                return;
                            }
                            long now = System.currentTimeMillis();
                            if (now - lastBackPressTime < 2000) {
                                finish();
                            } else {
                                lastBackPressTime = now;
                                Toast.makeText(MainActivity.this, "Press back again to exit", Toast.LENGTH_SHORT).show();
                            }
                        }
                    );
                } else {
                    finish();
                }
            }
        });
    }

    public static class WebAppInterface {
        private final Context mContext;

        WebAppInterface(Context c) {
            mContext = c;
        }

        @JavascriptInterface
        public String getNativeBuildSignature() {
            try {
                android.content.pm.PackageInfo pInfo = mContext.getPackageManager()
                        .getPackageInfo(mContext.getPackageName(), 0);
                return "v" + pInfo.versionName + "_" + pInfo.lastUpdateTime;
            } catch (Exception e) {
                return "v0.2.1-beta";
            }
        }

        @JavascriptInterface
        public boolean saveCsv(String filename, String csvContent) {
            try {
                if (filename == null || filename.isEmpty()
                        || filename.contains("..") || filename.contains("/") || filename.contains("\\")) {
                    throw new IllegalArgumentException("Invalid filename");
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "text/csv");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);

                    Uri uri = mContext.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri != null) {
                        try (OutputStream out = mContext.getContentResolver().openOutputStream(uri)) {
                            if (out != null) {
                                out.write(csvContent.getBytes(StandardCharsets.UTF_8));
                                out.flush();
                            }
                        }
                    }
                } else {
                    java.io.File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (!downloadsDir.exists()) {
                        downloadsDir.mkdirs();
                    }
                    java.io.File file = new java.io.File(downloadsDir, filename);
                    String canonicalDir = downloadsDir.getCanonicalPath() + java.io.File.separator;
                    if (!file.getCanonicalPath().startsWith(canonicalDir)) {
                        throw new SecurityException("Invalid filename");
                    }
                    try (java.io.FileOutputStream fos = new java.io.FileOutputStream(file)) {
                        fos.write(csvContent.getBytes(StandardCharsets.UTF_8));
                        fos.flush();
                    }
                }
                
                ((BridgeActivity) mContext).runOnUiThread(() -> 
                    Toast.makeText(mContext, "Saved " + filename + " to Downloads", Toast.LENGTH_SHORT).show()
                );
                return true;
            } catch (Exception e) {
                Log.e("WebAppInterface", "Error saving CSV", e);
                return false;
            }
        }
    }
}
