package cz.ok2mkj.solar;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {
    static final String ACTION_RESTART_MONITOR = "cz.ok2mkj.solar.RESTART_MONITOR";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        boolean allowed = Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            || Intent.ACTION_USER_UNLOCKED.equals(action)
            || ACTION_RESTART_MONITOR.equals(action)
            || "android.intent.action.QUICKBOOT_POWERON".equals(action)
            || "com.htc.intent.action.QUICKBOOT_POWERON".equals(action);
        if (!allowed) return;
        Intent monitor = new Intent(context, MonitorService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(monitor); else context.startService(monitor);
    }
}
