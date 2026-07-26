#include <Arduino.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <WiFi.h>
#include <XPT2046_Touchscreen.h>
#include <esp_task_wdt.h>
#include <time.h>

#include "secrets.h"

TFT_eSPI tft;
SPIClass touchSPI(HSPI);
XPT2046_Touchscreen touch(33, 36);
Preferences preferences;
bool fontsReady = false;
bool fontLoaded = false;

void useSmallFont() { if (fontLoaded) { tft.unloadFont(); fontLoaded = false; } tft.setTextFont(2); tft.setTextSize(1); }
void useLargeFont() { if (fontLoaded) { tft.unloadFont(); fontLoaded = false; } tft.setTextFont(4); tft.setTextSize(1); }

constexpr int TOUCH_IRQ = 36;
constexpr int BACKLIGHT_PIN = 21;
constexpr int LIGHT_SENSOR_PIN = 34;
constexpr int BACKLIGHT_CHANNEL = 0;
constexpr uint16_t NAV_Y = 286;
constexpr uint16_t BG = 0x1082;
constexpr uint16_t PANEL = 0x18E5;
constexpr uint16_t TEXT = 0xE7F7;
constexpr uint16_t MUTED = 0x8CB2;
constexpr uint16_t GREEN = 0x56D0;
constexpr uint16_t AMBER = 0xFD40;
constexpr uint16_t BLUE = 0x65BF;
constexpr uint16_t RED = 0xF986;

struct Telemetry { float batteryVoltage = NAN, batteryCurrent = NAN, solar1Power = NAN, solar2Power = NAN, solar1Current = NAN, solar2Current = NAN, loadPower = NAN, batteryTemp = NAN, objectTemp = NAN, outsideTemp = NAN, mpptTemp = NAN, objectHumidity = NAN; int solarEnergy = 0; String recordedAt; } telemetry;
struct Forecast { float min = NAN, max = NAN, estimatedKwh = NAN; int weatherCode = -1; bool valid = false; } forecast;
bool relays[6] = {false, false, false, false, false, false};
const char* relayNames[6] = {"solar1", "solar2", "battery", "bufik", "fan12v", "fan24v"};
uint8_t screen = 0;
uint32_t lastFetch = 0;
uint32_t lastInteraction = 0;
uint32_t lastBrightnessUpdate = 0;
uint8_t currentBrightness = 255;
uint32_t lastDataSuccess = 0;
uint32_t bootMillis = 0;
uint32_t apiErrors = 0;
uint32_t lastApiError = 0;
bool offlineMode = true;
bool hasTelemetry = false;
bool otaInProgress = false;
uint8_t otaPercent = 0;
bool touchDown = false;
bool touchHandled = false;
uint32_t touchStarted = 0;
int touchedRelay = -1;
String notice = "Pripojuji WiFi...";

float number(JsonVariantConst value) { return value.isNull() ? NAN : value.as<float>(); }
String watts(float value) { return isnan(value) ? "--" : String(value, 0) + " W"; }
String volts(float value) { return isnan(value) ? "--" : String(value, 1) + " V"; }
String amps(float value) { return isnan(value) ? "--" : String(value, 2) + " A"; }
String celsius(float value) { return isnan(value) ? "--" : String(value, 1) + " C"; }
String measurementTime() { return telemetry.recordedAt.length() >= 16 ? "RPi " + telemetry.recordedAt.substring(11, 16) + " UTC" : "RPi --:--"; }
String dataAge() { if (!hasTelemetry || lastDataSuccess == 0) return "data --"; uint32_t seconds = (millis() - lastDataSuccess) / 1000; if (seconds < 60) return "data " + String(seconds) + " s"; return "data " + String(seconds / 60) + " min"; }
bool isNight() { struct tm timeinfo; if (!getLocalTime(&timeinfo, 10)) return false; return timeinfo.tm_hour >= 22 || timeinfo.tm_hour < 7; }
String rssiText() { return WiFi.status() == WL_CONNECTED ? "WiFi " + String(WiFi.RSSI()) + " dBm" : "WiFi offline"; }
void openPreferences() { static bool opened = false; if (!opened) { preferences.begin("solar", false); opened = true; } }
void saveTelemetry() { openPreferences(); preferences.putBool("valid", true); preferences.putFloat("obj", telemetry.objectTemp); preferences.putFloat("hum", telemetry.objectHumidity); preferences.putFloat("bat", telemetry.batteryTemp); preferences.putFloat("out", telemetry.outsideTemp); preferences.putFloat("mppt", telemetry.mpptTemp); preferences.putFloat("s1a", telemetry.solar1Current); preferences.putFloat("s2a", telemetry.solar2Current); preferences.putFloat("bvol", telemetry.batteryVoltage); preferences.putFloat("bcur", telemetry.batteryCurrent); preferences.putFloat("s1p", telemetry.solar1Power); preferences.putFloat("s2p", telemetry.solar2Power); preferences.putFloat("loadp", telemetry.loadPower); preferences.putInt("energy", telemetry.solarEnergy); preferences.putString("recorded", telemetry.recordedAt); }
void loadTelemetry() { openPreferences(); if (!preferences.getBool("valid", false)) return; telemetry.objectTemp = preferences.getFloat("obj", NAN); telemetry.objectHumidity = preferences.getFloat("hum", NAN); telemetry.batteryTemp = preferences.getFloat("bat", NAN); telemetry.outsideTemp = preferences.getFloat("out", NAN); telemetry.mpptTemp = preferences.getFloat("mppt", NAN); telemetry.solar1Current = preferences.getFloat("s1a", NAN); telemetry.solar2Current = preferences.getFloat("s2a", NAN); telemetry.batteryVoltage = preferences.getFloat("bvol", NAN); telemetry.batteryCurrent = preferences.getFloat("bcur", NAN); telemetry.solar1Power = preferences.getFloat("s1p", NAN); telemetry.solar2Power = preferences.getFloat("s2p", NAN); telemetry.loadPower = preferences.getFloat("loadp", NAN); telemetry.solarEnergy = preferences.getInt("energy", 0); telemetry.recordedAt = preferences.getString("recorded", ""); hasTelemetry = true; notice = "NVS cache"; }
void setBacklight(uint8_t value) { currentBrightness = value; ledcWrite(BACKLIGHT_CHANNEL, value); }
void updateBacklight() { static bool initialized = false; if (!initialized) { ledcSetup(BACKLIGHT_CHANNEL, 5000, 8); ledcAttachPin(BACKLIGHT_PIN, BACKLIGHT_CHANNEL); analogReadResolution(12); initialized = true; } int raw = analogRead(LIGHT_SENSOR_PIN); int ambientBrightness = map(constrain(raw, 400, 3600), 3600, 400, 45, 255); ambientBrightness = constrain(ambientBrightness, 45, 255); bool dimmed = millis() - lastInteraction >= 300000; if (isNight()) ambientBrightness = min(ambientBrightness, 35); setBacklight(dimmed ? max(10, ambientBrightness / 5) : ambientBrightness); }
const char* weatherText(int code) { if (code == 0) return "jasno"; if (code <= 3) return "polojasno"; if (code <= 48) return "oblacno"; if (code <= 67) return "dest"; if (code <= 77) return "snih"; if (code <= 82) return "prehanky"; return "bourky"; }

void header(const char* title, const char* subtitle) {
  tft.fillScreen(BG);
  useSmallFont(); tft.setTextColor(TEXT, BG); tft.drawString(title, 14, 12);
  tft.setTextColor(MUTED, BG); tft.drawString(subtitle, 14, 34);
  tft.fillRect(180, 12, 10, 10, WiFi.status() == WL_CONNECTED ? GREEN : RED);
  tft.drawString(WiFi.status() == WL_CONNECTED ? String(WiFi.RSSI()) + " dBm" : "offline", 194, 14);
  tft.setTextColor(offlineMode ? AMBER : MUTED, BG); tft.drawString(dataAge(), 14, 45);
}

void drawOtaProgress() { tft.fillScreen(BG); useSmallFont(); tft.setTextColor(TEXT, BG); tft.drawString("OTA UPDATE", 14, 18); tft.setTextColor(MUTED, BG); tft.drawString("Neodpojujte napajeni", 14, 44); tft.drawRect(14, 110, 212, 20, TEXT); tft.fillRect(17, 113, (206 * otaPercent) / 100, 14, GREEN); tft.setTextColor(TEXT, BG); tft.drawCentreString(String(otaPercent) + " %", 120, 145, 2); }

void card(int x, int y, int w, int h, uint16_t color = PANEL) { tft.fillRoundRect(x, y, w, h, 10, color); }
void label(const char* text, int x, int y) { useSmallFont(); tft.setTextColor(MUTED, PANEL); tft.drawString(text, x, y); }
void valueText(String value, int x, int y, uint16_t color = TEXT) { useLargeFont(); tft.setTextColor(color, PANEL); tft.drawString(value, x, y); useSmallFont(); }

void nav() {
  tft.fillRect(0, NAV_Y, 240, 34, 0x0B1220);
  const char* items[3] = {"PŘEHLED", "ENERGIE", "OVLÁDÁNÍ"};
  useSmallFont(); for (int i = 0; i < 3; i++) { tft.setTextColor(i == screen ? GREEN : MUTED, 0x0B1220); tft.drawCentreString(items[i], 40 + i * 80, 299, 1); }
}

void drawOverview() {
  header("CHATA / ENERGIE", "prehled stanice");
  card(14, 54, 212, 62); label("TEPLOTA Z WEBU", 26, 68); valueText(celsius(telemetry.objectTemp), 26, 82, BLUE); useSmallFont(); tft.setTextColor(MUTED, PANEL); tft.drawString(measurementTime(), 132, 98);
  card(14, 124, 212, 62); label("PROUD PANELU", 26, 138); valueText(amps(telemetry.solar1Current + telemetry.solar2Current), 26, 152, AMBER);
  card(14, 194, 212, 70); label("DNESNI PREDPOVED", 26, 208);
  if (forecast.valid) {
    useSmallFont(); tft.setTextColor(TEXT, PANEL); tft.drawString(weatherText(forecast.weatherCode), 26, 226);
    tft.drawRightString(String(forecast.max, 0) + "/" + String(forecast.min, 0) + " C", 226, 224, 1);
    tft.setTextColor(GREEN, PANEL); tft.drawRightString("vyroba ~" + String(forecast.estimatedKwh, 1) + " kWh", 226, 244, 1);
  } else {
    tft.setTextColor(MUTED, PANEL); tft.drawString("predpoved neni dostupna", 26, 230);
  }
  nav();
}

void drawTemperatures() {
  header("TEPLOTY", "hodnoty z posledniho mereni RPi");
  card(14, 54, 212, 46); label("OBJEKT / RPi", 26, 66); valueText(celsius(telemetry.objectTemp), 26, 78, BLUE);
  card(14, 108, 212, 46); label("BATERIE", 26, 120); valueText(celsius(telemetry.batteryTemp), 26, 132, AMBER);
  card(14, 162, 212, 46); label("VENKU", 26, 174); valueText(celsius(telemetry.outsideTemp), 26, 186, GREEN);
  card(14, 216, 212, 46); label("MPPT", 26, 228); valueText(celsius(telemetry.mpptTemp), 26, 240, RED);
  useSmallFont(); tft.setTextColor(MUTED, BG); tft.drawString("Vlhkost objektu: " + (isnan(telemetry.objectHumidity) ? String("--") : String(telemetry.objectHumidity, 0) + " %"), 14, 268); tft.drawRightString(measurementTime(), 226, 268, 1);
  nav();
}

void drawDiagnostics() {
  header("DIAGNOSTIKA", "stav ESP32 a pripojeni");
  useSmallFont(); tft.setTextColor(TEXT, BG);
  tft.drawString("IP: " + WiFi.localIP().toString(), 14, 66);
  tft.drawString(rssiText(), 14, 88);
  tft.drawString("Heap: " + String(ESP.getFreeHeap() / 1024) + " kB", 14, 110);
  tft.drawString("Uptime: " + String((millis() - bootMillis) / 3600000) + " h " + String(((millis() - bootMillis) / 60000) % 60) + " min", 14, 132);
  tft.drawString("API chyby: " + String(apiErrors), 14, 154);
  tft.drawString("Posledni chyba: " + String(lastApiError ? lastApiError / 1000 : 0) + " s", 14, 176);
  tft.drawString(offlineMode ? "Rezim: OFFLINE / CACHE" : "Rezim: ONLINE", 14, 198);
  tft.drawString("Dotyk vlevo nahore = zpet", 14, 244); nav();
}

void drawOverviewLegacy() {
  header("CHATA / ENERGIE", "živý dohled solární stanice");
  card(14, 54, 100, 132); label("BATERIE", 24, 68);
  int level = isnan(telemetry.batteryVoltage) ? 0 : constrain((int)((telemetry.batteryVoltage - 11.0f) * 100.0f / 2.8f), 0, 100);
  tft.drawCircle(64, 124, 39, GREEN); tft.drawCircle(64, 124, 34, GREEN);
  useLargeFont(); tft.setTextColor(GREEN, PANEL); tft.drawCentreString(String(level) + "%", 64, 113, 4); useSmallFont();
  tft.setTextColor(MUTED, PANEL); tft.drawCentreString(volts(telemetry.batteryVoltage), 64, 151, 1);
  card(122, 54, 104, 62); label("VÝROBA", 132, 68); valueText(watts(telemetry.solar1Power + telemetry.solar2Power), 132, 81, AMBER);
  card(122, 124, 104, 62); label("SPOTŘEBA", 132, 138); valueText(watts(telemetry.loadPower), 132, 151, BLUE);
  nav();
}

void drawEnergy() {
  header("ENERGIE", "výkon a teploty");
  card(14, 54, 212, 58); label("PANELY", 26, 68); valueText(watts(telemetry.solar1Power), 26, 80, AMBER); valueText(watts(telemetry.solar2Power), 126, 80, AMBER);
  card(14, 120, 100, 66); label("DNEŠNÍ VÝROBA", 22, 134); valueText(String(telemetry.solarEnergy) + " Wh", 22, 149, GREEN);
  card(126, 120, 100, 66); label("BATERIE", 136, 134); valueText(volts(telemetry.batteryVoltage), 136, 149, TEXT);
  card(14, 200, 212, 1, BG);
  useSmallFont(); tft.setTextColor(MUTED, BG); tft.drawString("Teplota baterie", 14, 197); tft.setTextColor(TEXT, BG); tft.drawRightString(isnan(telemetry.batteryTemp) ? "--" : String(telemetry.batteryTemp, 1) + " °C", 226, 197, 2);
  nav();
}

void drawControl() {
  header("OVLÁDÁNÍ", "dotykem přepínáš výstupy");
  useSmallFont(); for (int i = 0; i < 6; i++) { int col = i % 2, row = i / 2; int x = 14 + col * 108, y = 54 + row * 48; uint16_t color = relays[i] ? 0x252E : PANEL; card(x, y, 100, 40, color); tft.setTextColor(relays[i] ? GREEN : TEXT, color); tft.drawString(relayNames[i], x + 8, y + 7); tft.fillCircle(x + 86, y + 20, 6, relays[i] ? GREEN : MUTED); }
  tft.setTextColor(MUTED, BG); tft.drawCentreString(notice.c_str(), 120, 220, 1); nav();
}

void drawScreen() { if (!hasTelemetry) loadTelemetry(); if (otaInProgress) { drawOtaProgress(); return; } if (screen == 0) drawOverview(); else if (screen == 1) drawEnergy(); else if (screen == 2) drawControl(); else if (screen == 3) drawTemperatures(); else drawDiagnostics(); }

bool apiRequest(const String& method, const String& body, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http; String endpoint = method == "GET" ? "/api/solar/latest" : "/api/solar/device"; http.begin(String(SOLAR_API_BASE) + endpoint); if (method != "GET") http.addHeader("Authorization", String("Bearer ") + SOLAR_DEVICE_TOKEN); http.addHeader("Content-Type", "application/json");
  int code = method == "GET" ? http.GET() : http.POST(body); response = http.getString(); http.end(); return code >= 200 && code < 300;
}

void fetchData() {
  String response; if (!apiRequest("GET", "", response)) { apiErrors++; lastApiError = millis(); offlineMode = true; notice = "API není dostupné"; drawScreen(); return; }
  JsonDocument filter; filter["telemetry"]["object_temperature"] = true; filter["telemetry"]["object_humidity"] = true; filter["telemetry"]["outside_temperature"] = true; filter["telemetry"]["mppt_temperature"] = true; filter["telemetry"]["solar1_current"] = true; filter["telemetry"]["solar2_current"] = true; filter["telemetry"]["battery_voltage"] = true; filter["telemetry"]["battery_current"] = true; filter["telemetry"]["solar1_power"] = true; filter["telemetry"]["solar2_power"] = true; filter["telemetry"]["load_power"] = true; filter["telemetry"]["battery_temperature"] = true; filter["telemetry"]["solar_energy_today_wh"] = true; filter["relays"] = true;
  JsonDocument doc; if (deserializeJson(doc, response, DeserializationOption::Filter(filter))) { apiErrors++; lastApiError = millis(); offlineMode = true; notice = "Chybná data"; drawScreen(); return; }
  JsonObject data = doc["telemetry"];
  telemetry.batteryVoltage = number(data["battery_voltage"]); telemetry.batteryCurrent = number(data["battery_current"]); telemetry.solar1Power = number(data["solar1_power"]); telemetry.solar2Power = number(data["solar2_power"]); telemetry.solar1Current = number(data["solar1_current"]); telemetry.solar2Current = number(data["solar2_current"]); telemetry.loadPower = number(data["load_power"]); telemetry.batteryTemp = number(data["battery_temperature"]); telemetry.objectTemp = number(data["object_temperature"]); telemetry.outsideTemp = number(data["outside_temperature"]); telemetry.mpptTemp = number(data["mppt_temperature"]); telemetry.objectHumidity = number(data["object_humidity"]); telemetry.solarEnergy = data["solar_energy_today_wh"] | 0; telemetry.recordedAt = data["recorded_at"] | "";
  JsonObject states = doc["relays"]; for (int i = 0; i < 6; i++) relays[i] = states[relayNames[i]] | false;
  hasTelemetry = true; lastDataSuccess = millis(); offlineMode = false; saveTelemetry(); notice = "Aktualizováno"; drawScreen();
}

void fetchWeather() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http; http.begin(String(SOLAR_API_BASE) + "/api/weather");
  int code = http.GET(); String response = http.getString(); http.end();
  if (code < 200 || code >= 300) return;
  JsonDocument doc; if (deserializeJson(doc, response)) return;
  JsonObject day = doc["daily"][0];
  forecast.min = number(day["min"]); forecast.max = number(day["max"]); forecast.estimatedKwh = number(day["estimatedKwh"]); forecast.weatherCode = day["weatherCode"] | -1; forecast.valid = !isnan(forecast.min) || !isnan(forecast.max);
}

void toggleRelay(int index) {
  String body = String("{\"relay\":\"") + relayNames[index] + "\",\"isOn\":" + (!relays[index] ? "true" : "false") + "}"; String response;
  if (apiRequest("POST", body, response)) { notice = "Overuji stav relé"; fetchData(); } else { notice = "Ovládání selhalo"; drawScreen(); }
}

void touchInput() {
  if (!touch.touched()) { touchDown = false; touchedRelay = -1; return; }
  lastInteraction = millis(); updateBacklight(); TS_Point p = touch.getPoint(); int x = constrain(map(p.x, 200, 3700, 0, 239), 0, 239); int y = constrain(map(p.y, 240, 3800, 0, 319), 0, 319);
  if (!touchDown) { touchDown = true; touchHandled = false; touchStarted = millis(); }
  if (y >= NAV_Y) { if (!touchHandled) { touchHandled = true; screen = constrain(x / 80, 0, 2); drawScreen(); } return; }
  if (screen == 0 && y >= 54 && y < 116) { if (!touchHandled) { touchHandled = true; screen = 3; drawScreen(); } return; }
  if (screen == 0 && x >= 170 && y < 54) { if (!touchHandled) { touchHandled = true; screen = 4; drawScreen(); } return; }
  if ((screen == 3 || screen == 4) && y < 54) { if (!touchHandled) { touchHandled = true; screen = 0; drawScreen(); } return; }
  if (screen == 2 && y >= 54 && y < 198) {
    int col = x < 120 ? 0 : 1; int row = (y - 54) / 48; int index = row * 2 + col; bool critical = index == 2 || index == 3;
    if (index < 6 && !touchHandled && (!critical || millis() - touchStarted > 1200)) { touchHandled = true; if (critical) notice = "Dlouhy stisk potvrzen"; toggleRelay(index); }
  }
}

void setupOTA() {
  configTzTime("CET-1CEST,M3.5.0,M10.5.0/3", "pool.ntp.org", "time.nist.gov");
  bootMillis = millis(); esp_task_wdt_init(10, true); esp_task_wdt_add(NULL); openPreferences(); loadTelemetry();
  ArduinoOTA.setHostname("qso-esp32-solar");
  ArduinoOTA.setPort(8266);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.onStart([]() { otaInProgress = true; otaPercent = 0; drawOtaProgress(); });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) { otaPercent = total ? (progress * 100U) / total : 0; drawOtaProgress(); });
  ArduinoOTA.onEnd([]() { otaPercent = 100; drawOtaProgress(); delay(300); otaInProgress = false; notice = "OTA hotovo"; drawScreen(); });
  ArduinoOTA.onError([](ota_error_t error) { notice = "OTA chyba"; drawScreen(); });
  ArduinoOTA.begin();
  Serial.printf("OTA pripraveno: %s:8266\n", WiFi.localIP().toString().c_str());
}

void setup() { Serial.begin(115200); pinMode(21, OUTPUT); digitalWrite(21, HIGH); tft.init(); tft.setRotation(0); touchSPI.begin(25, 39, 32, 33); touch.begin(touchSPI); touch.setRotation(0); if (!LittleFS.begin(true)) { notice = "LittleFS chyba"; drawScreen(); while (true) delay(1000); } if (!LittleFS.exists("/CzechSans15.vlw") || !LittleFS.exists("/CzechSans32.vlw")) { notice = "Chybi fonty"; drawScreen(); while (true) delay(1000); } fontsReady = true; useSmallFont(); drawScreen(); WiFi.setSleep(false); WiFi.setHostname("qso-esp32-solar"); WiFi.begin(WIFI_SSID, WIFI_PASSWORD); uint32_t start = millis(); while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) { delay(300); } if (WiFi.status() == WL_CONNECTED) { setupOTA(); notice = WiFi.localIP().toString(); } else notice = "WiFi se nepřipojilo"; drawScreen(); }
void loop() { esp_task_wdt_reset(); ArduinoOTA.handle(); touchInput(); if (hasTelemetry && lastDataSuccess && millis() - lastDataSuccess > 120000) offlineMode = true; if (millis() - lastBrightnessUpdate > 1000) { lastBrightnessUpdate = millis(); updateBacklight(); } if (millis() - lastFetch > 60000) { lastFetch = millis(); fetchData(); } static uint32_t lastWeatherFetch = 0; if (lastWeatherFetch == 0 || millis() - lastWeatherFetch > 30000) { lastWeatherFetch = millis(); fetchWeather(); drawScreen(); } delay(20); }
