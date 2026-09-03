import { join } from "node:path";

import sharp from "sharp";

export type QslCardInput = {
  callsign: string;
  qsoDate: string;
  timeOn: string;
  band: string;
  mode: string;
  rstSent: string;
  rstRcvd: string;
};

const bandToMhz: Record<string, string> = {
  "160m": "1.8",
  "80m": "3.5",
  "60m": "5",
  "40m": "7",
  "30m": "10",
  "20m": "14",
  "17m": "18",
  "15m": "21",
  "12m": "24",
  "10m": "28",
  "6m": "50",
  "2m": "144",
  "70cm": "432",
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatQslDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return value || "--";
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Prague",
  })
    .format(parsed)
    .replace(/\s/g, "");
}

function formatUtc(value: string) {
  if (!value) {
    return "--";
  }

  return value.slice(0, 5);
}

function formatBandAsMhz(value: string) {
  const normalized = value.trim().toLowerCase();
  return (bandToMhz[normalized] ?? value.replace(/m$/i, "")) || "--";
}

function formatRst(sent: string, received: string) {
  if (sent && received && sent !== received) {
    return `${sent}/${received}`;
  }

  return sent || received || "--";
}

async function renderTextLayer({
  text,
  fontSize,
  color,
  italic = false,
}: {
  text: string;
  fontSize: number;
  color: string;
  italic?: boolean;
}) {
  const content = `${italic ? "<i>" : ""}<span foreground="${color}" weight="bold">${escapeXml(text)}</span>${italic ? "</i>" : ""}`;

  return sharp({
    text: {
      text: content,
      font: `Geist ${fontSize}`,
      fontfile: join(process.cwd(), "public", "qsl-font.ttf"),
      rgba: true,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
}

export async function renderQslCardPng(template: Buffer, input: QslCardInput) {
  const [date, utc, mhz, mode, rst, callsign] = await Promise.all([
    renderTextLayer({ text: formatQslDate(input.qsoDate), fontSize: 30, color: "#102d4a" }),
    renderTextLayer({ text: formatUtc(input.timeOn), fontSize: 30, color: "#102d4a" }),
    renderTextLayer({ text: formatBandAsMhz(input.band), fontSize: 30, color: "#102d4a" }),
    renderTextLayer({ text: input.mode || "--", fontSize: 30, color: "#102d4a" }),
    renderTextLayer({ text: formatRst(input.rstSent, input.rstRcvd), fontSize: 30, color: "#102d4a" }),
    renderTextLayer({
      text: input.callsign.toUpperCase() || "--",
      fontSize: 42,
      color: "#173c89",
      italic: true,
    }),
  ]);

  return sharp(template)
    .composite([
      { input: date.data, left: Math.round(150 - date.info.width / 2), top: 611 },
      { input: utc.data, left: Math.round(310 - utc.info.width / 2), top: 611 },
      { input: mhz.data, left: Math.round(462 - mhz.info.width / 2), top: 611 },
      { input: mode.data, left: Math.round(602 - mode.info.width / 2), top: 611 },
      { input: rst.data, left: Math.round(731 - rst.info.width / 2), top: 611 },
      { input: callsign.data, left: 84, top: 711 },
    ])
    .png()
    .toBuffer();
}
