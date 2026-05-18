export type QrzCredentials = {
  username: string;
  password: string;
};

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function readTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function getResolvedCredentials(credentials?: Partial<QrzCredentials> | null): QrzCredentials {
  const username = credentials?.username?.trim() || process.env.QRZ_USERNAME || "";
  const password = credentials?.password || process.env.QRZ_PASSWORD || "";

  if (!username || !password) {
    throw new Error("QRZ není nastavený. Doplň přístup v Nastavení nebo ve Vercelu.");
  }

  return { username, password };
}

export async function getQrzSessionKey(credentials?: Partial<QrzCredentials> | null) {
  const resolvedCredentials = getResolvedCredentials(credentials);
  const params = new URLSearchParams({
    username: resolvedCredentials.username,
    password: resolvedCredentials.password,
    agent: "OK2MKJ-QSO-Blog",
  });

  const response = await fetch(`https://xmldata.qrz.com/xml/current/?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("QRZ přihlášení selhalo.");
  }

  const xml = await response.text();
  const key = readTag(xml, "Key");

  if (!key) {
    throw new Error(readTag(xml, "Error") || "QRZ nevrátil session key.");
  }

  return key;
}

export async function fetchQrzEmailBySession(callsign: string, sessionKey: string) {
  if (!sessionKey) {
    throw new Error("QRZ session není dostupná.");
  }

  const params = new URLSearchParams({
    s: sessionKey,
    callsign,
  });

  const response = await fetch(`https://xmldata.qrz.com/xml/current/?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("QRZ dotaz selhal.");
  }

  const xml = await response.text();
  const email = readTag(xml, "email");

  if (!email) {
    throw new Error(readTag(xml, "Error") || "QRZ nenašel e-mail pro tuto značku.");
  }

  return email.trim().toLowerCase();
}
