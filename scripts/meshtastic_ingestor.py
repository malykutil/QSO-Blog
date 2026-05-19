#!/usr/bin/env python3
import base64
import json
import os
import signal
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import paho.mqtt.client as mqtt
from dotenv import load_dotenv
from supabase import Client, create_client


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def first_nonempty_string(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str):
            text = value.strip()
            if text:
                return text
    return None


def parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def normalize_node_id(value: Any) -> str | None:
    if value is None:
        return None

    if isinstance(value, int):
        return f"!{value:08x}"

    text = str(value).strip()
    if not text:
        return None

    if text.startswith("!"):
        return text.lower()

    if text.startswith("0x"):
        try:
            return f"!{int(text, 16):08x}"
        except ValueError:
            return text

    if text.isdigit():
        try:
            return f"!{int(text):08x}"
        except ValueError:
            return text

    return text.lower()


def decode_packet_shape(message: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    packet = message.get("packet")
    if isinstance(packet, dict):
        decoded = packet.get("decoded") if isinstance(packet.get("decoded"), dict) else {}
        parsed_payload = decoded.get("parsed_payload") if isinstance(decoded.get("parsed_payload"), dict) else {}
        return packet, decoded, parsed_payload

    mesh_packet = message.get("mesh_packet")
    if isinstance(mesh_packet, dict):
        decoded = mesh_packet.get("decoded") if isinstance(mesh_packet.get("decoded"), dict) else {}
        parsed_payload = decoded.get("parsed_payload") if isinstance(decoded.get("parsed_payload"), dict) else {}
        return mesh_packet, decoded, parsed_payload

    if isinstance(message.get("payload"), dict):
        from_node = normalize_node_id(message.get("fromId")) or normalize_node_id(message.get("sender")) or normalize_node_id(message.get("from"))
        to_node = normalize_node_id(message.get("toId")) or normalize_node_id(message.get("to"))
        parsed_payload = dict(message.get("payload") or {})
        if from_node and "id" not in parsed_payload:
            parsed_payload["id"] = from_node
        if message.get("type") and "portnum" not in parsed_payload:
            parsed_payload["portnum"] = message.get("type")

        packet = {
            "from": from_node,
            "to": to_node,
            "rx_snr": message.get("snr"),
            "rx_rssi": message.get("rssi"),
            "hop_limit": message.get("hop_limit") or message.get("hop_start"),
        }
        decoded = {"portnum": message.get("type")}
        return packet, decoded, parsed_payload

    decoded = message.get("decoded") if isinstance(message.get("decoded"), dict) else {}
    parsed_payload = decoded.get("parsed_payload") if isinstance(decoded.get("parsed_payload"), dict) else {}
    return message, decoded, parsed_payload


def extract_coordinates(parsed_payload: dict[str, Any]) -> tuple[float | None, float | None]:
    lat = as_float(parsed_payload.get("latitude"))
    lon = as_float(parsed_payload.get("longitude"))
    if lat is not None and lon is not None:
        return lat, lon

    lat_i = as_int(parsed_payload.get("latitude_i"))
    lon_i = as_int(parsed_payload.get("longitude_i"))
    if lat_i is not None and lon_i is not None:
        return lat_i / 1e7, lon_i / 1e7

    return None, None


@dataclass
class Config:
    supabase_url: str
    supabase_service_role_key: str
    mqtt_host: str
    mqtt_port: int
    mqtt_username: str | None
    mqtt_password: str | None
    mqtt_topic: str
    mqtt_client_id: str
    mqtt_tls: bool
    mqtt_keepalive: int


class MeshtasticIngestor:
    def __init__(self, config: Config):
        self.config = config
        self.supabase: Client = create_client(config.supabase_url, config.supabase_service_role_key)
        self.running = True
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=config.mqtt_client_id,
            clean_session=True,
        )
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect

        if config.mqtt_username:
            self.client.username_pw_set(config.mqtt_username, config.mqtt_password)
        if config.mqtt_tls:
            self.client.tls_set()

    def on_connect(self, client: mqtt.Client, userdata: Any, flags: Any, reason_code: Any, properties: Any = None):
        code = reason_code.value if hasattr(reason_code, "value") else int(reason_code)
        if code != 0:
            print(f"[MQTT] Připojení selhalo, code={code} ({reason_code})", flush=True)
            return

        print(f"[MQTT] Připojeno, subscribe {self.config.mqtt_topic}", flush=True)
        client.subscribe(self.config.mqtt_topic, qos=0)

    def on_disconnect(self, client: mqtt.Client, userdata: Any, disconnect_flags: Any, reason_code: Any, properties: Any = None):
        if self.running:
            print(f"[MQTT] Odpojeno, code={reason_code}. Čekám na reconnect...", flush=True)

    def upsert_node(self, topic: str, packet: dict[str, Any], decoded: dict[str, Any], parsed_payload: dict[str, Any]):
        user_payload = parsed_payload.get("user") if isinstance(parsed_payload.get("user"), dict) else {}
        node_id = (
            normalize_node_id(parsed_payload.get("id"))
            or normalize_node_id(parsed_payload.get("fromId"))
            or normalize_node_id(parsed_payload.get("sender"))
            or normalize_node_id(user_payload.get("id") if isinstance(user_payload, dict) else None)
            or normalize_node_id(packet.get("from"))
        )
        if not node_id:
            return

        lat, lon = extract_coordinates(parsed_payload)
        metrics = parsed_payload.get("device_metrics") if isinstance(parsed_payload.get("device_metrics"), dict) else {}

        node_payload: dict[str, Any] = {
            "node_id": node_id,
            "snr": as_float(packet.get("rx_snr")),
            "rssi": as_float(packet.get("rx_rssi")),
            "channel": topic,
            "last_payload_type": parsed_payload.get("portnum") or decoded.get("portnum"),
            "metadata": parsed_payload if parsed_payload else {},
            "last_seen": utc_now_iso(),
        }

        short_name = first_nonempty_string(
            parsed_payload.get("short_name"),
            parsed_payload.get("shortname"),
            parsed_payload.get("shortName"),
            user_payload.get("short_name") if isinstance(user_payload, dict) else None,
            user_payload.get("shortname") if isinstance(user_payload, dict) else None,
            user_payload.get("shortName") if isinstance(user_payload, dict) else None,
        )
        long_name = first_nonempty_string(
            parsed_payload.get("long_name"),
            parsed_payload.get("longname"),
            parsed_payload.get("longName"),
            parsed_payload.get("name"),
            user_payload.get("long_name") if isinstance(user_payload, dict) else None,
            user_payload.get("longname") if isinstance(user_payload, dict) else None,
            user_payload.get("longName") if isinstance(user_payload, dict) else None,
            user_payload.get("name") if isinstance(user_payload, dict) else None,
        )
        hw_model = first_nonempty_string(
            parsed_payload.get("hw_model"),
            parsed_payload.get("hwModel"),
            user_payload.get("hw_model") if isinstance(user_payload, dict) else None,
            user_payload.get("hwModel") if isinstance(user_payload, dict) else None,
        )
        role_value = first_nonempty_string(
            parsed_payload.get("role"),
            user_payload.get("role") if isinstance(user_payload, dict) else None,
        )

        if short_name is not None:
            node_payload["short_name"] = short_name
        if long_name is not None:
            node_payload["long_name"] = long_name
        if hw_model is not None:
            node_payload["hw_model"] = hw_model
        if role_value is not None:
            node_payload["role"] = role_value
        if lat is not None and lon is not None:
            node_payload["lat"] = lat
            node_payload["lon"] = lon

        battery_level = as_int(metrics.get("battery_level"))
        voltage = as_float(metrics.get("voltage"))
        channel_utilization = as_float(metrics.get("channel_utilization"))
        air_util_tx = as_float(metrics.get("air_util_tx"))
        if battery_level is not None:
            node_payload["battery_level"] = battery_level
        if voltage is not None:
            node_payload["voltage"] = voltage
        if channel_utilization is not None:
            node_payload["channel_utilization"] = channel_utilization
        if air_util_tx is not None:
            node_payload["air_util_tx"] = air_util_tx

        self.supabase.table("meshtastic_nodes").upsert(node_payload, on_conflict="node_id").execute()

    def insert_packet(self, topic: str, message: dict[str, Any], packet: dict[str, Any], decoded: dict[str, Any], parsed_payload: dict[str, Any]):
        node_id = normalize_node_id(parsed_payload.get("id")) or normalize_node_id(packet.get("from"))

        packet_payload: dict[str, Any] = {
            "node_id": node_id,
            "from_node": normalize_node_id(packet.get("from")),
            "to_node": normalize_node_id(packet.get("to")),
            "portnum": str(parsed_payload.get("portnum") or decoded.get("portnum") or "") or None,
            "payload_text": parsed_payload.get("text") or parsed_payload.get("message"),
            "payload_json": parsed_payload if parsed_payload else message,
            "hop_limit": as_int(packet.get("hop_limit")),
            "snr": as_float(packet.get("rx_snr")),
            "rssi": as_float(packet.get("rx_rssi")),
            "channel": topic,
        }
        self.supabase.table("meshtastic_packets").insert(packet_payload).execute()

    def insert_raw_packet(self, topic: str, payload_bytes: bytes):
        payload_text = payload_bytes.decode("utf-8", errors="ignore").strip()
        payload_base64 = base64.b64encode(payload_bytes).decode("ascii")

        packet_payload = {
            "node_id": None,
            "from_node": None,
            "to_node": None,
            "portnum": "raw",
            "payload_text": payload_text[:2000] if payload_text else None,
            "payload_json": {
                "format": "raw",
                "raw_base64": payload_base64,
            },
            "hop_limit": None,
            "snr": None,
            "rssi": None,
            "channel": topic,
        }
        self.supabase.table("meshtastic_packets").insert(packet_payload).execute()

    def on_message(self, client: mqtt.Client, userdata: Any, msg: mqtt.MQTTMessage):
        try:
            payload_bytes = bytes(msg.payload)
            payload_text = payload_bytes.decode("utf-8", errors="ignore")

            message: dict[str, Any] | None = None
            try:
                maybe_message = json.loads(payload_text)
                if isinstance(maybe_message, dict):
                    message = maybe_message
            except Exception:
                message = None

            if message is None:
                self.insert_raw_packet(msg.topic, payload_bytes)
                return

            packet, decoded, parsed_payload = decode_packet_shape(message)
            self.insert_packet(msg.topic, message, packet, decoded, parsed_payload)
            self.upsert_node(msg.topic, packet, decoded, parsed_payload)
        except Exception as exc:
            print(f"[INGEST] Chyba při zpracování packetu: {exc}", flush=True)

    def run(self):
        print("[INGEST] Spouštím Meshtastic MQTT ingestor...", flush=True)
        self.client.connect(self.config.mqtt_host, self.config.mqtt_port, keepalive=self.config.mqtt_keepalive)
        self.client.loop_start()

        try:
            while self.running:
                time.sleep(1)
        finally:
            self.client.loop_stop()
            self.client.disconnect()
            print("[INGEST] Ukončeno.", flush=True)


def load_config() -> Config:
    load_dotenv()

    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    mqtt_host = os.getenv("MQTT_HOST", "").strip()

    if not supabase_url or not supabase_service_role_key or not mqtt_host:
        raise RuntimeError("Chybí SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY nebo MQTT_HOST v .env")

    return Config(
        supabase_url=supabase_url,
        supabase_service_role_key=supabase_service_role_key,
        mqtt_host=mqtt_host,
        mqtt_port=int(os.getenv("MQTT_PORT", "1883")),
        mqtt_username=os.getenv("MQTT_USERNAME"),
        mqtt_password=os.getenv("MQTT_PASSWORD"),
        mqtt_topic=os.getenv("MQTT_TOPIC", "msh/#"),
        mqtt_client_id=os.getenv("MQTT_CLIENT_ID", "ok2mkj-rpi-ingestor"),
        mqtt_tls=parse_bool(os.getenv("MQTT_TLS"), default=False),
        mqtt_keepalive=int(os.getenv("MQTT_KEEPALIVE", "60")),
    )


def main():
    config = load_config()
    ingestor = MeshtasticIngestor(config)

    def handle_signal(signum: int, frame: Any):
        print(f"[INGEST] Signál {signum}, ukončuji...", flush=True)
        ingestor.running = False

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    ingestor.run()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[FATAL] {exc}", flush=True)
        sys.exit(1)
