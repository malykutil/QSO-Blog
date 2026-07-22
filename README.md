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

RPi posílá `POST /api/solar` s hlavičkou `Authorization: Bearer <SOLAR_RPI_TOKEN>`. Kromě proudů a teplot může posílat `solar1_voltage`, `solar2_voltage`, `battery_voltage`, `solar1_power`, `solar2_power`, `load_power`, `solar_energy_today_wh`, `load_energy_today_wh` a `battery_soc`.

Pro načtení požadovaných stavů relé používá RPi `GET /api/solar` se stejnou hlavičkou. Webové ovládání je na `/solar` a je dostupné pouze po přihlášení účtem KZB.
