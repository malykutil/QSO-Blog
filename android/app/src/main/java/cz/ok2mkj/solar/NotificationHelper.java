package cz.ok2mkj.solar;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

import java.util.Locale;

final class NotificationHelper {
    static final String CHANNEL_MONITOR = "solar_monitor";
    static final String CHANNEL_SUMMARY = "solar_hourly";
    static final String CHANNEL_CRITICAL = "solar_critical_v2";
    static final int MONITOR_NOTIFICATION_ID = 100;
    static final int SUMMARY_NOTIFICATION_ID = 200;
    static final int CRITICAL_NOTIFICATION_ID = 911;

    private NotificationHelper() {}

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);

        NotificationChannel monitor = new NotificationChannel(CHANNEL_MONITOR, "Aktivní solární dohled", NotificationManager.IMPORTANCE_LOW);
        monitor.setDescription("Trvale běžící kontrola telemetrie a bezpečnostních stavů");
        monitor.setShowBadge(false);
        manager.createNotificationChannel(monitor);

        NotificationChannel summary = new NotificationChannel(CHANNEL_SUMMARY, "Hodinové souhrny", NotificationManager.IMPORTANCE_DEFAULT);
        summary.setDescription("Souhrn teplot a nabíjecích nebo vybíjecích proudů každou hodinu");
        manager.createNotificationChannel(summary);

        NotificationChannel critical = new NotificationChannel(CHANNEL_CRITICAL, "KRITICKÉ POPLACHY", NotificationManager.IMPORTANCE_HIGH);
        critical.setDescription("Požár, plyn, vysoká teplota baterie, nízké napětí nebo výpadek telemetrie");
        critical.enableVibration(true);
        critical.setVibrationPattern(new long[]{0, 700, 250, 700, 250, 1400});
        critical.enableLights(true);
        critical.setLightColor(Color.RED);
        critical.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        critical.setSound(Settings.System.DEFAULT_ALARM_ALERT_URI,
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        if (manager.isNotificationPolicyAccessGranted()) critical.setBypassDnd(true);
        manager.createNotificationChannel(critical);
    }

    static Notification monitorNotification(Context context, String status) {
        Intent open = new Intent(context, MainActivity.class);
        PendingIntent pendingOpen = PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return builder(context, CHANNEL_MONITOR)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle("OK2KZB • bezpečnostní dohled")
            .setContentText(status)
            .setContentIntent(pendingOpen)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOnlyAlertOnce(true)
            .build();
    }

    static void postHourlySummary(Context context, JSONObject telemetry) {
        String temperatures = String.format(Locale.US, "Objekt %s • Baterie %s • MPPT %s • Venku %s",
            value(telemetry, "object_temperature", "°C", 1),
            value(telemetry, "battery_temperature", "°C", 1),
            value(telemetry, "mppt_temperature", "°C", 1),
            value(telemetry, "outside_temperature", "°C", 1));
        String currents = String.format(Locale.US, "Solární vstup %s • Zátěž %s",
            value(telemetry, "solar1_current", "A", 2),
            value(telemetry, "solar2_current", "A", 2));
        double batteryCurrent = number(telemetry, "battery_current");
        String batteryState = Double.isNaN(batteryCurrent) ? "neznámý stav" : batteryCurrent > 0.1 ? "nabíjení" : batteryCurrent < -0.1 ? "vybíjení" : "klid";
        String battery = "Baterie " + value(telemetry, "battery_current", "A", 2) + " • " + batteryState;
        String ups = "UPS " + value(telemetry, "ups_current_a", "A", 3) + " • " + value(telemetry, "ups_charge_percent", "%", 0);

        Notification.InboxStyle style = new Notification.InboxStyle()
            .setBigContentTitle("Hodinový souhrn solárního systému")
            .addLine(temperatures)
            .addLine(currents)
            .addLine(battery)
            .addLine(ups);
        PendingIntent open = PendingIntent.getActivity(context, 2, new Intent(context, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = builder(context, CHANNEL_SUMMARY)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentTitle("Solární souhrn • " + batteryState)
            .setContentText(temperatures)
            .setStyle(style)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_STATUS)
            .build();
        context.getSystemService(NotificationManager.class).notify(SUMMARY_NOTIFICATION_ID, notification);
    }

    static void postCriticalAlarm(Context context, String title, String detail) {
        Intent alarmScreen = new Intent(context, AlarmActivity.class)
            .putExtra("title", title)
            .putExtra("detail", detail)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent fullScreen = PendingIntent.getActivity(context, 3, alarmScreen, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent silenceIntent = new Intent(context, MonitorService.class).setAction(MonitorService.ACTION_SILENCE_ALARM);
        PendingIntent silence = PendingIntent.getService(context, 4, silenceIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.BigTextStyle style = new Notification.BigTextStyle().bigText(detail).setBigContentTitle(title);
        Notification notification = builder(context, CHANNEL_CRITICAL)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setColor(Color.RED)
            .setContentTitle(title)
            .setContentText(detail)
            .setStyle(style)
            .setCategory(Notification.CATEGORY_ALARM)
            .setPriority(Notification.PRIORITY_MAX)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(false)
            .setContentIntent(fullScreen)
            .setFullScreenIntent(fullScreen, true)
            .addAction(android.R.drawable.ic_lock_silent_mode, "ZTIŠIT SIRÉNU", silence)
            .build();
        context.getSystemService(NotificationManager.class).notify(CRITICAL_NOTIFICATION_ID, notification);
    }

    static void cancelCriticalAlarm(Context context) {
        context.getSystemService(NotificationManager.class).cancel(CRITICAL_NOTIFICATION_ID);
    }

    private static Notification.Builder builder(Context context, String channel) {
        if (Build.VERSION.SDK_INT >= 26) return new Notification.Builder(context, channel);
        return new Notification.Builder(context);
    }

    private static String value(JSONObject object, String key, String unit, int decimals) {
        double value = number(object, key);
        if (Double.isNaN(value)) return "—";
        return String.format(Locale.US, "% ." + decimals + "f %s", value, unit).trim();
    }

    private static double number(JSONObject object, String key) {
        if (object == null || object.isNull(key)) return Double.NaN;
        double value = object.optDouble(key, Double.NaN);
        return Double.isFinite(value) ? value : Double.NaN;
    }
}
