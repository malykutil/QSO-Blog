#include <Arduino.h>
#include <Wire.h>

const uint8_t I2C_ADDRESS = 0x42;
const uint8_t FRAME_REGISTER = 0x10;
const uint16_t FRAME_VERSION = 2;
const uint8_t STATUS_NANO_5V_ADC = 0x02;

const uint8_t ACS_PINS[3] = {A0, A1, A2};
const uint8_t MQ9_PIN = A3;

struct __attribute__((packed)) TelemetryFrame {
  uint16_t version;
  uint16_t acsRaw[3];
  uint16_t mq9Raw;
  uint16_t acsMv[3];
  uint16_t mq9Mv;
  uint32_t sampleMs;
  uint8_t status;
  uint8_t reserved;
};

volatile TelemetryFrame frame;
volatile uint8_t registerPointer = 0;

uint16_t averageAnalog(uint8_t pin) {
  uint32_t total = 0;
  for (uint8_t i = 0; i < 32; i++) {
    total += analogRead(pin);
  }
  return total / 32;
}

uint16_t adcToMillivolts(uint16_t raw) {
  // Classic Nano uses the 5 V AVCC reference by default.
  return (uint32_t)raw * 5000UL / 1023UL;
}

void receiveEvent(int count) {
  if (count <= 0) return;
  registerPointer = Wire.read();
  while (Wire.available()) Wire.read();
}

void requestEvent() {
  TelemetryFrame snapshot;
  noInterrupts();
  memcpy(&snapshot, (const void *)&frame, sizeof(snapshot));
  interrupts();

  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(&snapshot);
  uint8_t offset = registerPointer >= FRAME_REGISTER ? registerPointer - FRAME_REGISTER : 0;
  uint8_t remaining = offset < sizeof(snapshot) ? sizeof(snapshot) - offset : 0;
  uint8_t count = remaining > 24 ? 24 : remaining;
  Wire.write(bytes + offset, count);
  registerPointer += count;
}

void updateFrame() {
  TelemetryFrame next = {};
  next.version = FRAME_VERSION;
  for (uint8_t i = 0; i < 3; i++) {
    next.acsRaw[i] = averageAnalog(ACS_PINS[i]);
    next.acsMv[i] = adcToMillivolts(next.acsRaw[i]);
  }
  next.mq9Raw = averageAnalog(MQ9_PIN);
  next.mq9Mv = adcToMillivolts(next.mq9Raw);
  next.sampleMs = millis();
  next.status = STATUS_NANO_5V_ADC;

  noInterrupts();
  memcpy((void *)&frame, &next, sizeof(next));
  interrupts();
}

void setup() {
  Serial.begin(115200);
  Wire.begin(I2C_ADDRESS);
  Wire.onReceive(receiveEvent);
  Wire.onRequest(requestEvent);
  updateFrame();
}

void loop() {
  updateFrame();
  Serial.println(F("ADC frame updated"));
  delay(1000);
}
