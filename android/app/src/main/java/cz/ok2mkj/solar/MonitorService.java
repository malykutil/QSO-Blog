package cz.ok2mkj.solar;

import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MonitorService extends Service {
    static final String ACTION_SILENCE_ALARM = "cz.ok2mkj.solar.SILENCE_ALARM";
    static final String ACTION_RESET_ALARM = "cz.ok2mkj.solar.RESET_ALARM";
    private static final long POLL_INTERVAL_MS = 15_000L;
    private static final long HOUR_MS = 3_600_000L;
    private static final long OFFLINE_LIMIT_MS = 5 * 60_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private JSONObject latestPayload;
    private JSONObject latestTelemetry;
    private long lastSuccessfulPoll;
    private MediaPlayer siren;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private int originalAlarmVolume = -1;
    private PowerManager.WakeLock alarmWakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        preferences = getSharedPreferences("solar_monitor", MODE_PRIVATE);
        lastSuccessfulPoll = preferences.getLong("last_successful_poll", System.currentTimeMillis());
        if (!preferences.contains("next_summary_at")) {
            long now = System.currentTimeMillis();
            preferences.edit().putLong("next_summary_at", ((now / HOUR_MS) + 1) * HOUR_MS).apply();
        }
        NotificationHelper.createChannels(this);
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NotificationHelper.MONITOR_NOTIFICATION_ID,
                NotificationHelper.monitorNotification(this, "Kontroluji systém každých 15 sekund"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NotificationHelper.MONITOR_NOTIFICATION_ID,
                NotificationHelper.monitorNotification(this, "Kontroluji systém každých 15 sekund"));
        }
        handler.post(this::poll);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_SILENCE_ALARM.equals(intent.getAction())) silenceCurrentAlarm();
        if (intent != null && ACTION_RESET_ALARM.equals(intent.getAction())) {
            executor.execute(this::requestAlarmReset);
        }
        return START_STICKY;
    }

    private void requestAlarmReset() {
        try {
            ApiClient.Response response = ApiClient.requestAuthenticated("/api/solar/alarm", "POST", null);
            if (response.code < 200 || response.code >= 300) {
                JSONObject result = response.body == null || response.body.isEmpty() ? new JSONObject() : new JSONObject(response.body);
                throw new IllegalStateException(result.optString("error", "Server reset poplachu odmítl (HTTP " + response.code + ")."));
            }
            // Server reset je pouze žádost; RPi ji musí potvrdit čerstvou hodnotou MQ-9.
            silenceCurrentAlarm();
            updateMonitorNotification("Čekám na potvrzení resetu MQ-9 z Raspberry Pi", latestPayload, latestTelemetry);
        } catch (Exception exception) {
            updateMonitorNotification("RESET POPLACHU SE NEZDAŘIL", latestPayload, latestTelemetry);
            NotificationHelper.postCriticalAlarm(
                this,
                "Reset poplachu se nezdařil",
                exception.getMessage() == null ? "Server reset poplachu odmítl." : exception.getMessage());
        }
    }

    private void poll() {
        executor.execute(() -> {
            try {
                ApiClient.Response response = ApiClient.request("/api/solar?range=1h&latest=1", "GET", null, null);
                if (response.code < 200 || response.code >= 300) throw new IllegalStateException("HTTP " + response.code);
                JSONObject payload = new JSONObject(response.body);
                latestPayload = payload;
                latestTelemetry = payload.optJSONObject("telemetry");
                lastSuccessfulPoll = System.currentTimeMillis();
                preferences.edit().putLong("last_successful_poll", lastSuccessfulPoll).apply();
                evaluateState(payload, latestTelemetry);
                maybePostHourlySummary(payload);
                updateMonitorNotification("Online • aktualizováno právě teď", payload, latestTelemetry);
            } catch (Exception exception) {
                long age = System.currentTimeMillis() - lastSuccessfulPoll;
                updateMonitorNotification(
                    age > OFFLINE_LIMIT_MS ? "VAROVÁNÍ • přes 5 minut bez nových dat" : "Čekám na spojení se serverem",
                    latestPayload,
                    latestTelemetry);
                if (age > OFFLINE_LIMIT_MS) activateAlarm("offline", "Dohled je bez spojení", "Telefon déle než 5 minut nezískal telemetrii. Zkontroluj internet, Raspberry Pi a napájení.");
            } finally {
                handler.postDelayed(this::poll, POLL_INTERVAL_MS);
            }
        });
    }

    private void evaluateState(JSONObject payload, JSONObject telemetry) {
        if (payload.optBoolean("alarmActive", false)) {
            activateAlarm("mq9", "POPLACH MQ-9", "Kritická koncentrace plynu nebo kouře. Všechna relé byla nouzově vypnuta. Nejdřív bezpečně zkontroluj objekt.");
            return;
        }
        if (telemetry == null || isTelemetryOffline(telemetry.optString("recorded_at", ""))) {
            activateAlarm("offline", "Řídicí jednotka je offline", "Telemetrie je starší než 5 minut. Zobrazené hodnoty nemusí odpovídat skutečnosti.");
            return;
        }
        double voltage = finite(telemetry, "battery_voltage");
        if (!Double.isNaN(voltage) && voltage > 0.5 && voltage < 11.8) {
            activateAlarm("battery-low", "Nízké napětí baterie", String.format(Locale.US, "Naměřeno %.2f V. Kritická hranice je 11,8 V.", voltage));
            return;
        }
        double batteryTemperature = finite(telemetry, "battery_temperature");
        if (!Double.isNaN(batteryTemperature) && batteryTemperature > 50) {
            activateAlarm("battery-hot", "Vysoká teplota baterie", String.format(Locale.US, "Baterie má %.1f °C. Kritická hranice je 50 °C.", batteryTemperature));
            return;
        }
        clearAlarmState();
    }

    private void activateAlarm(String key, String title, String detail) {
        String previousKey = preferences.getString("active_alarm_key", "");
        boolean sameAlarmSilenced = key.equals(previousKey) && preferences.getBoolean("alarm_silenced", false);
        if (!key.equals(previousKey)) {
            NotificationHelper.cancelCriticalAlarm(this);
            preferences.edit().putString("active_alarm_key", key).putBoolean("alarm_silenced", false).apply();
        }
        if (sameAlarmSilenced) return;
        NotificationHelper.postCriticalAlarm(this, title, detail);
        startSiren();
    }

    private void clearAlarmState() {
        if (!preferences.getString("active_alarm_key", "").isEmpty()) {
            preferences.edit().remove("active_alarm_key").putBoolean("alarm_silenced", false).apply();
            stopSiren();
            NotificationHelper.cancelCriticalAlarm(this);
        }
    }

    private void silenceCurrentAlarm() {
        preferences.edit().putBoolean("alarm_silenced", true).apply();
        stopSiren();
    }

    private void startSiren() {
        if (siren != null && siren.isPlaying()) return;
        try {
            audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
            originalAlarmVolume = audioManager.getStreamVolume(AudioManager.STREAM_ALARM);
            int maximum = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, maximum, 0);
            if (Build.VERSION.SDK_INT >= 26) {
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    .setOnAudioFocusChangeListener(change -> {})
                    .build();
                audioManager.requestAudioFocus(audioFocusRequest);
            } else {
                audioManager.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            }
            Uri alarmUri = Settings.System.DEFAULT_ALARM_ALERT_URI;
            siren = new MediaPlayer();
            siren.setDataSource(this, alarmUri);
            siren.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            siren.setLooping(true);
            siren.prepare();
            siren.start();
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            alarmWakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ok2mkj:critical-alarm");
            alarmWakeLock.acquire(10 * 60_000L);
        } catch (Exception ignored) {
            stopSiren();
        }
    }

    private void stopSiren() {
        if (siren != null) {
            try { siren.stop(); } catch (Exception ignored) {}
            siren.release();
            siren = null;
        }
        if (audioManager != null) {
            if (originalAlarmVolume >= 0) audioManager.setStreamVolume(AudioManager.STREAM_ALARM, originalAlarmVolume, 0);
            if (Build.VERSION.SDK_INT >= 26 && audioFocusRequest != null) audioManager.abandonAudioFocusRequest(audioFocusRequest);
            else audioManager.abandonAudioFocus(null);
        }
        originalAlarmVolume = -1;
        if (alarmWakeLock != null && alarmWakeLock.isHeld()) alarmWakeLock.release();
        alarmWakeLock = null;
    }

    private void maybePostHourlySummary(JSONObject payload) {
        long now = System.currentTimeMillis();
        long nextSummary = preferences.getLong("next_summary_at", now + HOUR_MS);
        if (now < nextSummary || latestTelemetry == null) return;
        NotificationHelper.postHourlySummary(this, payload, latestTelemetry);
        preferences.edit().putLong("next_summary_at", ((now / HOUR_MS) + 1) * HOUR_MS).apply();
    }

    private void updateMonitorNotification(String text, JSONObject payload, JSONObject telemetry) {
        getSystemService(NotificationManager.class).notify(
            NotificationHelper.MONITOR_NOTIFICATION_ID,
            NotificationHelper.monitorNotification(this, text, payload, telemetry));
    }

    private static boolean isTelemetryOffline(String timestamp) {
        if (timestamp == null || timestamp.length() < 19) return true;
        try {
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            format.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date parsed = format.parse(timestamp.substring(0, 19));
            return parsed == null || System.currentTimeMillis() - parsed.getTime() > OFFLINE_LIMIT_MS;
        } catch (Exception exception) {
            return true;
        }
    }

    private static double finite(JSONObject object, String key) {
        if (object == null || object.isNull(key)) return Double.NaN;
        double value = object.optDouble(key, Double.NaN);
        return Double.isFinite(value) ? value : Double.NaN;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        executor.shutdownNow();
        stopSiren();
        super.onDestroy();
    }
}
