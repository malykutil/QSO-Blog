# Pico jako ADC přes I²C

Firmware pro Raspberry Pi Pico (RP2040) jako I²C slave na adrese `0x42`.
Raspberry Pi je I²C master a načítá 24B rámec od registru `0x10`.

## ADC kanály

- ACS712 #1: GP26 / ADC0, fyzický pin 31
- ACS712 #2: GP27 / ADC1, fyzický pin 32
- ACS712 #3: GP28 / ADC2, fyzický pin 34
- MQ-9: není připojen přímo — standardní Pico má jen tři externí ADC GPIO. Pro MQ-9 přidej ADS1115 nebo MCP3008.

Výstup firmware obsahuje raw hodnoty i napětí naměřené na pinech Pico. Proud ACS712 se dopočítává na Raspberry Pi po kalibraci nulového bodu a citlivosti.

## I²C propojení s Raspberry Pi

| Pico | Raspberry Pi |
|---|---|
| GP4 SDA, pin 6 | GPIO2 SDA, pin 3 |
| GP5 SCL, pin 7 | GPIO3 SCL, pin 5 |
| GND, pin 3 | GND, pin 6 |

Použij 3,3V pull-up rezistory na SDA/SCL. Pico nepřipojuj na 5V logiku.

## Build

Nainstaluj Pico SDK a ARM toolchain, nastav `PICO_SDK_PATH`, potom:

```bash
mkdir build
cd build
cmake ..
cmake --build .
```

Výsledný `pico_adc_i2c.uf2` nahraj přes BOOTSEL. Firmware používá oficiální Pico SDK I²C-slave API.
