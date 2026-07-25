#!/usr/bin/env python3
"""Read the DHT11 on BCM GPIO 26 and publish telemetry to the web."""

import json
import os
import time
import urllib.error
import urllib.request

import adafruit_dht
import board

API_URL = os.environ.get("SOLAR_API_URL", "").rstrip("/") + "/api/solar"
TOKEN = os.environ.get("SOLAR_RPI_TOKEN", "")
INTERVAL = max(10, int(os.environ.get("DHT_INTERVAL_SECONDS", "10")))

if not API_URL or not TOKEN:
    raise SystemExit("Nastav SOLAR_API_URL a SOLAR_RPI_TOKEN.")

sensor = adafruit_dht.DHT11(board.D26)

def send(temperature: float, humidity: float) -> None:
    body = json.dumps({"object_temperature": temperature, "object_humidity": humidity}).encode("utf-8")
    request = urllib.request.Request(API_URL, data=body, headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "qso-blog-dht11/1.0"}, method="POST")
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"server returned HTTP {response.status}")

try:
    while True:
        try:
            temperature = sensor.temperature
            humidity = sensor.humidity
            if temperature is None or humidity is None:
                raise RuntimeError("DHT11 returned no data")
            send(float(temperature), float(humidity))
            print(f"odesláno: {temperature:.1f} °C, {humidity:.0f} %", flush=True)
        except urllib.error.HTTPError as error:
            print(f"HTTP {error.code}: {error.read().decode('utf-8', errors='replace')}", flush=True)
        except (RuntimeError, urllib.error.URLError, TimeoutError, ValueError) as error:
            print(f"chyba měření/odeslání: {error}", flush=True)
        time.sleep(INTERVAL)
finally:
    sensor.exit()
