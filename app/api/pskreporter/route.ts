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

type FetchSource = "retrieve" | "pskquery" | "query" | "cache";

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
    source: FetchSource;
    fetchedAt: string;
    latestSeenAt: string | null;
  };
};

type PskQueryParseResult = {
  latestSeenAt: number | null;
  spots: PskSpot[];
};

const pskResponseCache = new Map<string, CachedPayload>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const PSK_USER_AGENT = "Mozilla/5.0 (compatible; OK2MKJ-Logbook/1.0; +https://ok2mkj.vercel.app)";

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

function parseXmlReceptionReports(xml: string): PskSpot[] {
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

function parseJsonpPayload(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const match = trimmed.match(/^[^(]+\(([\s\S]*)\);?\s*$/);

  if (!match) {
    throw new Error("PSK query response is not valid JSONP.");
  }

  return JSON.parse(match[1]) as Record<string, unknown>;
}

function parsePskQueryReports(text: string): PskQueryParseResult {
  const payload = parseJsonpPayload(text);
  const reports = Array.isArray(payload.receptionReport) ? payload.receptionReport : [];

  let latestSeenAt: number | null = null;
  const senderSearch = payload.senderSearch;
  if (Array.isArray(senderSearch) && senderSearch.length > 0 && typeof senderSearch[0] === "object" && senderSearch[0] !== null) {
    const maybeRecent = Number((senderSearch[0] as Record<string, unknown>).recentFlowStartSeconds ?? 0);
    if (Number.isFinite(maybeRecent) && maybeRecent > 0) {
      latestSeenAt = maybeRecent;
    }
  }

  const spots = reports
    .map((row) => {
      if (typeof row !== "object" || row === null) {
        return null;
      }

      const item = row as Record<string, unknown>;

      return {
        receiverCallsign: String(item.receiverCallsign ?? ""),
        receiverLocator: String(item.receiverLocator ?? ""),
        receiverDXCC: String(item.receiverDXCC ?? item.receiverRegion ?? ""),
        senderCallsign: String(item.senderCallsign ?? ""),
        senderLocator: String(item.senderLocator ?? ""),
        mode: String(item.mode ?? ""),
        snr: String(item.sNR ?? ""),
        frequency: String(item.frequency ?? ""),
        flowStartSeconds: Number(item.flowStartSeconds ?? 0),
      } satisfies PskSpot;
    })
    .filter((item): item is PskSpot => item !== null && Boolean(item.receiverCallsign) && Boolean(item.senderCallsign))
    .sort((a, b) => b.flowStartSeconds - a.flowStartSeconds);

  return { latestSeenAt, spots };
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

async function fetchTextWithRetries(url: string, options?: { referer?: string; retries?: number }) {
  const retries = options?.retries ?? 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const headers: Record<string, string> = {
        Accept: "application/xml,text/xml,application/json,text/plain,*/*",
        "User-Agent": PSK_USER_AGENT,
      };

      if (options?.referer) {
        headers.Referer = options.referer;
      }

      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers,
      });

      if (response.ok) {
        return await response.text();
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(600 + attempt * 500);
  }

  throw lastError ?? new Error("PSK endpoint did not return success.");
}

async function fetchFromRetrieve(callsign: string, seconds: number, bandRange: [number, number] | null) {
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
  const xml = await fetchTextWithRetries(retrieveUrl, { retries: 2 });
  const spots = parseXmlReceptionReports(xml);
  return filterSpots(spots, { callsign, seconds, bandRange });
}

async function fetchFromPskQuery(callsign: string, seconds: number, bandRange: [number, number] | null) {
  const params = new URLSearchParams({
    callback: "doNothing",
    mc_version: "2025.11.28.1033",
    pskvers: "2025.11.28.1032",
    statistics: "1",
    noactive: "1",
    nolocator: "1",
    flowStartSeconds: `-${seconds}`,
    callsign,
  });

  const url = `https://pskreporter.info/cgi-bin/pskquery5.pl?${params.toString()}`;
  const text = await fetchTextWithRetries(url, {
    referer: "https://pskreporter.info/pskmap.html",
    retries: 4,
  });

  const parsed = parsePskQueryReports(text);
  return {
    latestSeenAt: parsed.latestSeenAt,
    spots: filterSpots(parsed.spots, { callsign, seconds, bandRange }),
  };
}

async function fetchFromQueryMirror(callsign: string, seconds: number, bandRange: [number, number] | null) {
  const text = await fetchTextWithRetries("https://pskreporter.info/query/", { retries: 3 });
  const spots = parseXmlReceptionReports(text);
  return filterSpots(spots, { callsign, seconds, bandRange });
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

  let latestSeenAt: number | null = null;
  let source: FetchSource = "query";
  let spots: PskSpot[] = [];
  let atLeastOneFetchSucceeded = false;

  try {
    try {
      const retrieveSpots = await fetchFromRetrieve(callsign, seconds, bandRange);
      atLeastOneFetchSucceeded = true;

      if (retrieveSpots.length > 0) {
        source = "retrieve";
        spots = retrieveSpots;
      }
    } catch {
      // Continue with PSK query fallback.
    }

    if (spots.length === 0) {
      try {
        const pskQuery = await fetchFromPskQuery(callsign, seconds, bandRange);
        atLeastOneFetchSucceeded = true;
        latestSeenAt = pskQuery.latestSeenAt;

        if (pskQuery.spots.length > 0) {
          source = "pskquery";
          spots = pskQuery.spots;
        }
      } catch {
        // Continue with query mirror fallback.
      }
    }

    if (spots.length === 0) {
      try {
        const querySpots = await fetchFromQueryMirror(callsign, seconds, bandRange);
        atLeastOneFetchSucceeded = true;

        if (querySpots.length > 0) {
          source = "query";
          spots = querySpots;
        }
      } catch {
        // Last fallback handled below.
      }
    }

    if (!atLeastOneFetchSucceeded) {
      throw new Error("No PSK fetch source succeeded.");
    }

    const limitedSpots = spots.slice(0, 250);
    const uniqueReceivers = new Set(limitedSpots.map((spot) => spot.receiverCallsign)).size;
    const uniqueCountries = new Set(limitedSpots.map((spot) => spot.receiverDXCC).filter(Boolean)).size;

    const payload = {
      callsign,
      band: rawBand,
      seconds,
      count: limitedSpots.length,
      uniqueReceivers,
      uniqueCountries,
      spots: limitedSpots,
      source,
      fetchedAt: new Date().toISOString(),
      latestSeenAt: latestSeenAt ? new Date(latestSeenAt * 1000).toISOString() : null,
    } as const;

    if (payload.count > 0) {
      pskResponseCache.set(cacheKey, {
        storedAt: Date.now(),
        payload,
      });
    }

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, max-age=0" } });
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
      { error: "PSK Reporter nelze načíst. Zkus to prosím za chvíli." },
      { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
