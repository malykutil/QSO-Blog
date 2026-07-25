# Zapojení senzorů pro Raspberry Pi 3B+

Používej BCM číslování GPIO. Všechny senzory musí mít společnou zem. Raspberry Pi pracuje s 3,3 V logikou; 5V analogový výstup nesmí přímo do GPIO.

## I²C větev

| Zařízení | VCC | GND | SDA | SCL | Adresa |
|---|---:|---:|---:|---:|---:|
| BMP280 u baterie | 3V3, pin 1 | GND, pin 6 | GPIO2, pin 3 | GPIO3, pin 5 | 0x76 |
| BMP280 venku | 3V3, pin 17 | GND, pin 9 | GPIO2, pin 3 | GPIO3, pin 5 | 0x77 |
| INA219 baterie | 3V3, pin 17 | GND, pin 14 | GPIO2, pin 3 | GPIO3, pin 5 | 0x40 |

Na jednom I²C busu musí mít dva BMP280 rozdílné adresy. U jednoho modulu nastav SDO/ADDR na GND (0x76), u druhého nech SDO/ADDR na 3V3 (0x77). Pokud modul nemá vyvedený SDO/ADDR, použij TCA9548A multiplexer.

## Jednovodičové čidlo

| Zařízení | VCC | DATA | GND |
|---|---:|---:|---:|
| DHT11 objekt | 3V3, pin 1 | BCM GPIO26, fyzický pin 37 | GND, pin 39 |

## INA219 v napájecí cestě baterie

`VIN+` připoj na kladný pól baterie a `VIN-` na kladný pól napájené větve/zátěže. Baterii nezapojuj obráceně. INA219 měří napětí za modulem a proud tekoucí přes VIN+ → VIN-.

## ACS712 a MQ-9

ACS712 (3 kusy) i MQ-9 mají analogový výstup. Raspberry Pi nemá analogový vstup, takže jejich OUT nepřipojuj přímo na GPIO. Přidej ADC, například ADS1115 (I²C) nebo MCP3008 (SPI), a teprve potom doplň mapování kanálů do uploaderu. Web už má připravené proudové kanály Solár 1, Solár 2, Baterie a pole MQ-9; do té doby se zobrazí prázdná hodnota.

## Instalace na RPi

```bash
python3 -m pip install --break-system-packages adafruit-circuitpython-dht adafruit-circuitpython-bmp280 adafruit-circuitpython-ina219 adafruit-blinka
sudo cp rpi-telemetry.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rpi-telemetry.service
sudo journalctl -u rpi-telemetry -f
```

V `/home/ft-891/qso-blog.env` nastav `SOLAR_API_URL`, `SOLAR_RPI_TOKEN`, `BMP_BATTERY_ADDRESS=0x76`, `BMP_OUTSIDE_ADDRESS=0x77` a `TELEMETRY_INTERVAL_SECONDS=10`.
