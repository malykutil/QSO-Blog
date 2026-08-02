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

import java.util.Iterator;
import java.util.Locale;

final class NotificationHelper {
    static final String CHANNEL_MONITOR = "solar_monitor";
    static final String CHANNEL_SUMMARY = "solar_hourly";
    static final String CHANNEL_CRITICAL = "solar_critical_v2";
    static final int MONITOR_NOTIFICATION_ID = 100;
    static final int SUMMARY_NOTIFICATION_ID = 200;
    static final int RESET_NOTIFICATION_ID = 201;
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
        critical.setDescription("Požár, plyn, vysoká teplota baterie nebo nízké napětí");
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
        return monitorNotification(context, status, null, null);
    }

    static Notification monitorNotification(Context context, String status, JSONObject payload, JSONObject telemetry) {
        Intent open = new Intent(context, MainActivity.class);
        PendingIntent pendingOpen = PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        boolean alarm = alarmActive(payload, telemetry);
        boolean online = status.startsWith("Online");
        String system = (alarm ? "POPLACH" : "Bez poplachu") + " • " + relayStatus(payload);
        String battery = "Baterie " + value(telemetry, "battery_voltage", "V", 2)
            + " • " + value(telemetry, "battery_current", "A", 2)
            + " • " + value(telemetry, "battery_power_w", "W", 1)
            + " • " + batteryState(telemetry);
        String load = "Zátěž " + valueAny(telemetry, "V", 2, "load_voltage_v", "solar2_voltage")
            + " • " + valueAny(telemetry, "A", 2, "load_current_a", "solar2_current")
            + " • " + valueAny(telemetry, "W", 1, "load_power_w", "load_power");
        String temperatures = "Teploty: objekt " + value(telemetry, "object_temperature", "°C", 1)
            + " • baterie " + value(telemetry, "battery_temperature", "°C", 1)
            + " • MPPT " + value(telemetry, "mppt_temperature", "°C", 1);
        String air = "MQ-9 " + value(telemetry, "mq9_raw", "RAW", 0) + (alarm ? " • KRITICKÝ STAV" : " • v pořádku");
        String ups = "UPS " + value(telemetry, "ups_charge_percent", "%", 0)
            + " • " + value(telemetry, "ups_current_a", "A", 3)
            + " • " + upsState(telemetry);

        Notification.InboxStyle style = new Notification.InboxStyle()
            .setBigContentTitle(alarm ? "OK2KZB • AKTIVNÍ POPLACH" : "OK2KZB • aktuální stav")
            .addLine(status)
            .addLine(system);
        if (telemetry != null) {
            style.addLine(battery).addLine(load).addLine(temperatures).addLine(air).addLine(ups);
        }

        String compact = telemetry == null || !online
            ? status
            : (alarm ? "POPLACH" : "Bez poplachu") + " • baterie "
                + value(telemetry, "battery_current", "A", 2) + " • zátěž "
                + valueAny(telemetry, "W", 1, "load_power_w", "load_power");
        return builder(context, CHANNEL_MONITOR)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setColor(alarm ? Color.RED : online ? Color.rgb(34, 197, 94) : Color.rgb(245, 158, 11))
            .setContentTitle(alarm ? "OK2KZB • POPLACH" : online ? "OK2KZB • systém online" : "OK2KZB • čekám na spojení")
            .setContentText(compact)
            .setSubText(status)
            .setStyle(style)
            .setContentIntent(pendingOpen)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .build();
    }

    static void postHourlySummary(Context context, JSONObject payload, JSONObject telemetry) {
        boolean alarm = alarmActive(payload, telemetry);
        String system = (alarm ? "POPLACH AKTIVNÍ" : "Systém bez poplachu") + " • " + relayStatus(payload)
            + " • MQ-9 " + value(telemetry, "mq9_raw", "RAW", 0);
        String temperatures = String.format(Locale.US, "Objekt %s • Baterie %s • MPPT %s • Venku %s",
            value(telemetry, "object_temperature", "°C", 1),
            value(telemetry, "battery_temperature", "°C", 1),
            value(telemetry, "mppt_temperature", "°C", 1),
            value(telemetry, "outside_temperature", "°C", 1));
        String humidity = "Vlhkost: objekt " + value(telemetry, "object_humidity", "%", 1)
            + " • MPPT " + value(telemetry, "mppt_humidity", "%", 1);
        String solar = "Solární vstup " + value(telemetry, "solar1_current", "A", 2);
        String batteryState = batteryState(telemetry);
        String battery = "Baterie " + value(telemetry, "battery_voltage", "V", 2)
            + " • " + value(telemetry, "battery_current", "A", 2)
            + " • " + value(telemetry, "battery_power_w", "W", 1)
            + " • " + batteryState;
        String load = "Zátěž " + valueAny(telemetry, "V", 2, "load_voltage_v", "solar2_voltage")
            + " • " + valueAny(telemetry, "A", 2, "load_current_a", "solar2_current")
            + " • " + valueAny(telemetry, "W", 1, "load_power_w", "load_power");
        String ups = "UPS " + value(telemetry, "ups_charge_percent", "%", 0)
            + " • " + value(telemetry, "ups_current_a", "A", 3)
            + " • " + upsState(telemetry);

        Notification.InboxStyle style = new Notification.InboxStyle()
            .setBigContentTitle("Hodinový souhrn solárního systému")
            .addLine(system)
            .addLine(temperatures)
            .addLine(humidity)
            .addLine(solar)
            .addLine(battery)
            .addLine(load)
            .addLine(ups);
        PendingIntent open = PendingIntent.getActivity(context, 2, new Intent(context, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = builder(context, CHANNEL_SUMMARY)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setColor(alarm ? Color.RED : Color.rgb(34, 197, 94))
            .setContentTitle(alarm ? "Solární souhrn • POPLACH" : "Solární souhrn • " + batteryState)
            .setContentText(system)
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

    static void postResetSuccess(Context context) {
        Intent open = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingOpen = PendingIntent.getActivity(
            context,
            6,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = builder(context, CHANNEL_SUMMARY)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setColor(Color.rgb(34, 197, 94))
            .setContentTitle("Poplach vypnut")
            .setContentText("Raspberry Pi potvrdilo bezpečný stav. Relé jsou odblokovaná pro ruční ovládání.")
            .setStyle(new Notification.BigTextStyle().bigText(
                "Raspberry Pi potvrdilo bezpečnou hodnotu MQ-9. Krizový stav byl ukončen a relé jsou znovu odblokovaná. Všechna zůstávají vypnutá, dokud je ručně nezapneš."))
            .setContentIntent(pendingOpen)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_STATUS)
            .build();
        context.getSystemService(NotificationManager.class).notify(RESET_NOTIFICATION_ID, notification);
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

    private static String valueAny(JSONObject object, String unit, int decimals, String... keys) {
        for (String key : keys) {
            double value = number(object, key);
            if (!Double.isNaN(value)) return String.format(Locale.US, "% ." + decimals + "f %s", value, unit).trim();
        }
        return "—";
    }

    private static String batteryState(JSONObject telemetry) {
        double current = number(telemetry, "battery_current");
        return Double.isNaN(current) ? "neznámý stav" : current > 0.1 ? "nabíjení" : current < -0.1 ? "vybíjení" : "klid";
    }

    private static String upsState(JSONObject telemetry) {
        String state = telemetry == null ? "" : telemetry.optString("ups_state", "");
        if ("charging".equals(state)) return "nabíjení";
        if ("discharging".equals(state)) return "vybíjení";
        if ("idle".equals(state)) return "klid";
        return "neznámý stav";
    }

    private static boolean alarmActive(JSONObject payload, JSONObject telemetry) {
        return (payload != null && payload.optBoolean("alarmActive", false))
            || (telemetry != null && telemetry.optBoolean("mq9_alarm", false));
    }

    private static String relayStatus(JSONObject payload) {
        JSONObject relays = payload == null ? null : payload.optJSONObject("relays");
        if (relays == null) return "stav relé neznámý";
        int active = 0;
        int total = 0;
        Iterator<String> keys = relays.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            total++;
            if (relays.optBoolean(key, false)) active++;
        }
        return active + "/" + total + " relé zapnuto";
    }

    private static double number(JSONObject object, String key) {
        if (object == null || object.isNull(key)) return Double.NaN;
        double value = object.optDouble(key, Double.NaN);
        return Double.isFinite(value) ? value : Double.NaN;
    }
}
