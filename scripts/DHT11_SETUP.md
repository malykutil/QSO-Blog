# DHT11 telemetry

The sensor is connected to BCM GPIO 26 (physical pin 37). The uploader sends
`object_temperature` and `object_humidity` to `POST /api/solar` every 10 seconds.

On the Raspberry Pi, copy `dht26_upload.py` to `/home/ft-891/` and install the
service from `dht26-telemetry.service`. Replace `SOLAR_API_URL` with the public
site URL and set the same random `SOLAR_RPI_TOKEN` on the web server and Pi.

The Supabase migration in `supabase/solar.sql` adds `object_humidity`.
