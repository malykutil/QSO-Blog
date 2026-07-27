#!/usr/bin/env python3
"""Read the DHT11 on BCM GPIO 26 and publish telemetry to the web."""

import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

import adafruit_dht
import board

API_URL = os.environ.get("SOLAR_API_URL", "").rstrip("/") + "/api/solar"
TOKEN = os.environ.get("SOLAR_RPI_TOKEN", "")
INTERVAL = max(10, int(os.environ.get("DHT_INTERVAL_SECONDS", "30")))
DHT_READ_RETRIES = max(1, int(os.environ.get("DHT_READ_RETRIES", "3")))

if not API_URL or not TOKEN:
    raise SystemExit("Nastav SOLAR_API_URL a SOLAR_RPI_TOKEN.")

sensor = adafruit_dht.DHT11(board.D26)


def read_rpi_cpu_temperature():
    try:
        return float(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()) / 1000.0
    except (OSError, ValueError):
        return None

def send(temperature: float, humidity: float) -> None:
    body = json.dumps({
        "object_temperature": temperature,
        "object_humidity": humidity,
        "rpi_cpu_temperature": read_rpi_cpu_temperature(),
    }).encode("utf-8")
    request = urllib.request.Request(API_URL, data=body, headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "qso-blog-dht11/1.0"}, method="POST")
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"server returned HTTP {response.status}")


def read_dht11():
    last_error = None
    for attempt in range(DHT_READ_RETRIES):
        try:
            temperature = sensor.temperature
            humidity = sensor.humidity
            if temperature is None or humidity is None:
                raise RuntimeError("DHT11 returned no data")
            temperature = float(temperature)
            humidity = float(humidity)
            if not math.isfinite(temperature) or not -40.0 <= temperature <= 80.0:
                raise ValueError(f"DHT11 temperature out of range: {temperature}")
            if not math.isfinite(humidity) or not 0.0 <= humidity <= 100.0:
                raise ValueError(f"DHT11 humidity out of range: {humidity}")
            return temperature, humidity
        except (RuntimeError, OSError, ValueError) as error:
            last_error = error
            if attempt + 1 < DHT_READ_RETRIES:
                time.sleep(2)
    raise RuntimeError(f"DHT11 failed after {DHT_READ_RETRIES} attempts: {last_error}")

try:
    while True:
        try:
            temperature, humidity = read_dht11()
            send(temperature, humidity)
            print(f"odesláno: {temperature:.1f} °C, {humidity:.0f} %", flush=True)
        except urllib.error.HTTPError as error:
            print(f"HTTP {error.code}: {error.read().decode('utf-8', errors='replace')}", flush=True)
        except (RuntimeError, urllib.error.URLError, TimeoutError, ValueError) as error:
            print(f"chyba měření/odeslání: {error}", flush=True)
        time.sleep(INTERVAL)
finally:
    sensor.exit()
