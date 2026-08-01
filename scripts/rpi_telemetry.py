#!/usr/bin/env python3
"""Read Arduino Nano telemetry over USB and publish it to the QSO Blog."""

import glob
import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

import adafruit_dht
import board
import lgpio
import serial
from serial.tools import list_ports

BASE_URL = os.environ.get("SOLAR_API_URL", "").rstrip("/")
API_URL = BASE_URL + "/api/solar"
DEVICE_API_URL = BASE_URL + "/api/solar/device"
TOKEN = os.environ.get("SOLAR_RPI_TOKEN", "")
INTERVAL = max(10, int(os.environ.get("TELEMETRY_INTERVAL_SECONDS", "60")))
RELAY_POLL_INTERVAL = max(2, int(os.environ.get("RELAY_POLL_INTERVAL_SECONDS", "5")))
DHT_ENABLED = os.environ.get("DHT_ENABLED", "1") == "1"
DHT_GPIO = int(os.environ.get("DHT_GPIO", "26"))
DHT_MPPT_ENABLED = os.environ.get("DHT_MPPT_ENABLED", "1") == "1"
DHT_MPPT_GPIO = int(os.environ.get("DHT_MPPT_GPIO", "21"))
DHT_READ_RETRIES = max(1, int(os.environ.get("DHT_READ_RETRIES", "3")))
DHT_MAX_TEMPERATURE_STEP_C = max(0.5, float(os.environ.get("DHT_MAX_TEMPERATURE_STEP_C", "3")))
DHT_MAX_HUMIDITY_STEP_PERCENT = max(1.0, float(os.environ.get("DHT_MAX_HUMIDITY_STEP_PERCENT", "15")))
NANO_PORT = os.environ.get("ARDUINO_SERIAL_PORT", "").strip()
NANO_BAUD = int(os.environ.get("ARDUINO_SERIAL_BAUD", "115200"))
NANO_TIMEOUT = max(3.0, float(os.environ.get("ARDUINO_READ_TIMEOUT_SECONDS", "6")))
MQ9_ALARM_ENABLED = os.environ.get("MQ9_ALARM_ENABLED", "1") == "1"
MQ9_CRITICAL_RAW = max(1, int(os.environ.get("MQ9_CRITICAL_RAW", "833")))
MQ9_ALARM_CONSECUTIVE_SAMPLES = max(1, int(os.environ.get("MQ9_ALARM_CONSECUTIVE_SAMPLES", "3")))
MQ9_ALARM_LATCH_FILE = Path(os.environ.get("MQ9_ALARM_LATCH_FILE", "/home/ft-891/mq9-alarm-latched.json"))
MQ9_ALARM_RESET_MARKER = -1
RELAY_ACTIVE_LOW = os.environ.get("RELAY_ACTIVE_LOW", "1") == "1"
RELAY_PINS = {
    "solar1": int(os.environ.get("RELAY_SOLAR1_GPIO", "5")),
    "solar2": int(os.environ.get("RELAY_SOLAR2_GPIO", "6")),
    "battery": int(os.environ.get("RELAY_BATTERY_GPIO", "13")),
    "bufik": int(os.environ.get("RELAY_BUFIK_GPIO", "16")),
    "fan12v": int(os.environ.get("RELAY_FAN12V_GPIO", "19")),
    "fan24v": int(os.environ.get("RELAY_FAN24V_GPIO", "20")),
}

if not BASE_URL or not TOKEN:
    raise SystemExit("Nastav SOLAR_API_URL a SOLAR_RPI_TOKEN.")


def optional_device(factory, name):
    try:
        return factory()
    except (OSError, RuntimeError, ValueError) as error:
        print(f"senzor {name} neni dostupny: {error}", flush=True)
        return None


class NanoTelemetry:
    def __init__(self):
        self.connection = None

    def candidate_ports(self):
        if NANO_PORT:
            return [NANO_PORT]
        detected = list(list_ports.comports())
        detected.sort(key=lambda port: (
            not any(name in f"{port.description} {port.manufacturer} {port.hwid}".lower()
                    for name in ("arduino", "ch340", "wch", "ftdi", "usb serial")),
            port.device,
        ))
        candidates = [port.device for port in detected]
        candidates.extend(glob.glob("/dev/serial/by-id/*"))
        candidates.extend(glob.glob("/dev/ttyUSB*"))
        candidates.extend(glob.glob("/dev/ttyACM*"))
        return list(dict.fromkeys(candidates))

    def close(self):
        if self.connection is not None:
            try:
                self.connection.close()
            except serial.SerialException:
                pass
            self.connection = None

    def connect(self):
        self.close()
        errors = []
        for port in self.candidate_ports():
            try:
                connection = serial.Serial(port, NANO_BAUD, timeout=1.0)
                # Classic Nano se po otevreni portu muze resetovat pres DTR.
                time.sleep(2.5)
                connection.reset_input_buffer()
                self.connection = connection
                print(f"Arduino Nano pripojeno: {port} @ {NANO_BAUD}", flush=True)
                return
            except (OSError, serial.SerialException) as error:
                errors.append(f"{port}: {error}")
        detail = "; ".join(errors) if errors else "nenalezen zadny seriovy port"
        raise RuntimeError(f"Arduino Nano nelze otevrit ({detail})")

    def read(self):
        if self.connection is None or not self.connection.is_open:
            self.connect()
        deadline = time.monotonic() + NANO_TIMEOUT
        try:
            self.connection.reset_input_buffer()
            while time.monotonic() < deadline:
                raw_line = self.connection.readline()
                if not raw_line:
                    continue
                try:
                    payload = json.loads(raw_line.decode("utf-8", errors="strict"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue
                if payload.get("type") == "qso_telemetry" and payload.get("version") == 1:
                    return payload
        except (OSError, serial.SerialException) as error:
            self.close()
            raise RuntimeError(f"chyba USB spojeni s Arduino Nano: {error}") from error
        self.close()
        raise RuntimeError("Arduino Nano neposlalo platny JSON v casovem limitu")


class Dht11Reader:
    def __init__(self, gpio, name):
        self.sensor = adafruit_dht.DHT11(getattr(board, f"D{gpio}"))
        self.name = name
        self.last_valid_reading = None

    def read(self):
        last_error = None
        for attempt in range(DHT_READ_RETRIES):
            try:
                temperature = self.sensor.temperature
                humidity = self.sensor.humidity
                if temperature is None or humidity is None:
                    raise RuntimeError("cidlo nevratilo platna data")
                temperature = float(temperature)
                humidity = float(humidity)
                if not -40.0 <= temperature <= 80.0 or not 0.0 <= humidity <= 100.0:
                    raise ValueError("hodnota je mimo rozsah")
                if self.last_valid_reading is not None:
                    previous_temperature, previous_humidity = self.last_valid_reading
                    if abs(temperature - previous_temperature) > DHT_MAX_TEMPERATURE_STEP_C:
                        raise ValueError("skok teploty")
                    if abs(humidity - previous_humidity) > DHT_MAX_HUMIDITY_STEP_PERCENT:
                        raise ValueError("skok vlhkosti")
                self.last_valid_reading = (temperature, humidity)
                return temperature, humidity
            except (RuntimeError, OSError, ValueError) as error:
                last_error = error
                if attempt + 1 < DHT_READ_RETRIES:
                    time.sleep(2)
        print(f"{self.name} neni dostupny: {last_error}", flush=True)
        return self.last_valid_reading if self.last_valid_reading is not None else (None, None)

    def close(self):
        self.sensor.exit()


dht_room = optional_device(lambda: Dht11Reader(DHT_GPIO, f"DHT11 chata GPIO{DHT_GPIO}"), "DHT11 chata") if DHT_ENABLED else None
dht_mppt = optional_device(lambda: Dht11Reader(DHT_MPPT_GPIO, f"DHT11 MPPT GPIO{DHT_MPPT_GPIO}"), "DHT11 MPPT") if DHT_MPPT_ENABLED else None
nano = NanoTelemetry()
gpio_handle = lgpio.gpiochip_open(0)
relay_states = {name: False for name in RELAY_PINS}
alarm_latched = False
alarm_trigger_raw = None
critical_sample_count = 0

try:
    if MQ9_ALARM_LATCH_FILE.exists():
        saved_alarm = json.loads(MQ9_ALARM_LATCH_FILE.read_text(encoding="utf-8"))
        alarm_latched = saved_alarm.get("active") is True
        alarm_trigger_raw = float(saved_alarm["trigger_raw"]) if alarm_latched else None
except (OSError, ValueError, TypeError, json.JSONDecodeError, KeyError) as error:
    raise SystemExit(f"Neplatny soubor MQ-9 alarmu {MQ9_ALARM_LATCH_FILE}: {error}")


def relay_level(is_on):
    return (0 if is_on else 1) if RELAY_ACTIVE_LOW else (1 if is_on else 0)


def setup_relays():
    for pin in RELAY_PINS.values():
        lgpio.gpio_claim_output(gpio_handle, pin, relay_level(False))


def apply_relay(name, is_on):
    pin = RELAY_PINS[name]
    lgpio.gpio_write(gpio_handle, pin, relay_level(is_on))
    relay_states[name] = is_on


def set_all_relays_off():
    for name in RELAY_PINS:
        apply_relay(name, False)


def send_emergency_stop():
    body = json.dumps({"emergencyStop": True, "reason": "mq9"}).encode("utf-8")
    request = urllib.request.Request(DEVICE_API_URL, data=body, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
        "User-Agent": "qso-blog-rpi-fire-protection/1.0",
    }, method="POST")
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"server returned HTTP {response.status}")


def latch_mq9_alarm(raw_value):
    global alarm_latched, alarm_trigger_raw
    alarm_latched = True
    alarm_trigger_raw = raw_value
    MQ9_ALARM_LATCH_FILE.write_text(json.dumps({
        "active": True,
        "trigger_raw": raw_value,
        "triggered_at_unix": time.time(),
    }), encoding="utf-8")
    os.chmod(MQ9_ALARM_LATCH_FILE, 0o600)
    set_all_relays_off()
    print(f"POPLACH MQ-9: RAW {raw_value:.0f}, vsechna rele nouzove vypnuta", flush=True)


def clear_mq9_alarm():
    global alarm_latched, alarm_trigger_raw, critical_sample_count
    set_all_relays_off()
    alarm_latched = False
    alarm_trigger_raw = None
    critical_sample_count = 0
    try:
        MQ9_ALARM_LATCH_FILE.unlink(missing_ok=True)
    except OSError as error:
        alarm_latched = True
        raise RuntimeError(f"soubor alarmu nelze odstranit: {error}") from error
    print("MQ-9 poplach potvrzen z webu; vsechna rele zustavaji vypnuta", flush=True)


def check_mq9_alarm(nano_payload):
    global critical_sample_count
    if not MQ9_ALARM_ENABLED or alarm_latched:
        if alarm_latched:
            set_all_relays_off()
        return
    raw_value = payload_number(nano_payload, "mq9_raw")
    if raw_value is not None and raw_value >= MQ9_CRITICAL_RAW:
        critical_sample_count += 1
        print(f"MQ-9 kriticky vzorek {critical_sample_count}/{MQ9_ALARM_CONSECUTIVE_SAMPLES}: RAW {raw_value:.0f}", flush=True)
        if critical_sample_count >= MQ9_ALARM_CONSECUTIVE_SAMPLES:
            latch_mq9_alarm(raw_value)
            try:
                send_emergency_stop()
            except (RuntimeError, urllib.error.URLError, TimeoutError, OSError) as error:
                print(f"MQ-9 alarm: server zatim nepotvrdil nouzove vypnuti: {error}", flush=True)
    else:
        critical_sample_count = 0


def fetch_relay_states(nano_payload):
    request = urllib.request.Request(DEVICE_API_URL, headers={
        "Authorization": f"Bearer {TOKEN}",
        "User-Agent": "qso-blog-rpi-relay/1.0",
    }, method="GET")
    with urllib.request.urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
    telemetry = payload.get("telemetry") or {}
    reset_requested = (
        telemetry.get("mq9_alarm") is False
        and payload_number(telemetry, "mq9_alarm_trigger_raw") == MQ9_ALARM_RESET_MARKER
    )
    if alarm_latched:
        current_raw = payload_number(nano_payload or {}, "mq9_raw")
        if reset_requested and current_raw is not None and current_raw < MQ9_CRITICAL_RAW:
            clear_mq9_alarm()
            return {name: False for name in RELAY_PINS}, True
        set_all_relays_off()
        if reset_requested:
            measured = "nedostupna" if current_raw is None else f"RAW {current_raw:.0f}"
            print(f"MQ-9 reset odmitnut, aktualni hodnota je {measured}", flush=True)
        send_emergency_stop()
        return {name: False for name in RELAY_PINS}, False
    for name, is_on in payload.get("relays", {}).items():
        if name in RELAY_PINS and isinstance(is_on, bool) and relay_states[name] != is_on:
            apply_relay(name, is_on)
    return payload.get("relays", {}), False


def payload_number(payload, key):
    value = payload.get(key)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return float(value)
    return None


def read_rpi_cpu_temperature():
    try:
        return float(Path("/sys/class/thermal/thermal_zone0/temp").read_text().strip()) / 1000.0
    except (OSError, ValueError):
        return None


def read_sensors(nano_payload):
    object_temperature, object_humidity = dht_room.read() if dht_room else (None, None)
    mppt_temperature, _mppt_humidity = dht_mppt.read() if dht_mppt else (None, None)
    acs3_current = payload_number(nano_payload, "acs3_current")
    return {
        "arduino_uptime_ms": payload_number(nano_payload, "uptime_ms"),
        "rpi_cpu_temperature": read_rpi_cpu_temperature(),
        "object_temperature": object_temperature,
        "object_humidity": object_humidity,
        "mppt_temperature": mppt_temperature,
        "battery_temperature": payload_number(nano_payload, "battery_temperature"),
        "outside_temperature": payload_number(nano_payload, "outside_temperature"),
        "outside_pressure": payload_number(nano_payload, "outside_pressure"),
        "battery_pressure": payload_number(nano_payload, "battery_pressure"),
        "battery_voltage": payload_number(nano_payload, "ina219_bus_voltage"),
        # INA219 je v teto instalaci pouze voltmetr; proud meri ACS712.
        "ina219_current": None,
        "ina219_power": None,
        "ina219_shunt_voltage_mv": None,
        "solar1_current": payload_number(nano_payload, "acs1_current"),
        "solar2_current": payload_number(nano_payload, "acs2_current"),
        "battery_current": acs3_current,
        "acs1_raw": payload_number(nano_payload, "acs1_raw"),
        "acs1_voltage": payload_number(nano_payload, "acs1_voltage"),
        "acs2_raw": payload_number(nano_payload, "acs2_raw"),
        "acs2_voltage": payload_number(nano_payload, "acs2_voltage"),
        "acs3_raw": payload_number(nano_payload, "acs3_raw"),
        "acs3_voltage": payload_number(nano_payload, "acs3_voltage"),
        "mq9_raw": payload_number(nano_payload, "mq9_raw"),
        "mq9_voltage": payload_number(nano_payload, "mq9_voltage"),
        "mq9_alarm": alarm_latched,
        "mq9_alarm_trigger_raw": alarm_trigger_raw,
    }


def send(payload):
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(API_URL, data=body, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
        "User-Agent": "qso-blog-rpi-telemetry/2.0",
    }, method="POST")
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"server returned HTTP {response.status}")


try:
    setup_relays()
    next_telemetry = 0.0
    next_relay_poll = 0.0
    latest_nano_payload = None
    if alarm_latched:
        set_all_relays_off()
        print(f"POPLACH MQ-9 zustava aktivni po restartu, spousteci RAW {alarm_trigger_raw:.0f}", flush=True)
    while True:
        try:
            latest_nano_payload = nano.read()
            check_mq9_alarm(latest_nano_payload)
        except (RuntimeError, OSError) as error:
            print(f"chyba rychle kontroly MQ-9: {error}", flush=True)
        now = time.monotonic()
        if now >= next_relay_poll:
            try:
                states, alarm_reset = fetch_relay_states(latest_nano_payload)
                print("rele: " + json.dumps(states, ensure_ascii=False), flush=True)
                if alarm_reset:
                    next_telemetry = 0.0
            except (RuntimeError, urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
                print(f"chyba stavu rele: {error}", flush=True)
            next_relay_poll = now + RELAY_POLL_INTERVAL
        if now >= next_telemetry and latest_nano_payload is not None:
            try:
                payload = read_sensors(latest_nano_payload)
                send(payload)
                print("odeslano: " + json.dumps(payload, ensure_ascii=False), flush=True)
            except (RuntimeError, urllib.error.URLError, TimeoutError, OSError) as error:
                print(f"chyba mereni/odeslani: {error}", flush=True)
            next_telemetry = now + INTERVAL
        time.sleep(1)
finally:
    for name in RELAY_PINS:
        try:
            apply_relay(name, False)
        except OSError:
            pass
    lgpio.gpiochip_close(gpio_handle)
    if dht_room:
        dht_room.close()
    if dht_mppt:
        dht_mppt.close()
    nano.close()
