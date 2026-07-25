# ESP32 solar display

Firmware for the ESP32-2432S028R display. The device connects to Wi-Fi, reads the latest RPi telemetry and supports OTA updates.

## First setup

1. Copy `include/secrets.example.h` to `include/secrets.h`.
2. Fill in Wi-Fi, API and token values. `secrets.h` is local-only and must not be committed.
3. Flash the firmware once over USB. After boot, the screen shows the ESP32 IP address.

The current local OTA password is stored in `include/secrets.h` as `OTA_PASSWORD`.

## OTA update over Wi-Fi

The ESP32 and computer must be on the same Wi-Fi network. Find the IP address on the display, then run from this directory:

```powershell
pio run -e esp32dev -t upload --upload-protocol espota --upload-port 192.168.1.123 --upload-flags "--port=8266 --auth=<OTA_PASSWORD>"
```

Replace `192.168.1.123` with the IP shown on the display and `<OTA_PASSWORD>` with the value from local `include/secrets.h`. The upload password must match `OTA_PASSWORD` exactly.

If mDNS works on the network, the hostname may also work:

```powershell
pio run -e esp32dev -t upload --upload-protocol espota --upload-port qso-esp32-solar.local --upload-flags "--port=8266 --auth=<OTA_PASSWORD>"
```

After a successful OTA upload the ESP32 restarts automatically. Do not erase the flash or upload the filesystem for a normal firmware update; OTA updates only need the firmware command above.

## Automatic brightness

The onboard light sensor (LDR on GPIO34) controls the backlight on GPIO21. After 15 seconds without a touch, the display dims to a low level. Touching the screen restores the brightness based on the current ambient light.

## Troubleshooting

- The PC and ESP32 must be on the same network; guest Wi-Fi often blocks device-to-device traffic.
- Use the IP printed on the display if `.local` does not resolve.
- If OTA stops working after changing Wi-Fi or `OTA_PASSWORD`, flash once over USB with the new settings.
- USB recovery command:

```powershell
pio run -e esp32dev -t upload --upload-port COM11
```
