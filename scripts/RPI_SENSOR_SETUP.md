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

Alternativa s Raspberry Pi Pico: nahraj firmware z `pico_adc_i2c/`. Pico načítá ACS712 přes GP26, GP27 a GP28 a poskytuje rámec přes I²C na adrese `0x42`. Propojení Pico–Pi je GP4/SDA → GPIO2/SDA, GP5/SCL → GPIO3/SCL a společná GND. MQ-9 na standardním Pico nemá čtvrtý volný externí ADC kanál; pro něj zůstává potřeba ADS1115/MCP3008. Výstup ACS712 20A je při napájení 5 V přibližně 0–5 V, proto před Pico použij napěťový dělič (např. 10 kΩ nahoře a 20 kΩ dole) a společnou zem.

Alternativa s Arduino Nano: firmware je v `arduino_nano_adc_i2c/`. ACS712 jsou na A0–A2, MQ-9 na A3 a I²C slave adresa zůstává `0x42`. Nano 5V SDA/SCL připojuj k Raspberry Pi pouze přes obousměrný převodník úrovní.

## Instalace na RPi

Nejjednodušší instalace z naklonovaného repozitáře:

```bash
cd QSO-Blog/scripts
chmod +x install-rpi-telemetry.sh
./install-rpi-telemetry.sh
nano /home/ft-891/qso-blog.env
sudo systemctl daemon-reload
sudo systemctl enable --now rpi-telemetry
```

Do `qso-blog.env` doplň stejný `SOLAR_RPI_TOKEN`, který je nastavený ve Vercelu. Konfigurační soubor má práva pouze pro vlastníka (`0600`).

```bash
sudo apt install -y python3-lgpio
python3 -m pip install --break-system-packages adafruit-circuitpython-dht adafruit-circuitpython-bmp280 adafruit-circuitpython-ina219 adafruit-blinka
sudo cp rpi-telemetry.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rpi-telemetry.service
sudo journalctl -u rpi-telemetry -f
```

V `/home/ft-891/qso-blog.env` nastav `SOLAR_API_URL`, `SOLAR_RPI_TOKEN`, `BMP_BATTERY_ADDRESS=0x76`, `BMP_OUTSIDE_ADDRESS=0x77` a `TELEMETRY_INTERVAL_SECONDS=60`.

## Příprava relé přes GPIO

Uploader používá BCM GPIO piny bez kolize se senzory:

| Relé | BCM GPIO | Výchozí stav |
|---|---:|---|
| solar1 | 5 | vypnuto |
| solar2 | 6 | vypnuto |
| battery | 13 | vypnuto |
| bufik | 16 | vypnuto |
| fan12v | 19 | vypnuto |
| fan24v | 20 | vypnuto |

Piny vedou do vstupů relé modulu, ne přímo do výkonové zátěže. Relé modul musí mít společnou zem s Raspberry Pi a vhodné oddělení/napájení. Výchozí režim je aktivní LOW (`RELAY_ACTIVE_LOW=1`); pokud je modul aktivní HIGH, nastav `RELAY_ACTIVE_LOW=0`.

Do `/home/ft-891/qso-blog.env` lze piny přepsat například:

```bash
RELAY_ACTIVE_LOW=1
RELAY_POLL_INTERVAL_SECONDS=5
RELAY_SOLAR1_GPIO=5
RELAY_SOLAR2_GPIO=6
RELAY_BATTERY_GPIO=13
RELAY_BUFIK_GPIO=16
RELAY_FAN12V_GPIO=19
RELAY_FAN24V_GPIO=20
```

Po startu jsou všechna relé nastavena na vypnuto. RPi potom každých 5 sekund načítá potvrzený stav z `/api/solar/device` a fyzické výstupy podle něj nastaví. Při ukončení služby se relé opět vypnou.
