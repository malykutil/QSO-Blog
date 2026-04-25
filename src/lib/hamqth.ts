export type HamqthCredentials = {
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

function getResolvedCredentials(credentials?: Partial<HamqthCredentials> | null): HamqthCredentials {
  const username = credentials?.username?.trim() || process.env.HAMQTH_USERNAME || "";
  const password = credentials?.password || process.env.HAMQTH_PASSWORD || "";

  if (!username || !password) {
    throw new Error("Dohledání přes HamQTH není nastavené. Doplň údaje v Nastavení nebo ve Vercelu.");
  }

  return { username, password };
}

export async function getHamqthSessionId(credentials?: Partial<HamqthCredentials> | null) {
  const resolvedCredentials = getResolvedCredentials(credentials);
  const loginParams = new URLSearchParams({
    u: resolvedCredentials.username,
    p: resolvedCredentials.password,
  });

  const loginResponse = await fetch(`https://www.hamqth.com/xml.php?${loginParams.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!loginResponse.ok) {
    throw new Error("HamQTH přihlášení selhalo.");
  }

  const loginXml = await loginResponse.text();
  const sessionId = readTag(loginXml, "session_id");

  if (!sessionId) {
    throw new Error(readTag(loginXml, "error") || "HamQTH nevrátil session ID.");
  }

  return sessionId;
}

export async function testHamqthConnection(credentials?: Partial<HamqthCredentials> | null) {
  await getHamqthSessionId(credentials);
  return true;
}

export async function fetchHamqthEmail(callsign: string, credentials?: Partial<HamqthCredentials> | null) {
  const sessionId = await getHamqthSessionId(credentials);
  const searchParams = new URLSearchParams({
    id: sessionId,
    callsign,
    prg: "OK2MKJ",
  });

  const searchResponse = await fetch(`https://www.hamqth.com/xml.php?${searchParams.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!searchResponse.ok) {
    throw new Error("HamQTH dotaz selhal.");
  }

  const searchXml = await searchResponse.text();
  const email = readTag(searchXml, "email");

  if (!email) {
    throw new Error(readTag(searchXml, "error") || "HamQTH nenašel e-mail pro tuto značku.");
  }

  return email.trim().toLowerCase();
}
