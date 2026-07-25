# Arduino Nano jako ADC přes I²C

Kompatibilní druhá verze firmware pro stejný Raspberry Pi uploader jako Pico.
Nano vystupuje jako I²C slave na adrese `0x42` a posílá 24B rámec od registru
`0x10`.

## Analogové kanály

| Čidlo | Arduino Nano |
|---|---|
| ACS712 č. 1 | A0 |
| ACS712 č. 2 | A1 |
| ACS712 č. 3 | A2 |
| MQ-9 analog OUT | A3 |

Klasické Nano používá 5V analogovou referenci. Firmware posílá raw hodnoty i
napětí v mV. Pro ACS712 20A je výchozí kalibrace přibližně 2500 mV nulový bod a
100 mV/A citlivost; skutečné hodnoty je vhodné doladit měřením.

## I²C k Raspberry Pi

| Arduino Nano | Raspberry Pi |
|---|---|
| A4 / SDA | GPIO2 / SDA |
| A5 / SCL | GPIO3 / SCL |
| GND | GND |

Pozor: Nano 5V logiku nesmí připojit přímo na 3,3V I²C Raspberry Pi. Použij
obousměrný převodník úrovní SDA/SCL (například BSS138 modul) a 3,3V pull-up na
straně Raspberry Pi. MQ-9 napájej podle jeho modulu; analogový výstup musí zůstat
v rozsahu 0–5 V Nano ADC.

V Arduino IDE vyber `Arduino Nano`, procesor `ATmega328P` a správný bootloader,
potom nahraj `arduino_nano_adc_i2c.ino`.
