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
#include <esp_heap_caps.h>
#include <time.h>

#include "secrets.h"

TFT_eSPI tft;
SPIClass touchSPI(HSPI);
XPT2046_Touchscreen touch(33, 36);
Preferences preferences;
bool fontsReady = false;
bool fontLoaded = false;

void useSmallFont() { if (fontLoaded) { tft.unloadFont(); fontLoaded = false; } tft.loadFont("CzechSans15", LittleFS); fontLoaded = true; }
void useLargeFont() { if (fontLoaded) { tft.unloadFont(); fontLoaded = false; } tft.loadFont("CzechSans32", LittleFS); fontLoaded = true; }

constexpr int TOUCH_IRQ = 36;
constexpr int BACKLIGHT_PIN = 21;
constexpr int LIGHT_SENSOR_PIN = 34;
constexpr int BACKLIGHT_CHANNEL = 0;
constexpr int SCREEN_WIDTH = 320;
constexpr int SCREEN_HEIGHT = 240;
constexpr int SAFE_EDGE = 5;
constexpr int STATUS_Y = SAFE_EDGE;
constexpr int STATUS_H = 25;
constexpr int CONTENT_Y = 31;
constexpr int CONTENT_BOTTOM = 195;
constexpr int NAV_Y = 196;
constexpr int NAV_H = 39;
constexpr int MIN_GAP = 4;
constexpr int BUTTON_MIN_H = 35;
constexpr uint16_t BG = 0x1082;
constexpr uint16_t PANEL = 0x18E5;
constexpr uint16_t TEXT = 0xE7F7;
constexpr uint16_t MUTED = 0x8CB2;
constexpr uint16_t GREEN = 0x56D0;
constexpr uint16_t AMBER = 0xFD40;
constexpr uint16_t BLUE = 0x65BF;
constexpr uint16_t RED = 0xF986;
constexpr uint16_t NAV_BG = 0x1220;

struct UiRect { int x; int y; int w; int h; };
constexpr UiRect RECT_OVERVIEW_TEMP = {5, 36, 154, 70};
constexpr UiRect RECT_OVERVIEW_POWER = {165, 36, 150, 70};
constexpr UiRect RECT_OVERVIEW_WEATHER = {5, 110, 310, 80};
constexpr UiRect RECT_ENERGY_PANELS = {5, 36, 310, 48};
constexpr UiRect RECT_ENERGY_BATTERY = {5, 88, 150, 68};
constexpr UiRect RECT_ENERGY_TODAY = {165, 88, 150, 68};
constexpr UiRect RECT_ENERGY_TEMP = {5, 160, 310, 30};
constexpr UiRect RECT_TEMP_0 = {5, 36, 150, 46};
constexpr UiRect RECT_TEMP_1 = {165, 36, 150, 46};
constexpr UiRect RECT_TEMP_2 = {5, 86, 150, 46};
constexpr UiRect RECT_TEMP_3 = {165, 86, 150, 46};
constexpr UiRect RECT_TEMP_EXTRA = {5, 140, 310, 50};
constexpr UiRect RECT_DIAG_0 = {5, 36, 150, 74};
constexpr UiRect RECT_DIAG_1 = {165, 36, 150, 74};
constexpr UiRect RECT_DIAG_2 = {5, 114, 150, 74};
constexpr UiRect RECT_DIAG_3 = {165, 114, 150, 74};
constexpr UiRect RECT_RELAY_0 = {5, 36, 98, 72};
constexpr UiRect RECT_RELAY_1 = {111, 36, 98, 72};
constexpr UiRect RECT_RELAY_2 = {217, 36, 98, 72};
constexpr UiRect RECT_RELAY_3 = {5, 110, 98, 66};
constexpr UiRect RECT_RELAY_4 = {111, 110, 98, 66};
constexpr UiRect RECT_RELAY_5 = {217, 110, 98, 66};
constexpr UiRect RECT_NAV_0 = {5, 196, 99, 39};
constexpr UiRect RECT_NAV_1 = {110, 196, 100, 39};
constexpr UiRect RECT_NAV_2 = {216, 196, 99, 39};
constexpr UiRect RECT_OTA_TITLE = {5, 45, 310, 30};
constexpr UiRect RECT_OTA_SUBTITLE = {5, 78, 310, 20};
constexpr UiRect RECT_OTA_BAR = {35, 115, 250, 22};
constexpr UiRect RECT_OTA_PERCENT = {5, 145, 310, 25};
constexpr UiRect RECT_OVERVIEW_TEMP_VALUE = {10, 58, 144, 42};
constexpr UiRect RECT_OVERVIEW_POWER_VALUE = {170, 58, 140, 42};
constexpr UiRect RECT_ENERGY_S1_VALUE = {10, 52, 145, 28};
constexpr UiRect RECT_ENERGY_S2_VALUE = {165, 52, 145, 28};
constexpr UiRect RECT_ENERGY_BATTERY_VALUE = {10, 104, 140, 40};
constexpr UiRect RECT_ENERGY_TODAY_VALUE = {170, 104, 140, 40};
constexpr UiRect RECT_EMERGENCY_TITLE = {5, 58, 310, 42};
constexpr UiRect RECT_EMERGENCY_STATUS = {5, 112, 310, 22};
constexpr UiRect RECT_EMERGENCY_HELP = {5, 145, 310, 20};
constexpr UiRect RECT_EMERGENCY_YES = {45, 125, 105, 50};
constexpr UiRect RECT_EMERGENCY_NO = {170, 125, 105, 50};
constexpr UiRect RECT_RELAY_NOTICE = {5, 180, 310, 15};

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
int lastHttpCode = 0;
uint32_t cpuWindowStarted = 0;
uint32_t cpuBusyMillis = 0;
uint8_t cpuLoadPercent = 0;
bool offlineMode = true;
bool hasTelemetry = false;
bool otaInProgress = false;
uint8_t otaPercent = 0;
bool touchDown = false;
bool touchHandled = false;
uint32_t touchStarted = 0;
int touchedRelay = -1;
bool emergencyBlink = false;
bool emergencyPrompt = false;
bool emergencyLongPressHandled = false;
bool emergencyBlinkPhase = false;
uint32_t lastEmergencyBlink = 0;
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
String ramText() { uint32_t total = ESP.getHeapSize(); uint32_t free = ESP.getFreeHeap(); uint32_t used = total > free ? total - free : 0; uint8_t percent = total ? (uint8_t)constrain((used * 100UL) / total, 0UL, 100UL) : 0; return String(used / 1024) + "/" + String(total / 1024) + " kB (" + String(percent) + " %)"; }
void updateCpuLoad(uint32_t loopStarted) { if (cpuWindowStarted == 0) cpuWindowStarted = loopStarted; cpuBusyMillis += millis() - loopStarted; uint32_t elapsed = millis() - cpuWindowStarted; if (elapsed >= 1000) { uint32_t denominator = elapsed == 0 ? 1U : elapsed; cpuLoadPercent = (uint8_t)constrain((cpuBusyMillis * 100UL) / denominator, 0UL, 100UL); cpuBusyMillis = 0; cpuWindowStarted = millis(); } }
void openPreferences() { static bool opened = false; if (!opened) { preferences.begin("solar", false); opened = true; } }
void saveTelemetry() { openPreferences(); preferences.putBool("valid", true); preferences.putFloat("obj", telemetry.objectTemp); preferences.putFloat("hum", telemetry.objectHumidity); preferences.putFloat("bat", telemetry.batteryTemp); preferences.putFloat("out", telemetry.outsideTemp); preferences.putFloat("mppt", telemetry.mpptTemp); preferences.putFloat("s1a", telemetry.solar1Current); preferences.putFloat("s2a", telemetry.solar2Current); preferences.putFloat("bvol", telemetry.batteryVoltage); preferences.putFloat("bcur", telemetry.batteryCurrent); preferences.putFloat("s1p", telemetry.solar1Power); preferences.putFloat("s2p", telemetry.solar2Power); preferences.putFloat("loadp", telemetry.loadPower); preferences.putInt("energy", telemetry.solarEnergy); preferences.putString("recorded", telemetry.recordedAt); }
void loadTelemetry() { openPreferences(); if (!preferences.getBool("valid", false)) return; telemetry.objectTemp = preferences.getFloat("obj", NAN); telemetry.objectHumidity = preferences.getFloat("hum", NAN); telemetry.batteryTemp = preferences.getFloat("bat", NAN); telemetry.outsideTemp = preferences.getFloat("out", NAN); telemetry.mpptTemp = preferences.getFloat("mppt", NAN); telemetry.solar1Current = preferences.getFloat("s1a", NAN); telemetry.solar2Current = preferences.getFloat("s2a", NAN); telemetry.batteryVoltage = preferences.getFloat("bvol", NAN); telemetry.batteryCurrent = preferences.getFloat("bcur", NAN); telemetry.solar1Power = preferences.getFloat("s1p", NAN); telemetry.solar2Power = preferences.getFloat("s2p", NAN); telemetry.loadPower = preferences.getFloat("loadp", NAN); telemetry.solarEnergy = preferences.getInt("energy", 0); telemetry.recordedAt = preferences.getString("recorded", ""); hasTelemetry = true; notice = "NVS cache"; }
void setBacklight(uint8_t value) { currentBrightness = value; ledcWrite(BACKLIGHT_CHANNEL, value); }
void updateBacklight() { static bool initialized = false; if (!initialized) { ledcSetup(BACKLIGHT_CHANNEL, 5000, 8); ledcAttachPin(BACKLIGHT_PIN, BACKLIGHT_CHANNEL); analogReadResolution(12); initialized = true; } int raw = analogRead(LIGHT_SENSOR_PIN); int ambientBrightness = map(constrain(raw, 400, 3600), 3600, 400, 45, 255); ambientBrightness = constrain(ambientBrightness, 45, 255); bool dimmed = millis() - lastInteraction >= 300000; if (isNight()) ambientBrightness = min(ambientBrightness, 35); setBacklight(dimmed ? max(10, ambientBrightness / 5) : ambientBrightness); }
const char* weatherText(int code) { if (code == 0) return "jasno"; if (code <= 3) return "polojasno"; if (code <= 48) return "oblacno"; if (code <= 67) return "dest"; if (code <= 77) return "snih"; if (code <= 82) return "prehanky"; return "bourky"; }

void drawTextFit(String text, int x, int y, int maxWidth, uint16_t color, uint16_t background = BG) {
  useSmallFont();
  while (text.length() > 1 && tft.textWidth(text) > maxWidth) text.remove(text.length() - 1);
  tft.setTextColor(color, background); tft.drawString(text, x, y);
}

void drawCenteredText(String text, const UiRect& area, uint16_t color, uint16_t background = BG) {
  useSmallFont();
  while (text.length() > 1 && tft.textWidth(text) > area.w - MIN_GAP * 2) text.remove(text.length() - 1);
  tft.setTextColor(color, background); tft.drawString(text, area.x + (area.w - tft.textWidth(text)) / 2, area.y + (area.h - 15) / 2);
}

void drawRightText(String text, const UiRect& area, uint16_t color, uint16_t background = BG) {
  useSmallFont();
  while (text.length() > 1 && tft.textWidth(text) > area.w - MIN_GAP * 2) text.remove(text.length() - 1);
  tft.setTextColor(color, background); tft.drawString(text, area.x + area.w - MIN_GAP - tft.textWidth(text), area.y + (area.h - 15) / 2);
}

void drawValueUnit(String text, const UiRect& area, uint16_t color, uint16_t background = PANEL) {
  int split = text.lastIndexOf(' '); String numberPart = split > 0 ? text.substring(0, split) : text; String unitPart = split > 0 ? text.substring(split + 1) : "";
  useLargeFont(); int numberWidth = tft.textWidth(numberPart); useSmallFont(); int unitWidth = unitPart.length() ? tft.textWidth(unitPart) + MIN_GAP : 0;
  int totalWidth = numberWidth + unitWidth; int x = area.x + max(MIN_GAP, (area.w - totalWidth) / 2); int y = area.y + (area.h - 32) / 2;
  useLargeFont(); tft.setTextColor(color, background); tft.drawString(numberPart, x, y); if (unitPart.length()) { useSmallFont(); tft.setTextColor(color, background); tft.drawString(unitPart, x + numberWidth + MIN_GAP, y + 14); }
}

void header(const char* title, const char* subtitle) {
  tft.fillScreen(BG); drawTextFit(title, SAFE_EDGE, STATUS_Y + 2, 145, TEXT, BG);
  drawTextFit(subtitle, 155, STATUS_Y + 4, 120, MUTED, BG); tft.fillCircle(280, STATUS_Y + 11, 5, WiFi.status() == WL_CONNECTED ? GREEN : RED);
  drawRightText(WiFi.status() == WL_CONNECTED ? String(WiFi.RSSI()) : "off", {285, STATUS_Y, 30, STATUS_H}, MUTED, BG);
  tft.drawFastHLine(SAFE_EDGE, STATUS_Y + STATUS_H, SCREEN_WIDTH - SAFE_EDGE * 2, 0x2D5660);
}

void drawOtaProgress() { tft.fillScreen(BG); drawCenteredText("OTA UPDATE", RECT_OTA_TITLE, TEXT); drawCenteredText("Neodpojujte napajeni", RECT_OTA_SUBTITLE, MUTED); tft.drawRect(RECT_OTA_BAR.x, RECT_OTA_BAR.y, RECT_OTA_BAR.w, RECT_OTA_BAR.h, TEXT); tft.fillRect(RECT_OTA_BAR.x + 3, RECT_OTA_BAR.y + 3, (RECT_OTA_BAR.w - 6) * otaPercent / 100, RECT_OTA_BAR.h - 6, GREEN); drawCenteredText(String(otaPercent) + " %", RECT_OTA_PERCENT, TEXT); }

void card(const UiRect& area, uint16_t color = PANEL) { tft.fillRoundRect(area.x, area.y, area.w, area.h, 8, color); }
void label(const char* text, const UiRect& area) { drawTextFit(text, area.x + MIN_GAP, area.y + MIN_GAP, area.w - MIN_GAP * 2, MUTED, PANEL); }
void valueText(String value, const UiRect& area, uint16_t color = TEXT) { drawValueUnit(value, area, color, PANEL); }

void nav() {
  tft.fillRect(SAFE_EDGE, NAV_Y, SCREEN_WIDTH - SAFE_EDGE * 2, NAV_H, NAV_BG);
  const char* items[3] = {"PREHLED", "ENERGIE", "OVLADANI"};
  const UiRect areas[3] = {RECT_NAV_0, RECT_NAV_1, RECT_NAV_2};
  for (int i = 0; i < 3; i++) { drawCenteredText(items[i], areas[i], i == screen ? GREEN : MUTED, NAV_BG); }
}

#if 0
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
  card(10, 56, 106, 86); card(124, 56, 106, 86);
  card(10, 150, 106, 86); card(124, 150, 106, 86);
  useSmallFont(); tft.setTextColor(MUTED, PANEL); tft.drawString("WI-FI", 20, 68); tft.drawString("VYKON", 134, 68); tft.drawString("PAMET", 20, 162); tft.drawString("SYSTEM", 134, 162);
  tft.setTextColor(TEXT, PANEL); tft.drawString(WiFi.status() == WL_CONNECTED ? String(WiFi.RSSI()) + " dBm" : "offline", 20, 88); tft.drawString(String(cpuLoadPercent) + " %", 134, 88); tft.drawString(ramText(), 20, 182); tft.drawString(String((millis() - bootMillis) / 3600000) + " h " + String(((millis() - bootMillis) / 60000) % 60) + " min", 134, 182);
  tft.setTextColor(MUTED, PANEL); tft.drawString(WiFi.localIP().toString(), 20, 112); tft.drawString(String(getCpuFrequencyMhz()) + " MHz", 134, 112); tft.drawString("min " + String(ESP.getMinFreeHeap() / 1024) + " kB", 20, 206); tft.drawString(offlineMode ? "offline" : "online", 134, 206);
  tft.setTextColor(MUTED, BG); tft.drawString("API chyby: " + String(apiErrors) + " / HTTP " + String(lastHttpCode), 14, 252); tft.drawRightString("RAM volne " + String(ESP.getFreeHeap() / 1024) + " kB", 226, 252, 1); nav();
}

void drawOverviewLegacy() {
  header("CHATA / ENERGIE", "zivy dohled solarni stanice");
  card(14, 54, 100, 132); label("BATERIE", 24, 68);
  int level = isnan(telemetry.batteryVoltage) ? 0 : constrain((int)((telemetry.batteryVoltage - 11.0f) * 100.0f / 2.8f), 0, 100);
  tft.drawCircle(64, 124, 39, GREEN); tft.drawCircle(64, 124, 34, GREEN);
  useLargeFont(); tft.setTextColor(GREEN, PANEL); tft.drawCentreString(String(level) + "%", 64, 113, 4); useSmallFont();
  tft.setTextColor(MUTED, PANEL); tft.drawCentreString(volts(telemetry.batteryVoltage), 64, 151, 1);
  card(122, 54, 104, 62); label("VYROBA", 132, 68); valueText(watts(telemetry.solar1Power + telemetry.solar2Power), 132, 81, AMBER);
  card(122, 124, 104, 62); label("SPOTREBA", 132, 138); valueText(watts(telemetry.loadPower), 132, 151, BLUE);
  nav();
}

void drawEnergy() {
  header("ENERGIE", "vykon a teploty");
  card(14, 54, 212, 58); label("PANELY", 26, 68); valueText(watts(telemetry.solar1Power), 26, 80, AMBER); valueText(watts(telemetry.solar2Power), 126, 80, AMBER);
  card(14, 120, 100, 66); label("DNESNI VYROBA", 22, 134); valueText(String(telemetry.solarEnergy) + " Wh", 22, 149, GREEN);
  card(126, 120, 100, 66); label("BATERIE", 136, 134); valueText(volts(telemetry.batteryVoltage), 136, 149, TEXT);
  card(14, 200, 212, 1, BG);
  useSmallFont(); tft.setTextColor(MUTED, BG); tft.drawString("Teplota baterie", 14, 197); tft.setTextColor(TEXT, BG); tft.drawRightString(isnan(telemetry.batteryTemp) ? "--" : String(telemetry.batteryTemp, 1) + " °C", 226, 197, 2);
  nav();
}

void drawControl() {
  header("OVLADANI", "dotykem prepinat vystupy");
  useSmallFont(); for (int i = 0; i < 6; i++) { int col = i % 3, row = i / 3; int x = 8 + col * 77, y = 58 + row * 102; uint16_t color = relays[i] ? 0x252E : PANEL; card(x, y, 72, 88, color); tft.setTextColor(relays[i] ? GREEN : TEXT, color); tft.drawCentreString(relayNames[i], x + 36, y + 20, 1); tft.fillCircle(x + 36, y + 53, 13, relays[i] ? GREEN : MUTED); tft.setTextColor(relays[i] ? BG : TEXT, color); tft.drawCentreString(relays[i] ? "ON" : "OFF", x + 36, y + 49, 1); tft.setTextColor(MUTED, color); tft.drawCentreString((i == 2 || i == 3) ? "DRZET" : "KLIK", x + 36, y + 70, 1); }
  tft.setTextColor(MUTED, BG); tft.drawCentreString(notice.c_str(), 120, 270, 1); nav();
}
#endif

void drawOverviewScreen() {
  header("CHATA / ENERGIE", "prehled stanice"); card(RECT_OVERVIEW_TEMP); label("TEPLOTA WEB", RECT_OVERVIEW_TEMP); valueText(celsius(telemetry.objectTemp), RECT_OVERVIEW_TEMP_VALUE, BLUE); drawRightText(measurementTime(), {10, 96, 144, 10}, MUTED, PANEL);
  card(RECT_OVERVIEW_POWER); label("PROUD PANELU", RECT_OVERVIEW_POWER); valueText(amps(telemetry.solar1Current + telemetry.solar2Current), RECT_OVERVIEW_POWER_VALUE, AMBER);
  card(RECT_OVERVIEW_WEATHER); label("DNESNI PREDPOVED", RECT_OVERVIEW_WEATHER); if (forecast.valid) { drawTextFit(weatherText(forecast.weatherCode), 12, 136, 100, TEXT, PANEL); drawRightText(String(forecast.max, 0) + "/" + String(forecast.min, 0) + " C", {170, 130, 135, 24}, TEXT, PANEL); drawRightText("vyroba ~" + String(forecast.estimatedKwh, 1) + " kWh", {150, 158, 155, 24}, GREEN, PANEL); } else drawTextFit("predpoved neni dostupna", 12, 146, 290, MUTED, PANEL); nav();
}

void drawEnergyScreen() {
  header("ENERGIE", "vykon a teploty"); card(RECT_ENERGY_PANELS); label("PANELY", RECT_ENERGY_PANELS); valueText(watts(telemetry.solar1Power), RECT_ENERGY_S1_VALUE, AMBER); valueText(watts(telemetry.solar2Power), RECT_ENERGY_S2_VALUE, BLUE);
  card(RECT_ENERGY_BATTERY); label("BATERIE", RECT_ENERGY_BATTERY); valueText(volts(telemetry.batteryVoltage), RECT_ENERGY_BATTERY_VALUE, TEXT); card(RECT_ENERGY_TODAY); label("DNESNI VYROBA", RECT_ENERGY_TODAY); valueText(String(telemetry.solarEnergy) + " Wh", RECT_ENERGY_TODAY_VALUE, GREEN);
  drawTextFit("TEPLOTA BATERIE", RECT_ENERGY_TEMP.x, RECT_ENERGY_TEMP.y + 7, 150, MUTED); drawRightText(celsius(telemetry.batteryTemp), {165, RECT_ENERGY_TEMP.y, 150, RECT_ENERGY_TEMP.h}, TEXT); nav();
}

void drawTemperatureScreen() {
  header("TEPLOTY", "posledni mereni RPi"); const UiRect areas[4] = {RECT_TEMP_0, RECT_TEMP_1, RECT_TEMP_2, RECT_TEMP_3}; const char* labels[4] = {"OBJEKT", "BATERIE", "VENKU", "MPPT"}; String values[4] = {celsius(telemetry.objectTemp), celsius(telemetry.batteryTemp), celsius(telemetry.outsideTemp), celsius(telemetry.mpptTemp)}; uint16_t colors[4] = {BLUE, AMBER, GREEN, RED}; for (int i = 0; i < 4; i++) { card(areas[i]); label(labels[i], areas[i]); drawValueUnit(values[i], {areas[i].x + 4, areas[i].y + 15, areas[i].w - 8, 27}, colors[i], PANEL); }
  card(RECT_TEMP_EXTRA); drawTextFit("VLHKOST", 12, 150, 80, MUTED, PANEL); drawTextFit(isnan(telemetry.objectHumidity) ? "-- %" : String(telemetry.objectHumidity, 0) + " %", 12, 170, 80, TEXT, PANEL); drawRightText(measurementTime(), {160, 153, 145, 20}, MUTED, PANEL); nav();
}

void drawDiagnosticsScreen() {
  header("DIAGNOSTIKA", "stav ESP32 a pripojeni"); const UiRect areas[4] = {RECT_DIAG_0, RECT_DIAG_1, RECT_DIAG_2, RECT_DIAG_3}; for (const UiRect& area : areas) card(area);
  label("WI-FI", RECT_DIAG_0); drawTextFit(WiFi.status() == WL_CONNECTED ? String(WiFi.RSSI()) + " dBm" : "offline", 10, 62, 140, TEXT, PANEL); drawTextFit(WiFi.localIP().toString(), 10, 86, 140, MUTED, PANEL);
  label("VYKON", RECT_DIAG_1); drawTextFit(String(cpuLoadPercent) + " %", 170, 62, 140, TEXT, PANEL); drawTextFit(String(getCpuFrequencyMhz()) + " MHz", 170, 86, 140, MUTED, PANEL);
  label("PAMET", RECT_DIAG_2); drawTextFit(ramText(), 10, 140, 140, TEXT, PANEL); drawTextFit("min " + String(ESP.getMinFreeHeap() / 1024) + " kB", 10, 164, 140, MUTED, PANEL);
  label("SYSTEM", RECT_DIAG_3); drawTextFit(offlineMode ? "offline" : "online", 170, 140, 140, TEXT, PANEL); drawTextFit(String((millis() - bootMillis) / 3600000) + " h " + String(((millis() - bootMillis) / 60000) % 60) + " min", 170, 164, 140, MUTED, PANEL); nav();
}

void drawRelayScreen() {
  header("OVLADANI", "dotykem prepinat vystupy"); const UiRect areas[6] = {RECT_RELAY_0, RECT_RELAY_1, RECT_RELAY_2, RECT_RELAY_3, RECT_RELAY_4, RECT_RELAY_5}; for (int i = 0; i < 6; i++) { uint16_t color = relays[i] ? 0x252E : PANEL; card(areas[i], color); drawCenteredText(relayNames[i], {areas[i].x, areas[i].y + 4, areas[i].w, 20}, relays[i] ? GREEN : TEXT, color); tft.fillCircle(areas[i].x + areas[i].w / 2, areas[i].y + 38, 11, relays[i] ? GREEN : MUTED); drawCenteredText(relays[i] ? "ON" : "OFF", {areas[i].x + 10, areas[i].y + 27, areas[i].w - 20, 22}, relays[i] ? BG : TEXT, relays[i] ? GREEN : MUTED); drawCenteredText((i == 2 || i == 3) ? "DRZET" : "KLIK", {areas[i].x, areas[i].y + 47, areas[i].w, 15}, MUTED, color); } drawCenteredText(notice, RECT_RELAY_NOTICE, MUTED, BG); nav();
}

void drawEmergencyOverlay() {
  if (emergencyBlink) {
    tft.fillScreen(emergencyBlinkPhase ? RED : BG);
    drawCenteredText("STOP", RECT_EMERGENCY_TITLE, TEXT, emergencyBlinkPhase ? RED : BG);
    drawCenteredText("ODPOJENA RELE", RECT_EMERGENCY_STATUS, TEXT, emergencyBlinkPhase ? RED : BG); drawCenteredText("Dlouze podrzte pro obnovu", RECT_EMERGENCY_HELP, TEXT, emergencyBlinkPhase ? RED : BG);
  } else if (emergencyPrompt) {
    tft.fillScreen(BG); drawCenteredText("RELE JSOU ODPOJENA", {SAFE_EDGE, 38, SCREEN_WIDTH - SAFE_EDGE * 2, 28}, TEXT); drawCenteredText("Chcete znovu pripojit panely a baterii?", {SAFE_EDGE, 74, SCREEN_WIDTH - SAFE_EDGE * 2, 20}, MUTED);
    tft.fillRoundRect(RECT_EMERGENCY_YES.x, RECT_EMERGENCY_YES.y, RECT_EMERGENCY_YES.w, RECT_EMERGENCY_YES.h, 8, GREEN); tft.fillRoundRect(RECT_EMERGENCY_NO.x, RECT_EMERGENCY_NO.y, RECT_EMERGENCY_NO.w, RECT_EMERGENCY_NO.h, 8, PANEL); drawCenteredText("ANO", RECT_EMERGENCY_YES, BG, GREEN); drawCenteredText("NE", RECT_EMERGENCY_NO, TEXT, PANEL);
  }
}

bool debugLayout = false;
void drawLayoutDebug() { if (!debugLayout) return; const UiRect areas[] = {RECT_OVERVIEW_TEMP, RECT_OVERVIEW_POWER, RECT_OVERVIEW_WEATHER, RECT_ENERGY_PANELS, RECT_ENERGY_BATTERY, RECT_ENERGY_TODAY, RECT_TEMP_0, RECT_TEMP_1, RECT_TEMP_2, RECT_TEMP_3, RECT_DIAG_0, RECT_DIAG_1, RECT_DIAG_2, RECT_DIAG_3, RECT_RELAY_0, RECT_RELAY_1, RECT_RELAY_2, RECT_RELAY_3, RECT_RELAY_4, RECT_RELAY_5, RECT_NAV_0, RECT_NAV_1, RECT_NAV_2}; for (const UiRect& area : areas) tft.drawRect(area.x, area.y, area.w, area.h, RED); }
void drawScreen() { if (!hasTelemetry) loadTelemetry(); if (otaInProgress) { drawOtaProgress(); return; } if (screen == 0) drawOverviewScreen(); else if (screen == 1) drawEnergyScreen(); else if (screen == 2) drawRelayScreen(); else if (screen == 3) drawTemperatureScreen(); else drawDiagnosticsScreen(); if (emergencyBlink || emergencyPrompt) drawEmergencyOverlay(); drawLayoutDebug(); }

bool apiRequest(const String& method, const String& body, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http; String endpoint = method == "GET" ? "/api/solar/latest" : "/api/solar/device"; http.begin(String(SOLAR_API_BASE) + endpoint); if (method != "GET") http.addHeader("Authorization", String("Bearer ") + SOLAR_DEVICE_TOKEN); http.addHeader("Content-Type", "application/json");
  int code = method == "GET" ? http.GET() : http.POST(body); lastHttpCode = code; response = http.getString(); http.end(); return code >= 200 && code < 300;
}

void fetchData() {
  String response; if (!apiRequest("GET", "", response)) { apiErrors++; lastApiError = millis(); offlineMode = true; notice = "API neni dostupne"; drawScreen(); return; }
  JsonDocument filter; filter["telemetry"]["object_temperature"] = true; filter["telemetry"]["object_humidity"] = true; filter["telemetry"]["outside_temperature"] = true; filter["telemetry"]["mppt_temperature"] = true; filter["telemetry"]["solar1_current"] = true; filter["telemetry"]["solar2_current"] = true; filter["telemetry"]["battery_voltage"] = true; filter["telemetry"]["battery_current"] = true; filter["telemetry"]["solar1_power"] = true; filter["telemetry"]["solar2_power"] = true; filter["telemetry"]["load_power"] = true; filter["telemetry"]["battery_temperature"] = true; filter["telemetry"]["solar_energy_today_wh"] = true; filter["relays"] = true;
  JsonDocument doc; if (deserializeJson(doc, response, DeserializationOption::Filter(filter))) { apiErrors++; lastApiError = millis(); offlineMode = true; notice = "Chybna data"; drawScreen(); return; }
  JsonObject data = doc["telemetry"];
  telemetry.batteryVoltage = number(data["battery_voltage"]); telemetry.batteryCurrent = number(data["battery_current"]); telemetry.solar1Power = number(data["solar1_power"]); telemetry.solar2Power = number(data["solar2_power"]); telemetry.solar1Current = number(data["solar1_current"]); telemetry.solar2Current = number(data["solar2_current"]); telemetry.loadPower = number(data["load_power"]); telemetry.batteryTemp = number(data["battery_temperature"]); telemetry.objectTemp = number(data["object_temperature"]); telemetry.outsideTemp = number(data["outside_temperature"]); telemetry.mpptTemp = number(data["mppt_temperature"]); telemetry.objectHumidity = number(data["object_humidity"]); telemetry.solarEnergy = data["solar_energy_today_wh"] | 0; telemetry.recordedAt = data["recorded_at"] | "";
  JsonObject states = doc["relays"]; for (int i = 0; i < 6; i++) relays[i] = states[relayNames[i]] | false;
  hasTelemetry = true; lastDataSuccess = millis(); offlineMode = false; saveTelemetry(); notice = "Aktualizovano"; drawScreen();
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

bool setRelayState(int index, bool state) {
  String body = String("{\"relay\":\"") + relayNames[index] + "\",\"isOn\":" + (state ? "true" : "false") + "}"; String response;
  if (!apiRequest("POST", body, response)) return false;
  JsonDocument reply;
  if (deserializeJson(reply, response)) return false;
  return reply["ok"].as<bool>() && reply["relay"].as<String>() == relayNames[index] && reply["isOn"].as<bool>() == state;
}

void disconnectSafetyRelays() {
  bool ok = true;
  for (int index : {0, 1, 2}) ok = setRelayState(index, false) && ok;
  if (ok) { relays[0] = false; relays[1] = false; relays[2] = false; notice = "Bezpecne odpojeno"; }
  else { notice = "Chyba odpojovani"; }
  drawScreen();
}

void reconnectSafetyRelays() {
  bool ok = true;
  for (int index : {0, 1, 2}) ok = setRelayState(index, true) && ok;
  if (ok) { relays[0] = true; relays[1] = true; relays[2] = true; notice = "Rele pripojeno"; }
  else { notice = "Chyba pripojovani"; }
  drawScreen();
}

void toggleRelay(int index) {
  String body = String("{\"relay\":\"") + relayNames[index] + "\",\"isOn\":" + (!relays[index] ? "true" : "false") + "}"; String response;
  if (apiRequest("POST", body, response)) { notice = "Overuji stav rele"; fetchData(); } else { notice = "API chyba HTTP " + String(lastHttpCode); drawScreen(); }
}

void touchInput() {
  if (!touch.touched()) { touchDown = false; touchedRelay = -1; emergencyLongPressHandled = false; return; }
  lastInteraction = millis(); updateBacklight(); TS_Point p = touch.getPoint(); int x = constrain(map(p.x, 200, 3700, 0, SCREEN_WIDTH - 1), 0, SCREEN_WIDTH - 1); int y = constrain(map(p.y, 240, 3800, 0, SCREEN_HEIGHT - 1), 0, SCREEN_HEIGHT - 1);
  if (!touchDown) { touchDown = true; touchHandled = false; touchStarted = millis(); emergencyLongPressHandled = false; }
  uint32_t heldFor = millis() - touchStarted;
  if (emergencyPrompt) {
    if (!touchHandled && y >= 125 && y < 175) {
      touchHandled = true; emergencyPrompt = false;
      if (x >= 45 && x < 150) reconnectSafetyRelays(); else if (x >= 170 && x < 275) { notice = "Rele zustavaji odpojena"; drawScreen(); }
    }
    return;
  }
  if (emergencyBlink) {
    if (!emergencyLongPressHandled && heldFor > 2500) { emergencyLongPressHandled = true; emergencyBlink = false; emergencyPrompt = true; drawScreen(); }
    return;
  }
  if (!emergencyLongPressHandled && heldFor > 2500) {
    emergencyLongPressHandled = true; emergencyBlink = true; emergencyBlinkPhase = true; lastEmergencyBlink = millis(); disconnectSafetyRelays(); return;
  }
  if (y >= NAV_Y) { if (!touchHandled) { touchHandled = true; screen = x < 110 ? 0 : x < 216 ? 1 : 2; drawScreen(); } return; }
  if (screen == 0 && y >= RECT_OVERVIEW_TEMP.y && y < RECT_OVERVIEW_TEMP.y + RECT_OVERVIEW_TEMP.h) { if (!touchHandled) { touchHandled = true; screen = 3; drawScreen(); } return; }
  if (screen == 0 && x >= 275 && y < CONTENT_Y) { if (!touchHandled) { touchHandled = true; screen = 4; drawScreen(); } return; }
  if ((screen == 3 || screen == 4) && y < CONTENT_Y) { if (!touchHandled) { touchHandled = true; screen = 0; drawScreen(); } return; }
  if (screen == 2 && y >= RECT_RELAY_0.y && y < RECT_RELAY_3.y + RECT_RELAY_3.h) {
    int col = x < 109 ? 0 : x < 215 ? 1 : 2; int row = y < RECT_RELAY_3.y ? 0 : 1; int index = row * 3 + col; bool critical = index == 2 || index == 3;
    if (index < 6 && !touchHandled && (!critical || heldFor > 1200)) { touchHandled = true; if (critical) notice = "Dlouhy stisk potvrzen"; toggleRelay(index); }
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

void setup() { Serial.begin(115200); pinMode(21, OUTPUT); digitalWrite(21, HIGH); tft.init(); tft.setRotation(1); touchSPI.begin(25, 39, 32, 33); touch.begin(touchSPI); touch.setRotation(1); if (!LittleFS.begin(true)) { notice = "LittleFS chyba"; drawScreen(); while (true) delay(1000); } if (!LittleFS.exists("/CzechSans15.vlw") || !LittleFS.exists("/CzechSans32.vlw")) { notice = "Chybi fonty"; drawScreen(); while (true) delay(1000); } fontsReady = true; useSmallFont(); drawScreen(); WiFi.setSleep(false); WiFi.setHostname("qso-esp32-solar"); WiFi.begin(WIFI_SSID, WIFI_PASSWORD); uint32_t start = millis(); while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) { delay(300); } if (WiFi.status() == WL_CONNECTED) { setupOTA(); notice = WiFi.localIP().toString(); } else notice = "WiFi se nepripojilo"; drawScreen(); }
void loop() { uint32_t loopStarted = millis(); esp_task_wdt_reset(); ArduinoOTA.handle(); touchInput(); if (emergencyBlink && millis() - lastEmergencyBlink > 400) { lastEmergencyBlink = millis(); emergencyBlinkPhase = !emergencyBlinkPhase; drawEmergencyOverlay(); } if (hasTelemetry && lastDataSuccess && millis() - lastDataSuccess > 120000) offlineMode = true; if (millis() - lastBrightnessUpdate > 1000) { lastBrightnessUpdate = millis(); updateBacklight(); } if (millis() - lastFetch > 60000) { lastFetch = millis(); fetchData(); } static uint32_t lastWeatherFetch = 0; if (lastWeatherFetch == 0 || millis() - lastWeatherFetch > 30000) { lastWeatherFetch = millis(); fetchWeather(); drawScreen(); } updateCpuLoad(loopStarted); delay(20); }
