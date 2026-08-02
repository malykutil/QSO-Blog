package cz.ok2mkj.solar;

import android.Manifest;
import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.window.OnBackInvokedDispatcher;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private WebView webView;
    private ProgressBar progress;
    private TextView connectionStatus;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(7, 17, 13));
        getWindow().setNavigationBarColor(Color.rgb(7, 17, 13));
        NotificationHelper.createChannels(this);
        buildInterface();
        if (Build.VERSION.SDK_INT >= 33) registerPredictiveBack();
        requestNotificationPermissionAndStartMonitoring();
        authenticateAndOpenDashboard();

        if (!getPreferences(MODE_PRIVATE).getBoolean("safety_setup_shown", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("safety_setup_shown", true).apply();
            webView.postDelayed(this::showSafetySettings, 1200);
        }
    }

    private int dp(float value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void buildInterface() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(7, 17, 13));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(16), 0, dp(8), 0);
        toolbar.setBackgroundColor(Color.rgb(7, 17, 13));

        LinearLayout titleBlock = new LinearLayout(this);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        TextView title = new TextView(this);
        title.setText("OK2KZB");
        title.setTextColor(Color.WHITE);
        title.setTextSize(18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        titleBlock.addView(title);
        connectionStatus = new TextView(this);
        connectionStatus.setText("PŘIPOJUJI DASHBOARD");
        connectionStatus.setTextColor(Color.rgb(134, 239, 172));
        connectionStatus.setTextSize(9);
        connectionStatus.setLetterSpacing(0.12f);
        titleBlock.addView(connectionStatus);
        toolbar.addView(titleBlock, new LinearLayout.LayoutParams(0, dp(56), 1));

        Button refresh = toolbarButton("↻");
        refresh.setContentDescription("Aktualizovat dashboard");
        refresh.setOnClickListener(view -> webView.reload());
        toolbar.addView(refresh, new LinearLayout.LayoutParams(dp(48), dp(48)));

        Button settings = toolbarButton("⚙");
        settings.setContentDescription("Nastavení kritických oznámení");
        settings.setOnClickListener(view -> showSafetySettings());
        toolbar.addView(settings, new LinearLayout.LayoutParams(dp(48), dp(48)));
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(56)));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        progress.getIndeterminateDrawable().setTint(Color.rgb(34, 197, 94));
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));

        webView = new WebView(this);
        WebSettings webSettings = webView.getSettings();
        // JavaScript je nutný pro dashboard. WebView přijímá pouze navigaci na pevně nastavený produkční host.
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        webSettings.setBuiltInZoomControls(false);
        webSettings.setDisplayZoomControls(false);
        webSettings.setSupportZoom(false);
        webSettings.setUserAgentString(webSettings.getUserAgentString() + " OK2KZB-Solar-App/2.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setBackgroundColor(Color.rgb(7, 17, 13));
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri.getHost() != null && uri.getHost().equals(Uri.parse(BuildConfig.SOLAR_BASE_URL).getHost())) {
                    return false;
                }
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                connectionStatus.setText("ŽIVÁ DATA • DOHLED AKTIVNÍ");
                connectionStatus.setTextColor(Color.rgb(134, 239, 172));
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        showLoadingPage();
    }

    private Button toolbarButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(20);
        button.setTextColor(Color.WHITE);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setAllCaps(false);
        return button;
    }

    private void showLoadingPage() {
        String html = "<html><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<body style='margin:0;background:#07110d;color:#f8fafc;font-family:sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center'>"
            + "<div style='text-align:center;padding:30px'><div style='font-size:52px'>☀</div>"
            + "<h1 style='margin:16px 0 8px'>Solární dohled</h1><p style='color:#86efac'>Připojuji živá data a zabezpečené ovládání…</p></div></body></html>";
        webView.loadDataWithBaseURL(BuildConfig.SOLAR_BASE_URL, html, "text/html", "UTF-8", null);
    }

    private void authenticateAndOpenDashboard() {
        executor.execute(() -> {
            boolean authenticated = false;
            try {
                if (!BuildConfig.SOLAR_USERNAME.isEmpty() && !BuildConfig.SOLAR_PASSWORD.isEmpty()) {
                    JSONObject credentials = new JSONObject()
                        .put("email", BuildConfig.SOLAR_USERNAME)
                        .put("password", BuildConfig.SOLAR_PASSWORD);
                    ApiClient.Response response = ApiClient.request("/api/auth/login", "POST", credentials, null);
                    if (response.code >= 200 && response.code < 300 && response.cookie != null) {
                        CookieManager.getInstance().setCookie(BuildConfig.SOLAR_BASE_URL, response.cookie);
                        CookieManager.getInstance().flush();
                        authenticated = true;
                    }
                }
            } catch (Exception ignored) {
                // Dashboard se i při chybě přihlášení otevře alespoň v režimu čtení.
            }
            boolean finalAuthenticated = authenticated;
            runOnUiThread(() -> {
                progress.setVisibility(View.VISIBLE);
                webView.loadUrl(BuildConfig.SOLAR_BASE_URL + "/solar");
                if (!finalAuthenticated) {
                    connectionStatus.setText("REŽIM ČTENÍ • CHYBÍ PŘÍSTUP");
                    connectionStatus.setTextColor(Color.rgb(251, 191, 36));
                    Toast.makeText(this, "Automatické ověření se nezdařilo. Ovládání může být nedostupné.", Toast.LENGTH_LONG).show();
                }
            });
        });
    }

    private void requestNotificationPermissionAndStartMonitoring() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        } else {
            startMonitoring();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        NotificationHelper.createChannels(this);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) startMonitoring();
    }

    private void startMonitoring() {
        Intent intent = new Intent(this, MonitorService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent); else startService(intent);
    }

    private void showSafetySettings() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        boolean notifications = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        boolean dnd = manager.isNotificationPolicyAccessGranted();
        boolean fullScreen = Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent();
        String[] items = {
            (notifications ? "✓ " : "⚠ ") + "Oznámení aplikace",
            (dnd ? "✓ " : "⚠ ") + "Zvuk přes režim Nerušit",
            (fullScreen ? "✓ " : "⚠ ") + "Poplach přes zamčenou obrazovku",
            "Optimalizace baterie a běh na pozadí"
        };
        new AlertDialog.Builder(this)
            .setTitle("Kritická ochrana telefonu")
            .setMessage("Pro spolehlivý hlasitý poplach povol všechny tři položky. Hodinové souhrny a alarmy zajišťuje trvale běžící dohled.")
            .setItems(items, (dialog, which) -> openSafetySetting(which))
            .setNegativeButton("Hotovo", null)
            .show();
    }

    private void openSafetySetting(int which) {
        try {
            if (which == 0) {
                if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
                else openAppNotificationSettings();
            } else if (which == 1) {
                startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
            } else if (which == 2 && Build.VERSION.SDK_INT >= 34) {
                startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName())));
            } else if (which == 2) {
                openAppNotificationSettings();
            } else {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
            }
        } catch (Exception exception) {
            openAppNotificationSettings();
        }
    }

    private void openAppNotificationSettings() {
        Intent intent;
        if (Build.VERSION.SDK_INT >= 26) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
        }
        startActivity(intent);
    }

    @TargetApi(33)
    private void registerPredictiveBack() {
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            OnBackInvokedDispatcher.PRIORITY_DEFAULT,
            this::handleBack);
    }

    private void handleBack() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else finish();
    }

    @Override
    @SuppressLint("GestureBackNavigation")
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        executor.shutdownNow();
        super.onDestroy();
    }
}
