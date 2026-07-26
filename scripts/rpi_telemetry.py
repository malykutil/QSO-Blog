#!/usr/bin/env python3
"""Publish DHT11, two BMP280 and INA219 readings to the QSO Blog."""

import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

import adafruit_bmp280
import adafruit_dht
import adafruit_ina219
import board
import lgpio
from smbus2 import SMBus, i2c_msg

API_URL = os.environ.get("SOLAR_API_URL", "").rstrip("/") + "/api/solar"
DEVICE_API_URL = os.environ.get("SOLAR_API_URL", "").rstrip("/") + "/api/solar/device"
TOKEN = os.environ.get("SOLAR_RPI_TOKEN", "")
INTERVAL = max(10, int(os.environ.get("TELEMETRY_INTERVAL_SECONDS", "60")))
RELAY_POLL_INTERVAL = max(2, int(os.environ.get("RELAY_POLL_INTERVAL_SECONDS", "5")))
DHT_ENABLED = os.environ.get("DHT_ENABLED", "1") == "1"
RELAY_ACTIVE_LOW = os.environ.get("RELAY_ACTIVE_LOW", "1") == "1"
RELAY_PINS = {
    "solar1": int(os.environ.get("RELAY_SOLAR1_GPIO", "5")),
    "solar2": int(os.environ.get("RELAY_SOLAR2_GPIO", "6")),
    "battery": int(os.environ.get("RELAY_BATTERY_GPIO", "13")),
    "bufik": int(os.environ.get("RELAY_BUFIK_GPIO", "16")),
    "fan12v": int(os.environ.get("RELAY_FAN12V_GPIO", "19")),
    "fan24v": int(os.environ.get("RELAY_FAN24V_GPIO", "20")),
}
BMP_BATTERY_ADDRESS = int(os.environ.get("BMP_BATTERY_ADDRESS", "0x76"), 0)
BMP_OUTSIDE_ADDRESS = int(os.environ.get("BMP_OUTSIDE_ADDRESS", "0x77"), 0)
PICO_I2C_BUS = int(os.environ.get("PICO_I2C_BUS", "1"))
PICO_I2C_ADDRESS = int(os.environ.get("PICO_I2C_ADDRESS", "0x42"), 0)
ACS_ZERO_MV_AT_ADC = float(os.environ.get("ACS_ZERO_MV_AT_ADC", "1667"))
ACS_SENSITIVITY_MV_PER_A_AT_ADC = float(os.environ.get("ACS_SENSITIVITY_MV_PER_A_AT_ADC", "66.7"))

if not API_URL or not TOKEN:
    raise SystemExit("Nastav SOLAR_API_URL a SOLAR_RPI_TOKEN.")

i2c = board.I2C()

def optional_device(factory, name):
    try:
        return factory()
    except (OSError, RuntimeError, ValueError) as error:
        print(f"senzor {name} neni dostupny: {error}", flush=True)
        return None


dht = optional_device(lambda: adafruit_dht.DHT11(board.D26), "DHT11") if DHT_ENABLED else None
bmp_battery = optional_device(
    lambda: adafruit_bmp280.Adafruit_BMP280_I2C(i2c, address=BMP_BATTERY_ADDRESS),
    f"BMP280 {BMP_BATTERY_ADDRESS:#04x}",
)
bmp_outside = optional_device(
    lambda: adafruit_bmp280.Adafruit_BMP280_I2C(i2c, address=BMP_OUTSIDE_ADDRESS),
    f"BMP280 {BMP_OUTSIDE_ADDRESS:#04x}",
)
ina219 = optional_device(lambda: adafruit_ina219.INA219(i2c), "INA219")
pico_bus = optional_device(lambda: SMBus(PICO_I2C_BUS), f"I2C bus {PICO_I2C_BUS}")
gpio_handle = lgpio.gpiochip_open(0)
relay_states = {name: False for name in RELAY_PINS}


def relay_level(is_on):
    return (0 if is_on else 1) if RELAY_ACTIVE_LOW else (1 if is_on else 0)


def setup_relays():
    for pin in RELAY_PINS.values():
        lgpio.gpio_claim_output(gpio_handle, pin, relay_level(False))


def apply_relay(name, is_on):
    pin = RELAY_PINS[name]
    lgpio.gpio_write(gpio_handle, pin, relay_level(is_on))
    relay_states[name] = is_on


def fetch_relay_states():
    request = urllib.request.Request(DEVICE_API_URL, headers={
        "Authorization": f"Bearer {TOKEN}",
        "User-Agent": "qso-blog-rpi-relay/1.0",
    }, method="GET")
    with urllib.request.urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
    for name, is_on in payload.get("relays", {}).items():
        if name in RELAY_PINS and isinstance(is_on, bool) and relay_states[name] != is_on:
            apply_relay(name, is_on)
    return payload.get("relays", {})


def read_number(read):
    try:
        value = read()
        return float(value) if value is not None else None
    except (RuntimeError, OSError, ValueError):
        return None


def read_rpi_cpu_temperature():
    try:
        return float(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()) / 1000.0
    except (OSError, ValueError):
        return None


def read_sensors():
    object_temperature = read_number(lambda: dht.temperature) if dht else None
    object_humidity = read_number(lambda: dht.humidity) if dht else None
    battery_temperature = read_number(lambda: bmp_battery.temperature) if bmp_battery else None
    outside_temperature = read_number(lambda: bmp_outside.temperature) if bmp_outside else None
    outside_pressure = read_number(lambda: bmp_outside.pressure) if bmp_outside else None
    battery_voltage = read_number(lambda: ina219.bus_voltage) if ina219 else None
    battery_current = read_number(lambda: ina219.current / 1000.0) if ina219 else None
    pico = read_pico()
    return {
        "rpi_cpu_temperature": read_rpi_cpu_temperature(),
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
    if pico_bus is None:
        return {"currents": [None, None, None], "mq9_raw": None, "mq9_voltage": None}
    try:
        write = i2c_msg.write(PICO_I2C_ADDRESS, [0x10])
        read = i2c_msg.read(PICO_I2C_ADDRESS, 24)
        pico_bus.i2c_rdwr(write, read)
        data = bytes(read)
        if len(data) != 24 or int.from_bytes(data[0:2], "little") not in (1, 2):
            raise RuntimeError("neplatný Pico rámec")
        acs_mv = [int.from_bytes(data[offset:offset + 2], "little") for offset in (10, 12, 14)]
        status = data[22]
        if status & 0x02:
            zero_mv = 2500.0
            sensitivity = 100.0
        else:
            zero_mv = ACS_ZERO_MV_AT_ADC
            sensitivity = ACS_SENSITIVITY_MV_PER_A_AT_ADC
        currents = [(mv - zero_mv) / sensitivity for mv in acs_mv]
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
    setup_relays()
    next_telemetry = 0.0
    next_relay_poll = 0.0
    while True:
        now = time.monotonic()
        if now >= next_relay_poll:
            try:
                states = fetch_relay_states()
                print("relé: " + json.dumps(states, ensure_ascii=False), flush=True)
            except (RuntimeError, urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
                print(f"chyba stavu relé: {error}", flush=True)
            next_relay_poll = now + RELAY_POLL_INTERVAL
        if now >= next_telemetry:
            try:
                payload = read_sensors()
                send(payload)
                print("odesláno: " + json.dumps(payload, ensure_ascii=False), flush=True)
            except (RuntimeError, urllib.error.URLError, TimeoutError, OSError) as error:
                print(f"chyba měření/odeslání: {error}", flush=True)
            next_telemetry = now + INTERVAL
        time.sleep(1)
finally:
    for name in RELAY_PINS:
        try:
            apply_relay(name, False)
        except OSError:
            pass
    lgpio.gpiochip_close(gpio_handle)
    if dht:
        dht.exit()
    if pico_bus:
        pico_bus.close()
