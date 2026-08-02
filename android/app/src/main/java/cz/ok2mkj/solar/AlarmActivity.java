package cz.ok2mkj.solar;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class AlarmActivity extends Activity {
    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.rgb(90, 0, 0));
        getWindow().setNavigationBarColor(Color.rgb(55, 0, 0));
        buildScreen();
    }

    private int dp(float value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void buildScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(26), dp(32), dp(26), dp(32));
        root.setBackgroundColor(Color.rgb(110, 0, 0));

        TextView icon = text("⚠", 76, Color.rgb(255, 225, 80));
        root.addView(icon);
        TextView title = text(getIntent().getStringExtra("title"), 32, Color.WHITE);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        root.addView(title);
        TextView detail = text(getIntent().getStringExtra("detail"), 18, Color.rgb(255, 225, 225));
        detail.setGravity(Gravity.CENTER);
        detail.setPadding(0, dp(18), 0, dp(30));
        root.addView(detail);

        Button silence = button("ZTIŠIT SIRÉNU", Color.WHITE, Color.rgb(120, 0, 0));
        silence.setOnClickListener(view -> {
            startService(new Intent(this, MonitorService.class).setAction(MonitorService.ACTION_SILENCE_ALARM));
            finish();
        });
        root.addView(silence, new LinearLayout.LayoutParams(-1, dp(58)));

        Button dashboard = button("OTEVŘÍT DASHBOARD", Color.rgb(75, 0, 0), Color.WHITE);
        dashboard.setOnClickListener(view -> {
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
            finish();
        });
        LinearLayout.LayoutParams dashboardParams = new LinearLayout.LayoutParams(-1, dp(58));
        dashboardParams.topMargin = dp(12);
        root.addView(dashboard, dashboardParams);

        TextView warning = text("Ztišení sirény neruší poplach na Raspberry Pi ani znovu nezapíná relé.", 13, Color.rgb(255, 190, 190));
        warning.setGravity(Gravity.CENTER);
        warning.setPadding(0, dp(24), 0, 0);
        root.addView(warning);
        setContentView(root);
    }

    private TextView text(String value, float size, int color) {
        TextView view = new TextView(this);
        view.setText(value == null ? "KRITICKÝ POPLACH" : value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private Button button(String label, int background, int foreground) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(foreground);
        button.setTextSize(15);
        button.setTypeface(Typeface.DEFAULT_BOLD);
        button.setBackgroundColor(background);
        return button;
    }
}
