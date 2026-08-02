package cz.ok2mkj.solar;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        Intent monitor = new Intent(context, MonitorService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(monitor); else context.startService(monitor);
    }
}
