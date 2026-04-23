import { NextRequest, NextResponse } from "next/server";

import { getBandRange, normalizePskCallsign, normalizePskTime } from "@/src/lib/pskreporter";

type PskSpot = {
  receiverCallsign: string;
  receiverLocator: string;
  receiverDXCC: string;
  senderCallsign: string;
  senderLocator: string;
  mode: string;
  snr: string;
  frequency: string;
  flowStartSeconds: number;
};

type FetchResult = {
  xml: string;
  source: "retrieve" | "query";
};

type CachedPayload = {
  storedAt: number;
  payload: {
    callsign: string;
    band: string;
    seconds: number;
    count: number;
    uniqueReceivers: number;
    uniqueCountries: number;
    spots: PskSpot[];
    source: "retrieve" | "query" | "cache";
    fetchedAt: string;
  };
};

const pskResponseCache = new Map<string, CachedPayload>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseAttributes(value: string) {
  const result: Record<string, string> = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match: RegExpExecArray | null = regex.exec(value);

  while (match) {
    result[match[1]] = decodeEntities(match[2]);
    match = regex.exec(value);
  }

  return result;
}

function parseReceptionReports(xml: string): PskSpot[] {
  const spots: PskSpot[] = [];
  const regex = /<receptionReport\s+([^/>]+?)\s*\/>/g;

  let match: RegExpExecArray | null = regex.exec(xml);
  while (match) {
    const attrs = parseAttributes(match[1]);

    spots.push({
      receiverCallsign: attrs.receiverCallsign ?? "",
      receiverLocator: attrs.receiverLocator ?? "",
      receiverDXCC: attrs.receiverDXCC ?? attrs.receiverRegion ?? attrs.receiverDXCCCode ?? "",
      senderCallsign: attrs.senderCallsign ?? "",
      senderLocator: attrs.senderLocator ?? "",
      mode: attrs.mode ?? "",
      snr: attrs.sNR ?? "",
      frequency: attrs.frequency ?? "",
      flowStartSeconds: Number(attrs.flowStartSeconds ?? 0),
    });

    match = regex.exec(xml);
  }

  return spots
    .filter((spot) => spot.receiverCallsign && spot.senderCallsign)
    .sort((a, b) => b.flowStartSeconds - a.flowStartSeconds);
}

function callsignMatches(sender: string, target: string) {
  const senderNorm = normalizePskCallsign(sender);
  const targetNorm = normalizePskCallsign(target);

  if (!senderNorm || !targetNorm) {
    return false;
  }

  if (senderNorm === targetNorm) {
    return true;
  }

  const senderBase = senderNorm.split("/")[0] ?? senderNorm;
  const targetBase = targetNorm.split("/")[0] ?? targetNorm;
  return senderBase === targetBase;
}

function filterSpots(spots: PskSpot[], query: { callsign: string; seconds: number; bandRange: [number, number] | null }) {
  const cutoff = Math.floor(Date.now() / 1000) - query.seconds;

  return spots.filter((spot) => {
    if (!callsignMatches(spot.senderCallsign, query.callsign)) {
      return false;
    }

    if (spot.flowStartSeconds > 0 && spot.flowStartSeconds < cutoff) {
      return false;
    }

    if (query.bandRange) {
      const frequency = Number(spot.frequency);
      if (!Number.isFinite(frequency)) {
        return false;
      }

      if (frequency < query.bandRange[0] || frequency > query.bandRange[1]) {
        return false;
      }
    }

    return true;
  });
}

async function fetchXmlWithRetries(url: string, retries = 3) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; OK2MKJ-Logbook/1.0; +https://ok2mkj.vercel.app)",
          Accept: "application/xml,text/xml,*/*",
        },
      });

      if (response.ok) {
        return await response.text();
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("PSK endpoint did not return success.");
}

async function fetchPskXml(callsign: string, seconds: number, bandRange: [number, number] | null): Promise<FetchResult> {
  const retrieveParams = new URLSearchParams({
    senderCallsign: callsign,
    flowStartSeconds: `-${seconds}`,
    rptlimit: "500",
    rronly: "1",
  });

  if (bandRange) {
    retrieveParams.set("frange", `${bandRange[0]}-${bandRange[1]}`);
  }

  const retrieveUrl = `https://retrieve.pskreporter.info/query?${retrieveParams.toString()}`;

  try {
    const xml = await fetchXmlWithRetries(retrieveUrl, 2);
    return { xml, source: "retrieve" };
  } catch {
    // Fall through to query mirror.
  }

  const queryUrl = "https://pskreporter.info/query/";
  const xml = await fetchXmlWithRetries(queryUrl, 3);
  return { xml, source: "query" };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const rawCallsign = url.searchParams.get("callsign") ?? "OK2MKJ";
  const rawBand = url.searchParams.get("band") ?? "all";
  const rawSeconds = Number(url.searchParams.get("seconds") ?? "3600");

  const callsign = normalizePskCallsign(rawCallsign) || "OK2MKJ";
  const seconds = normalizePskTime(rawSeconds);
  const bandRange = getBandRange(rawBand);
  const cacheKey = `${callsign}|${rawBand}|${seconds}`;

  try {
    const fetched = await fetchPskXml(callsign, seconds, bandRange);
    const parsed = parseReceptionReports(fetched.xml);
    const spots = filterSpots(parsed, { callsign, seconds, bandRange }).slice(0, 250);
    const uniqueReceivers = new Set(spots.map((spot) => spot.receiverCallsign)).size;
    const uniqueCountries = new Set(spots.map((spot) => spot.receiverDXCC).filter(Boolean)).size;
    const payload = {
      callsign,
      band: rawBand,
      seconds,
      count: spots.length,
      uniqueReceivers,
      uniqueCountries,
      spots,
      source: fetched.source,
      fetchedAt: new Date().toISOString(),
    } as const;

    if (payload.count > 0) {
      pskResponseCache.set(cacheKey, {
        storedAt: Date.now(),
        payload,
      });
    }

    return NextResponse.json(
      payload,
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    const cached = pskResponseCache.get(cacheKey);
    if (cached && cached.payload.count > 0 && Date.now() - cached.storedAt < CACHE_TTL_MS) {
      return NextResponse.json(
        {
          ...cached.payload,
          source: "cache",
          fetchedAt: new Date(cached.storedAt).toISOString(),
        },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    return NextResponse.json(
      { error: "PSK Reporter nelze nacist. Zkus to prosim za chvili." },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
