#!/usr/bin/env python3
"""Publish DHT11, two BMP280 and INA219 readings to the QSO Blog."""

import json
import os
import time
import urllib.error
import urllib.request

import adafruit_bmp280
import adafruit_dht
import adafruit_ina219
import board
from smbus2 import SMBus, i2c_msg

API_URL = os.environ.get("SOLAR_API_URL", "").rstrip("/") + "/api/solar"
TOKEN = os.environ.get("SOLAR_RPI_TOKEN", "")
INTERVAL = max(10, int(os.environ.get("TELEMETRY_INTERVAL_SECONDS", "10")))
BMP_BATTERY_ADDRESS = int(os.environ.get("BMP_BATTERY_ADDRESS", "0x76"), 0)
BMP_OUTSIDE_ADDRESS = int(os.environ.get("BMP_OUTSIDE_ADDRESS", "0x77"), 0)
PICO_I2C_BUS = int(os.environ.get("PICO_I2C_BUS", "1"))
PICO_I2C_ADDRESS = int(os.environ.get("PICO_I2C_ADDRESS", "0x42"), 0)
ACS_ZERO_MV_AT_ADC = float(os.environ.get("ACS_ZERO_MV_AT_ADC", "1667"))
ACS_SENSITIVITY_MV_PER_A_AT_ADC = float(os.environ.get("ACS_SENSITIVITY_MV_PER_A_AT_ADC", "66.7"))

if not API_URL or not TOKEN:
    raise SystemExit("Nastav SOLAR_API_URL a SOLAR_RPI_TOKEN.")

i2c = board.I2C()
dht = adafruit_dht.DHT11(board.D26)
bmp_battery = adafruit_bmp280.Adafruit_BMP280_I2C(i2c, address=BMP_BATTERY_ADDRESS)
bmp_outside = adafruit_bmp280.Adafruit_BMP280_I2C(i2c, address=BMP_OUTSIDE_ADDRESS)
ina219 = adafruit_ina219.INA219(i2c)
pico_bus = SMBus(PICO_I2C_BUS)


def read_number(read):
    try:
        value = read()
        return float(value) if value is not None else None
    except (RuntimeError, OSError, ValueError):
        return None


def read_sensors():
    object_temperature = read_number(lambda: dht.temperature)
    object_humidity = read_number(lambda: dht.humidity)
    battery_temperature = read_number(lambda: bmp_battery.temperature)
    outside_temperature = read_number(lambda: bmp_outside.temperature)
    outside_pressure = read_number(lambda: bmp_outside.pressure)
    battery_voltage = read_number(lambda: ina219.bus_voltage)
    battery_current = read_number(lambda: ina219.current / 1000.0)
    pico = read_pico()
    return {
        "object_temperature": object_temperature,
        "object_humidity": object_humidity,
        "battery_temperature": battery_temperature,
        "outside_temperature": outside_temperature,
        "outside_pressure": outside_pressure,
        "battery_voltage": battery_voltage,
        "battery_current": battery_current,
        "solar1_current": pico["currents"][0],
        "solar2_current": pico["currents"][1],
        "battery_current": pico["currents"][2] if pico["currents"][2] is not None else battery_current,
        "mq9_raw": pico["mq9_raw"],
        "mq9_voltage": pico["mq9_voltage"],
    }


def read_pico():
    try:
        write = i2c_msg.write(PICO_I2C_ADDRESS, [0x10])
        read = i2c_msg.read(PICO_I2C_ADDRESS, 24)
        pico_bus.i2c_rdwr(write, read)
        data = bytes(read)
        if len(data) != 24 or int.from_bytes(data[0:2], "little") != 1:
            raise RuntimeError("neplatný Pico rámec")
        acs_mv = [int.from_bytes(data[offset:offset + 2], "little") for offset in (10, 12, 14)]
        currents = [(mv - ACS_ZERO_MV_AT_ADC) / ACS_SENSITIVITY_MV_PER_A_AT_ADC for mv in acs_mv]
        mq9_raw = int.from_bytes(data[8:10], "little") or None
        mq9_mv = int.from_bytes(data[16:18], "little") / 1000 if int.from_bytes(data[16:18], "little") else None
        return {"currents": currents, "mq9_raw": mq9_raw, "mq9_voltage": mq9_mv}
    except (OSError, ValueError, RuntimeError):
        return {"currents": [None, None, None], "mq9_raw": None, "mq9_voltage": None}


def send(payload):
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(API_URL, data=body, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
        "User-Agent": "qso-blog-rpi-telemetry/1.0",
    }, method="POST")
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"server returned HTTP {response.status}")


try:
    while True:
        try:
            payload = read_sensors()
            send(payload)
            print("odesláno: " + json.dumps(payload, ensure_ascii=False), flush=True)
        except (RuntimeError, urllib.error.URLError, TimeoutError, OSError) as error:
            print(f"chyba měření/odeslání: {error}", flush=True)
        time.sleep(INTERVAL)
finally:
    dht.exit()
    pico_bus.close()
