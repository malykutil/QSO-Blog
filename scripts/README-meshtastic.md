# Meshtastic ingestor (RPi 3)

## 1) Připrav adresář na Raspberry Pi

```bash
mkdir -p ~/meshtastic-ingestor
cd ~/meshtastic-ingestor
python3 -m venv .venv
source .venv/bin/activate
```

## 2) Nahraj soubory z projektu

- `scripts/meshtastic_ingestor.py`
- `scripts/requirements-meshtastic.txt`
- `scripts/meshtastic.env.example`
- `scripts/meshtastic-ingestor.service.example`

Pak:

```bash
pip install -r requirements-meshtastic.txt
cp meshtastic.env.example .env
nano .env
```

Vyplň hlavně:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MQTT_HOST`
- `MQTT_TOPIC`

## 3) Otestuj ručně

```bash
source .venv/bin/activate
python meshtastic_ingestor.py
```

## 4) Spusť jako systemd službu

```bash
sudo cp meshtastic-ingestor.service.example /etc/systemd/system/meshtastic-ingestor.service
sudo systemctl daemon-reload
sudo systemctl enable meshtastic-ingestor
sudo systemctl start meshtastic-ingestor
sudo systemctl status meshtastic-ingestor
```

Logy:

```bash
journalctl -u meshtastic-ingestor -f
```
