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
  }).format(parsed);
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

function buildOverlaySvg(input: QslCardInput) {
  const date = escapeXml(formatQslDate(input.qsoDate));
  const utc = escapeXml(formatUtc(input.timeOn));
  const mhz = escapeXml(formatBandAsMhz(input.band));
  const mode = escapeXml(input.mode || "--");
  const rst = escapeXml(formatRst(input.rstSent, input.rstRcvd));
  const callsign = escapeXml(input.callsign.toUpperCase() || "--");

  return `
    <svg width="1536" height="1024" viewBox="0 0 1536 1024" xmlns="http://www.w3.org/2000/svg">
      <style>
        .tableText {
          fill: #102d4a;
          font-family: "Arial Narrow", Arial, sans-serif;
          font-weight: 800;
          font-size: 30px;
          letter-spacing: 0;
        }

        .handText {
          fill: #173c89;
          font-family: "Segoe Print", "Comic Sans MS", cursive;
          font-weight: 600;
          font-size: 42px;
          letter-spacing: 0;
        }
      </style>

      <text x="150" y="646" text-anchor="middle" class="tableText">${date}</text>
      <text x="310" y="646" text-anchor="middle" class="tableText">${utc}</text>
      <text x="462" y="646" text-anchor="middle" class="tableText">${mhz}</text>
      <text x="602" y="646" text-anchor="middle" class="tableText">${mode}</text>
      <text x="731" y="646" text-anchor="middle" class="tableText">${rst}</text>
      <text x="84" y="746" class="handText">${callsign}</text>
    </svg>
  `;
}

export async function renderQslCardPng(template: Buffer, input: QslCardInput) {
  const overlay = Buffer.from(buildOverlaySvg(input));

  return sharp(template)
    .composite([
      {
        input: overlay,
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
}
