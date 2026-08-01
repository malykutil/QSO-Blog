#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <Adafruit_INA219.h>

// Zapojeni podle skutecne instalace.
constexpr uint8_t MQ9_PIN = A0;
constexpr uint8_t ACS_PINS[] = {A1, A2, A3};
constexpr uint8_t BMP_BATTERY_ADDRESS = 0x76;
constexpr uint8_t BMP_OUTSIDE_ADDRESS = 0x77;
constexpr uint8_t INA_I2C_ADDRESS = 0x40;

constexpr unsigned long SERIAL_BAUD = 115200;
constexpr unsigned long SAMPLE_INTERVAL_MS = 2000;
constexpr unsigned long SENSOR_RETRY_INTERVAL_MS = 30000;
constexpr uint8_t ANALOG_SAMPLES = 32;
constexpr uint8_t MAX_I2C_DEVICES = 8;

// Nulove body zmerene 2026-08-01 pri odpojenych proudech (30 vzorku).
// Pro ACS712-5A pouzij citlivost 185, pro ACS712-30A 66 mV/A.
constexpr float ACS_ZERO_MV[] = {2490.39F, 2456.83F, 2506.68F};
constexpr float ACS_SENSITIVITY_MV_PER_A[] = {100.0F, 100.0F, 100.0F};
constexpr float ACS_ZERO_DEADBAND_A = 0.10F;
// Odpojeny INA219 v teto instalaci vraci priblizne 1 V. Protoze se pouziva
// pouze jako voltmetr, hodnoty do teto meze zverejnime jako nulu.
constexpr float INA_DISCONNECTED_MAX_V = 1.10F;
constexpr float ADC_REFERENCE_MV = 5000.0F;

Adafruit_BMP280 bmpBattery;
Adafruit_BMP280 bmpOutside;
Adafruit_INA219 ina219(INA_I2C_ADDRESS);

bool bmpBatteryReady = false;
bool bmpOutsideReady = false;
bool ina219Ready = false;
unsigned long lastSampleMs = 0;
unsigned long lastSensorRetryMs = 0;
uint8_t i2cAddresses[MAX_I2C_DEVICES];
uint8_t i2cDeviceCount = 0;

uint16_t averageAnalog(uint8_t pin) {
  uint32_t total = 0;
  for (uint8_t sample = 0; sample < ANALOG_SAMPLES; sample++) {
    total += analogRead(pin);
    delayMicroseconds(250);
  }
  return static_cast<uint16_t>(total / ANALOG_SAMPLES);
}

float rawToMillivolts(uint16_t raw) {
  return static_cast<float>(raw) * ADC_REFERENCE_MV / 1023.0F;
}

float acsCurrent(uint8_t channel, float millivolts) {
  const float current = (millivolts - ACS_ZERO_MV[channel]) / ACS_SENSITIVITY_MV_PER_A[channel];
  return fabs(current) <= ACS_ZERO_DEADBAND_A ? 0.0F : current;
}

void printFloatOrNull(float value, uint8_t digits) {
  if (isnan(value) || isinf(value)) {
    Serial.print(F("null"));
  } else {
    Serial.print(value, digits);
  }
}

void scanI2cBus() {
  i2cDeviceCount = 0;
  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0 && i2cDeviceCount < MAX_I2C_DEVICES) {
      i2cAddresses[i2cDeviceCount++] = address;
    }
  }
}

void detectSensors() {
  scanI2cBus();
  if (!bmpBatteryReady) {
    bmpBatteryReady = bmpBattery.begin(BMP_BATTERY_ADDRESS);
  }
  if (!bmpOutsideReady) {
    bmpOutsideReady = bmpOutside.begin(BMP_OUTSIDE_ADDRESS);
  }
  if (!ina219Ready) {
    ina219Ready = ina219.begin(&Wire);
  }
}

void emitTelemetry() {
  const uint16_t mq9Raw = averageAnalog(MQ9_PIN);
  const float mq9Voltage = rawToMillivolts(mq9Raw) / 1000.0F;
  uint16_t acsRaw[3];
  float acsVoltage[3];
  float acsCurrentA[3];

  for (uint8_t channel = 0; channel < 3; channel++) {
    acsRaw[channel] = averageAnalog(ACS_PINS[channel]);
    const float millivolts = rawToMillivolts(acsRaw[channel]);
    acsVoltage[channel] = millivolts / 1000.0F;
    acsCurrentA[channel] = acsCurrent(channel, millivolts);
  }

  const float batteryTemperature = bmpBatteryReady ? bmpBattery.readTemperature() : NAN;
  const float batteryPressure = bmpBatteryReady ? bmpBattery.readPressure() / 100.0F : NAN;
  const float outsideTemperature = bmpOutsideReady ? bmpOutside.readTemperature() : NAN;
  const float outsidePressure = bmpOutsideReady ? bmpOutside.readPressure() / 100.0F : NAN;
  float inaBusVoltage = ina219Ready ? ina219.getBusVoltage_V() : NAN;
  if (!isnan(inaBusVoltage) && inaBusVoltage <= INA_DISCONNECTED_MAX_V) {
    inaBusVoltage = 0.0F;
  }
  // INA219 zde slouzi pouze jako voltmetr. Proud a vykon meri ACS712.
  const float inaShuntVoltage = NAN;
  const float inaCurrent = NAN;
  const float inaPower = NAN;

  Serial.print(F("{\"type\":\"qso_telemetry\",\"version\":1,\"uptime_ms\":"));
  Serial.print(millis());
  Serial.print(F(",\"mq9_raw\":"));
  Serial.print(mq9Raw);
  Serial.print(F(",\"mq9_voltage\":"));
  printFloatOrNull(mq9Voltage, 3);
  for (uint8_t channel = 0; channel < 3; channel++) {
    Serial.print(F(",\"acs"));
    Serial.print(channel + 1);
    Serial.print(F("_raw\":"));
    Serial.print(acsRaw[channel]);
    Serial.print(F(",\"acs"));
    Serial.print(channel + 1);
    Serial.print(F("_voltage\":"));
    printFloatOrNull(acsVoltage[channel], 3);
    Serial.print(F(",\"acs"));
    Serial.print(channel + 1);
    Serial.print(F("_current\":"));
    printFloatOrNull(acsCurrentA[channel], 3);
  }
  Serial.print(F(",\"battery_temperature\":"));
  printFloatOrNull(batteryTemperature, 2);
  Serial.print(F(",\"battery_pressure\":"));
  printFloatOrNull(batteryPressure, 2);
  Serial.print(F(",\"outside_temperature\":"));
  printFloatOrNull(outsideTemperature, 2);
  Serial.print(F(",\"outside_pressure\":"));
  printFloatOrNull(outsidePressure, 2);
  Serial.print(F(",\"ina219_bus_voltage\":"));
  printFloatOrNull(inaBusVoltage, 3);
  Serial.print(F(",\"ina219_shunt_voltage_mv\":"));
  printFloatOrNull(inaShuntVoltage, 3);
  Serial.print(F(",\"ina219_current\":"));
  printFloatOrNull(inaCurrent, 3);
  Serial.print(F(",\"ina219_power\":"));
  printFloatOrNull(inaPower, 3);
  Serial.print(F(",\"sensors\":{\"bmp_0x76\":"));
  Serial.print(bmpBatteryReady ? F("true") : F("false"));
  Serial.print(F(",\"bmp_0x77\":"));
  Serial.print(bmpOutsideReady ? F("true") : F("false"));
  Serial.print(F(",\"ina219_0x40\":"));
  Serial.print(ina219Ready ? F("true") : F("false"));
  Serial.print(F("},\"i2c_addresses\":["));
  for (uint8_t index = 0; index < i2cDeviceCount; index++) {
    if (index > 0) Serial.print(',');
    Serial.print(i2cAddresses[index]);
  }
  Serial.println(F("]}"));
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  Wire.begin();
  Wire.setClock(100000);
  detectSensors();
  emitTelemetry();
  lastSampleMs = millis();
  lastSensorRetryMs = millis();
}

void loop() {
  const unsigned long now = millis();
  if (now - lastSensorRetryMs >= SENSOR_RETRY_INTERVAL_MS) {
    detectSensors();
    lastSensorRetryMs = now;
  }
  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    emitTelemetry();
    lastSampleMs = now;
  }
}
