# Arduino Nano a Raspberry Pi – sběr telemetrie

Arduino Nano čte analogová i I²C čidla. Raspberry Pi je připojené pouze přes USB,
čte JSON ze sériového portu a každých 60 sekund jej odešle do `/api/solar`.

## Zapojení k Arduino Nano

| Zařízení | Pin / sběrnice | I²C adresa | Webová hodnota |
|---|---|---:|---|
| MQ-9 AO | A0 | – | MQ-9 RAW a napětí |
| ACS712 č. 1 | A1 | – | Solární vstupní proud |
| ACS712 č. 2 | A2 | – | Proud zátěže (API pole `solar2_current`) |
| ACS712 č. 3 | A3 | – | Proud baterie |
| DHT11 v objektu | D11 | – | Teplota a vlhkost v objektu |
| DHT11 u MPPT | D12 | – | Teplota a vlhkost u MPPT |
| BMP280 u baterie | A4/SDA, A5/SCL | 0x76 | Teplota baterie |
| BMP280 venku | A4/SDA, A5/SCL | 0x77 | Venkovní teplota a tlak |
| INA219 baterie | A4/SDA, A5/SCL | 0x40 | Napětí baterie |
| INA219 zátěž | A4/SDA, A5/SCL | 0x45 | Napětí zátěže |

Na jednom I²C busu musí mít oba BMP280 i oba INA219 rozdílné adresy. Aktuálně
byly ověřeny adresy `0x40`, `0x45`, `0x76` a `0x77`. U jednoho BMP280 nastav
SDO/ADDR na GND (0x76), u druhého na VCC (0x77). Pokud modul adresu změnit
neumí, je potřeba I²C multiplexer. Všechna čidla musí mít společnou zem.

Pozor na napájecí napětí konkrétních breakout modulů. Samotné BMP280 a INA219
jsou 3,3V součástky; připojení k 5V Nano je bezpečné jen u modulů s potřebným
regulátorem/převodem úrovní. Analogové výstupy do A0–A3 nesmí překročit 5 V.

`VIN+` INA219 připoj na kladný pól měřené větve a `VIN-` směrem k zátěži. Zdroj
nezapojuj obráceně.

Oba DHT11 jsou napájené z Arduino Nano a mají společnou zem. Pokud modul nemá
vlastní pull-up rezistor, přidej mezi DATA a 5 V rezistor přibližně 4,7–10 kΩ.
RPi už DHT11 přímo nečte; teploty a vlhkosti přebírá ze sériového JSON Arduina.
Vlhkost MPPT se kvůli kompatibilitě se stávající databází ukládá do nepoužívaného
historického pole `solar1_voltage`; web ji převádí zpět na správně pojmenovanou
hodnotu `mppt_humidity`. Napětí solárního panelu se v této instalaci neměří.

Výkon baterie se počítá jako napětí INA219 `0x40` × proud ACS712 A3. Výkon
zátěže je napětí INA219 `0x45` × proud ACS712 A2. Kladný proud baterie znamená
nabíjení a záporný vybíjení.

## Firmware Arduino Nano

Z kořene repozitáře:

```bash
pio run -d arduino_nano_adc_i2c
pio run -d arduino_nano_adc_i2c -t upload --upload-port /dev/ttyUSB0
```

Instalované Nano je na stabilní cestě
`/dev/serial/by-id/usb-1a86_USB2.0-Ser_-if00-port0` a používá starý bootloader
(`nanoatmega328`, upload 57 600 baud).

## Instalace služby na RPi

```bash
cd QSO-Blog/scripts
chmod +x install-rpi-telemetry.sh
./install-rpi-telemetry.sh
nano /home/ft-891/qso-blog.env
sudo systemctl daemon-reload
sudo systemctl enable --now rpi-telemetry
sudo journalctl -u rpi-telemetry -f
```

Do `/home/ft-891/qso-blog.env` nastav `SOLAR_API_URL`, stejný
`SOLAR_RPI_TOKEN` jako ve Vercelu a `TELEMETRY_INTERVAL_SECONDS=60`.
`ARDUINO_SERIAL_PORT` může zůstat prázdný pro automatickou detekci. Pokud je na
RPi více USB převodníků, nastav stabilní cestu z `/dev/serial/by-id/`.

Služba běží jako uživatel `ft-891`; instalační skript jej přidá do skupiny
`dialout`, aby mohl otevřít `/dev/ttyUSB*` nebo `/dev/ttyACM*`.

## Doplňková ochrana MQ-9

RPi čte MQ-9 z USB přibližně každé 2 sekundy. Tři po sobě jdoucí vzorky nad
`MQ9_CRITICAL_RAW=833` vyvolají trvalý poplach: všechna lokální relé se okamžitě
vypnou, stejný nouzový stav se odešle na server a alarm se uloží do
`/home/ft-891/mq9-alarm-latched.json`. Výpadek internetu ani restart služby
alarm nezruší.

Po fyzické kontrole objektu lze alarm potvrdit na webu `/solar`. Tlačítko je
dostupné pouze po přihlášení. RPi příkaz přijme jen s čerstvými daty a když
aktuální MQ-9 hodnota už není kritická. Reset ponechá všechna relé vypnutá.

Nouzový ruční reset na RPi:

```bash
sudo systemctl stop rpi-telemetry
rm /home/ft-891/mq9-alarm-latched.json
sudo systemctl start rpi-telemetry
```

MQ-9 reaguje na CO a hořlavé plyny, ale nejde o certifikovaný kouřový nebo
požární hlásič. Tato automatika je pouze doplňková ochrana. V objektu musí být
samostatný certifikovaný kouřový a CO hlásič s vlastní sirénou a napájením.

## Waveshare UPS HAT

UPS HAT 18306 je na I²C sběrnici RPi na adrese `0x42`. Služba čte napětí a
proud z INA219. Kladný proud znamená nabíjení, záporný vybíjení. Zbývající
kapacita je orientační lineární odhad výrobce pro dvoučlánkový 18650 pack:
`(napětí - 6,0 V) / 2,4 V × 100`, omezený na 0–100 %. Nejde o údaj z BMS ani
coulomb counteru, proto se může zejména při nabíjení krátkodobě měnit.

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

Piny vedou do vstupů relé modulu, ne přímo do výkonové zátěže. Relé modul musí
mít společnou zem s Raspberry Pi a vhodné oddělení/napájení. Výchozí režim je
aktivní LOW; pro aktivní HIGH nastav `RELAY_ACTIVE_LOW=0`.

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

Při startu i ukončení služby jsou všechna relé nastavena na vypnuto.
