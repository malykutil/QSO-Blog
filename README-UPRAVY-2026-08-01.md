# Souhrn úprav – 1. srpna 2026

Tento dokument shrnuje dnešní úpravy měření, ochrany, Raspberry Pi a webového solárního dashboardu. Hesla, přístupové tokeny ani jiné tajné údaje nejsou v repozitáři uloženy.

## Zapojení senzorů

### Arduino Nano přes USB

| Pin / sběrnice | Senzor | Použití |
| --- | --- | --- |
| A0 | MQ-9 | Kvalita vzduchu a doplňková ochrana proti požáru nebo úniku plynu |
| A1 | ACS712 | Proud solárního vstupu 1 |
| A2 | ACS712 | Proud solárního vstupu 2 |
| A3 | ACS712 | Proud baterie; znaménko určuje nabíjení nebo vybíjení |
| I2C `0x40` | INA219 | Pouze měření externího napětí; měření proudu a výkonu je vypnuté |
| I2C `0x76` | BMP280 | Teplota a tlak v prostoru baterie |
| I2C `0x77` | BMP280 | Venkovní teplota a tlak |

Arduino odesílá naměřená data jako JSON přes USB rychlostí 115 200 baudů.

### Raspberry Pi

| Připojení | Senzor | Použití |
| --- | --- | --- |
| GPIO 26 | DHT11 | Teplota a vlhkost v objektu |
| GPIO 21 | DHT11 | Teplota a vlhkost u MPPT regulátoru |
| I2C bus 1, `0x42` | Waveshare UPS HAT | Napětí, proud, stav nabíjení/vybíjení a odhad kapacity UPS |

Arduino a Raspberry Pi používají dvě oddělené I2C sběrnice. Adresy `0x40` na Arduinu a `0x42` na Raspberry Pi se proto navzájem neovlivňují.

## Firmware Arduina

- Doplněno načítání MQ-9, tří ACS712, dvou BMP280 a INA219.
- Ověřeny I2C adresy `0x40`, `0x76` a `0x77`.
- Pro odpojené ACS712 byly nastaveny naměřené nulové body 2490,39 mV, 2456,83 mV a 2506,68 mV.
- Proud v pásmu ±0,10 A se zobrazuje jako přesná nula, aby odpojené vstupy neukazovaly šum.
- Externí napětí INA219 do 1,10 V se považuje za odpojený vstup a zobrazuje se jako 0 V.
- Proud, bočníkové napětí a výkon INA219 se neposílají, protože tento modul má sloužit pouze jako voltmetr.
- Firmware byl nahrán do Arduino Nano a živé měření potvrdilo nulové hodnoty na všech odpojených proudových vstupech i na externím voltmetru.

## Sběr dat na Raspberry Pi

- Hlavní sběrný program je `/home/ft-891/rpi_telemetry.py`.
- Běží jako služba `rpi-telemetry` a automaticky se spouští po zapnutí Raspberry Pi.
- Arduino se otevírá přes stabilní cestu `/dev/serial/by-id/usb-1a86_USB2.0-Ser_-if00-port0`.
- Telemetrie se ukládá každých 60 sekund, MQ-9 se kontroluje přibližně každé 2 sekundy a požadované stavy relé každých 5 sekund.
- Přidáno měření DHT11 u MPPT na GPIO 21.
- Přidáno čtení Waveshare UPS HAT na adrese `0x42`.
- Kladný proud UPS znamená nabíjení, záporný vybíjení. Hodnoty v pásmu ±0,01 A se na webu zobrazují jako klidový stav.
- Kapacita UPS se odhaduje z napětí v rozsahu 6,0–8,4 V a omezuje se na 0–100 %. Jde o orientační odhad, nikoliv přesný údaj z BMS nebo coulomb counteru.
- Zálohy upravovaných souborů Raspberry Pi jsou uložené v `/home/ft-891/qso-backups/`.

## Ochrana MQ-9 a poplach

- Hodnota MQ-9 se na webu nezobrazuje ve voltech, ale jako stav kvality vzduchu: dobrá, zhoršená, špatná nebo kritická.
- Výchozí základ je RAW 520 a hranice kritického stavu je RAW 833.
- Tři kritické vzorky po sobě trvale aktivují poplach.
- Při poplachu se vypne všech šest relé: Solar 1, Solar 2, baterie, bufík, ventilátor 12 V a ventilátor 24 V.
- Poplach se ukládá lokálně do `/home/ft-891/mq9-alarm-latched.json`, takže zůstane aktivní i při výpadku internetu nebo restartu služby.
- Přihlášený uživatel může poplach potvrdit a vypnout přímo na webu. Reset je povolen jen při čerstvé telemetrii a bezpečné aktuální hodnotě MQ-9.
- Reset poplachu relé automaticky znovu nezapne; jejich další zapnutí zůstává vědomým rozhodnutím obsluhy.

> MQ-9 a tato softwarová ochrana jsou pouze doplňkové. Nenahrazují certifikovaný kouřový, požární ani CO hlásič a bezpečnostní odpojovací prvky.

## Webový dashboard `/solar`

- Stránka byla přepracována do moderního responzivního vzhledu pro počítač i telefon.
- Volby 1 hodina, 6 hodin, 24 hodin, 7 dní a 30 dní zobrazí celý vybraný interval bez ručního vodorovného posouvání grafu.
- Přidán samostatný graf MQ-9 včetně zobrazení hranice poplachu.
- Doplněno zobrazení stavu poplachu a přihlášené potvrzení/reset poplachu.
- Přidáno napětí UPS, procenta baterie, proud a stav nabíjení, vybíjení nebo klidu.
- Z dashboardu byly odstraněny odvozené výkony ve W, Wh a kWh.
- Hlavní veličiny jsou nyní proudy v A a integrovaná kapacita v Ah.
- Dashboard ukazuje proud Solar 1, Solar 2, jejich součet, proud baterie a proud UPS.
- Graf Ah obsahuje Solar 1, Solar 2, jejich součet a samostatně nabitou a vybitou kapacitu baterie.
- Ah se integrují lichoběžníkovou metodou podle skutečných časových značek. Mezery delší než pět minut se do výsledku nezapočítávají.
- Denní souhrn ukazuje Ah a maximální naměřené proudy.

Produkční stránka: [https://ok2mkj.vercel.app/solar](https://ok2mkj.vercel.app/solar)

## Ověření

- `npm run lint` proběhl bez chyby.
- `npm run build` proběhl bez chyby na Next.js 16.2.3.
- `python -m py_compile scripts/rpi_telemetry.py` proběhl bez chyby.
- Produkční stránka `/solar` byla po nasazení zkontrolována.
- Služba `rpi-telemetry` byla ověřena jako aktivní a povolená pro automatický start.
- Při poslední kontrole byla všechna relé vypnutá.

## Dnešní commity

| Commit | Změna |
| --- | --- |
| [`dc88751`](https://github.com/malykutil/QSO-Blog/commit/dc88751) | Solární telemetrie a nouzové vypnutí při kritické hodnotě MQ-9 |
| [`b90952b`](https://github.com/malykutil/QSO-Blog/commit/b90952b) | Celý vybraný rozsah historie a graf MQ-9 |
| [`3965712`](https://github.com/malykutil/QSO-Blog/commit/3965712) | Modernizace solárního dashboardu |
| [`e0842f3`](https://github.com/malykutil/QSO-Blog/commit/e0842f3) | Kalibrace nul odpojených vstupů napětí a proudu |
| [`1ded0e7`](https://github.com/malykutil/QSO-Blog/commit/1ded0e7) | Přihlášený reset poplachu MQ-9 |
| [`e7ded62`](https://github.com/malykutil/QSO-Blog/commit/e7ded62) | Monitorování Waveshare UPS |
| [`542581f`](https://github.com/malykutil/QSO-Blog/commit/542581f) | Nahrazení výkonových údajů proudy a Ah |

## Hlavní upravené soubory

- `arduino_nano_adc_i2c/arduino_nano_adc_i2c.ino` – firmware Arduino Nano.
- `scripts/rpi_telemetry.py` – sběr senzorů, odesílání dat, UPS a bezpečnostní logika.
- `scripts/RPI_SENSOR_SETUP.md` – instalační a provozní návod Raspberry Pi.
- `app/solar/page.tsx` – serverová část stránky `/solar`.
- `app/components/solar-energy-overview.tsx` – dashboard, grafy, souhrny a ovládání.
- `src/lib/solar-energy.ts` – výpočty proudů a Ah.
- `app/api/solar/alarm/route.ts` – ověřený reset poplachu.
- `supabase/solar.sql` – databázová struktura telemetrie a poplachu.

## Bezpečnost a provoz

- Přístupové údaje patří pouze do serverového prostředí a do chráněného konfiguračního souboru Raspberry Pi, nikdy do GitHubu.
- Protože heslo Raspberry Pi bylo sdíleno v konverzaci, je vhodné ho změnit.
- Po změně zapojení nebo typu ACS712 je nutné znovu zkalibrovat nulové body a převod proudu.
- Před ostrým provozem je nutné otestovat fyzické odpojení všech relé, požární scénář, reset poplachu a chování po restartu Raspberry Pi.
