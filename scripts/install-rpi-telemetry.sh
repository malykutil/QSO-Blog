#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/home/ft-891"
TARGET_USER="ft-891"
SERVICE_NAME="rpi-telemetry"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

sudo apt-get update
sudo apt-get install -y python3-lgpio python3-pip
python3 -m pip install --break-system-packages \
  adafruit-circuitpython-dht \
  adafruit-circuitpython-bmp280 \
  adafruit-circuitpython-ina219 \
  adafruit-blinka \
  smbus2

sudo install -d -o "${TARGET_USER}" -g "${TARGET_USER}" "${INSTALL_DIR}"
sudo install -m 0755 "${SCRIPT_DIR}/rpi_telemetry.py" "${INSTALL_DIR}/rpi_telemetry.py"
sudo install -m 0644 "${SCRIPT_DIR}/rpi-telemetry.service" "/etc/systemd/system/${SERVICE_NAME}.service"

if [ ! -f "${INSTALL_DIR}/qso-blog.env" ]; then
  sudo install -m 0600 "${SCRIPT_DIR}/qso-blog.env.example" "${INSTALL_DIR}/qso-blog.env"
  sudo chown "${TARGET_USER}:${TARGET_USER}" "${INSTALL_DIR}/qso-blog.env"
  echo "Uprav ${INSTALL_DIR}/qso-blog.env a dopln SOLAR_RPI_TOKEN, potom spusť:"
  echo "sudo systemctl daemon-reload && sudo systemctl enable --now ${SERVICE_NAME}"
  exit 0
fi

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"
sudo systemctl --no-pager --full status "${SERVICE_NAME}" || true
