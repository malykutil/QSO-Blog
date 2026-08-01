# Arduino Nano – senzory přes USB do Raspberry Pi

Firmware čte všechny připojené senzory a každé 2 sekundy posílá po USB jeden
řádek platného JSONu. Raspberry Pi jej načítá pomocí `scripts/rpi_telemetry.py`
a odesílá do webového API `/api/solar`.

## Zapojení

| Čidlo | Arduino Nano | Poznámka |
|---|---|---|
| MQ-9 AO | A0 | rozsah vstupu 0–5 V |
| ACS712 č. 1 | A1 | webové pole Solar 1 |
| ACS712 č. 2 | A2 | webové pole Solar 2 |
| ACS712 č. 3 | A3 | webové pole proud baterie |
| BMP280 č. 1 | A4/SDA, A5/SCL | adresa 0x76, teplota baterie |
| BMP280 č. 2 | A4/SDA, A5/SCL | adresa 0x77, venkovní teplota a tlak |
| INA219 | A4/SDA, A5/SCL | adresa 0x40, napětí baterie |
| Raspberry Pi | USB | napájení, programování a telemetrie |

Všechna čidla musí mít společnou zem. Dva BMP280 musí mít rozdílné adresy
0x76 a 0x77; u běžných modulů se adresa volí pinem SDO. I²C zařízení na Nano
připojuj podle napěťových požadavků konkrétních modulů. Samotný čip BMP280 i
INA219 je 3,3V, některé breakout moduly však mají regulátor a převod úrovní.

Výchozí kalibrace počítá s ACS712-20A (100 mV/A, nula 2,5 V). Konstanty
`ACS_ZERO_MV` a `ACS_SENSITIVITY_MV_PER_A` ve firmware uprav podle typu a
naměřeného nulového bodu každého modulu.

## Sestavení a nahrání

```bash
pio run -d arduino_nano_adc_i2c
pio run -d arduino_nano_adc_i2c -t upload --upload-port /dev/ttyUSB0
```

Instalované Nano používá starý bootloader, proto je nastaveno
`nanoatmega328` (upload 57 600 baud). Aktuální JSON lze zkontrolovat příkazem:

```bash
pio device monitor --baud 115200 --port /dev/ttyUSB0
```
