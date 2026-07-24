This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
## Solární přehled / Raspberry Pi

1. V Supabase spusť `supabase/solar.sql`.
2. Na server přidej `SUPABASE_SERVICE_ROLE_KEY` a náhodný `SOLAR_RPI_TOKEN`.
3. Volitelně nastav `SOLAR_CONTROL_USERNAME` a `SOLAR_CONTROL_PASSWORD` (výchozí hodnoty jsou `KZB` a `OK2KZB`).

RPi posílá `POST /api/solar` s hlavičkou `Authorization: Bearer <SOLAR_RPI_TOKEN>`. Kromě proudů a teplot může posílat `solar1_voltage`, `solar2_voltage`, `battery_voltage`, `solar1_power`, `solar2_power`, `load_power`, `solar_energy_today_wh` a `load_energy_today_wh`.

Pro načtení požadovaných stavů relé používá RPi `GET /api/solar` se stejnou hlavičkou. Webové ovládání je na `/solar` a je dostupné pouze po přihlášení účtem KZB.

Historii načte web přes `GET /api/solar?range=1h|24h|7d|30d`. Stránka zobrazuje společný graf proudů Solár 1, Solár 2 a baterie včetně záporného směru a samostatný graf teplot objektu, baterie a MPPT.

Předpověď používá `/api/weather` a souřadnice `49.4398092, 18.0245583`. Aktuální výchozí konfigurace je 2×250 Wp, západní orientace, sklon 45° a reálný výkonový koeficient 70 % (orientačně maximálně 350 W dohromady, přibližně 170–175 W na panel). Volitelně lze nastavit `WEATHER_LATITUDE`, `WEATHER_LONGITUDE`, `WEATHER_TIMEZONE`, `SOLAR_TOTAL_WP`, `SOLAR_PANEL_TILT`, `SOLAR_PANEL_AZIMUTH` a `SOLAR_PERFORMANCE_RATIO`. Odhad výroby je orientační a zatím pouze informační; automatické spínání čeká na konkrétní relé pro výhřev baterie a bufík.

Pokud je nastaveno `SOLCAST_API_KEY`, `/api/weather` použije Solcast rooftop PV forecast. Bez klíče zůstává jako záloha Open-Meteo. API klíč patří pouze do serverového prostředí, ne do GitHubu.
