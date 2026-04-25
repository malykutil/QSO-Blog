import { findDxcc } from "@ham-core/fast-dxcc";

export type QsoRecord = {
  id?: number | string;
  callsign: string;
  band: string;
  mode: string;
  date: string;
  timeOn?: string;
  operator?: string;
  rstSent?: string;
  rstRcvd?: string;
  locator: string;
  lat: number | null;
  lon: number | null;
  note?: string;
  isPublic?: boolean;
};

export type EnrichedQsoRecord = QsoRecord & {
  continent: string;
  distanceKm: number | null;
};

type Coordinates = {
  lat: number | null;
  lon: number | null;
};

type CoordinateResolution = Coordinates & {
  source: "locator" | "prefix" | "none";
  country?: string;
};

export const qsoSelectFields =
  "id,callsign,band,mode,date,time_on,operator,rst_sent,rst_rcvd,locator,lat,lon,note,is_public";

export const fallbackQsoRecords: QsoRecord[] = [
  {
    id: 1,
    callsign: "DL1ABC",
    band: "20m",
    mode: "SSB",
    date: "2026-04-12",
    timeOn: "19:42:00",
    operator: "OK2MKJ",
    rstSent: "59",
    rstRcvd: "59",
    locator: "JO62QN",
    lat: 52.5625,
    lon: 13.375,
    note: "Silný signál, večerní DX okno.",
    isPublic: true,
  },
  {
    id: 2,
    callsign: "F4XYZ",
    band: "40m",
    mode: "FT8",
    date: "2026-04-11",
    timeOn: "21:11:00",
    operator: "OK2MKJ",
    rstSent: "-08",
    rstRcvd: "-10",
    locator: "JN18EU",
    lat: 43.6042,
    lon: 1.4437,
    note: "Rychle potvrzené QSO během šedé zóny.",
    isPublic: true,
  },
  {
    id: 3,
    callsign: "EA7MNO",
    band: "15m",
    mode: "CW",
    date: "2026-04-09",
    timeOn: "14:18:00",
    operator: "OK2MKJ",
    rstSent: "599",
    rstRcvd: "579",
    locator: "IM76QX",
    lat: 36.7213,
    lon: -4.4214,
    note: "Kratší, ale čisté spojení.",
    isPublic: true,
  },
  {
    id: 4,
    callsign: "OE3QRS",
    band: "10m",
    mode: "SSB",
    date: "2026-04-08",
    timeOn: "10:26:00",
    operator: "OK2MKJ",
    rstSent: "57",
    rstRcvd: "55",
    locator: "JN88DF",
    lat: 48.2082,
    lon: 16.3738,
    note: "Dopolední otevření pásma.",
    isPublic: false,
  },
  {
    id: 5,
    callsign: "SP7TUV",
    band: "80m",
    mode: "FT4",
    date: "2026-04-06",
    timeOn: "23:02:00",
    operator: "OK2MKJ",
    rstSent: "-03",
    rstRcvd: "-05",
    locator: "KO01BW",
    lat: 52.2297,
    lon: 21.0122,
    note: "Noční provoz, stabilní podmínky.",
    isPublic: false,
  },
];

export function normalizeQsoRecord(row: Record<string, unknown>): QsoRecord {
  const callsign = (row.callsign as string | null) ?? "";
  const locator = (row.locator as string | null) ?? "";
  const resolvedCoordinates = resolveCoordinatesForQso({ callsign, locator });
  const hasStoredLat = typeof row.lat === "number";
  const hasStoredLon = typeof row.lon === "number";
  const shouldForcePrefix = normalizeLocator(locator) === "JN99" && resolvedCoordinates.source === "prefix";

  return {
    id: row.id as string | number | undefined,
    callsign,
    band: (row.band as string | null) ?? "",
    mode: (row.mode as string | null) ?? "",
    date: (row.date as string | null) ?? "",
    timeOn: (row.time_on as string | null) ?? "",
    operator: (row.operator as string | null) ?? "",
    rstSent: (row.rst_sent as string | null) ?? "",
    rstRcvd: (row.rst_rcvd as string | null) ?? "",
    locator,
    lat: shouldForcePrefix ? resolvedCoordinates.lat : hasStoredLat ? (row.lat as number) : resolvedCoordinates.lat,
    lon: shouldForcePrefix ? resolvedCoordinates.lon : hasStoredLon ? (row.lon as number) : resolvedCoordinates.lon,
    note: (row.note as string | null) ?? "",
    isPublic: Boolean(row.is_public),
  };
}

export function getQsoKey(record: QsoRecord, index = 0) {
  if (record.id !== undefined && record.id !== null) {
    return String(record.id);
  }

  return `${getQsoFingerprint(record)}-${index}`;
}

export function getQsoFingerprint(
  record: Pick<QsoRecord, "callsign" | "date" | "timeOn" | "band" | "mode" | "operator" | "locator">,
) {
  return [
    record.callsign.trim().toUpperCase(),
    record.date.trim(),
    record.timeOn?.trim() || "no-time",
    normalizeBand(record.band),
    (record.mode || "").trim().toUpperCase(),
    (record.operator || "").trim().toUpperCase() || "no-operator",
    (record.locator || "").trim().toUpperCase() || "no-locator",
  ].join("|");
}

export function normalizeBand(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, "").toLowerCase();
}

export function formatBand(value: string | null | undefined) {
  const band = normalizeBand(value);

  if (!band) {
    return "";
  }

  return band.endsWith("m") ? band : `${band}m`;
}

export function formatActivityDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return "Neznámé datum";
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function maidenheadToLatLon(locator: string | null | undefined) {
  if (!locator) {
    return { lat: null, lon: null };
  }

  const value = locator.trim().toUpperCase();

  if (value.length < 4 || value.length % 2 !== 0) {
    return { lat: null, lon: null };
  }

  let lon = -180;
  let lat = -90;
  let lonStep = 20;
  let latStep = 10;

  for (let index = 0; index < value.length; index += 2) {
    const first = value[index];
    const second = value[index + 1];
    const pairIndex = index / 2;

    if (pairIndex === 0) {
      lon += (first.charCodeAt(0) - 65) * lonStep;
      lat += (second.charCodeAt(0) - 65) * latStep;
      lonStep = 2;
      latStep = 1;
      continue;
    }

    if (pairIndex % 2 === 1) {
      lon += Number(first) * lonStep;
      lat += Number(second) * latStep;
      lonStep /= 24;
      latStep /= 24;
      continue;
    }

    lon += (first.charCodeAt(0) - 65) * lonStep;
    lat += (second.charCodeAt(0) - 65) * latStep;
    lonStep /= 10;
    latStep /= 10;
  }

  return {
    lat: Number((lat + latStep / 2).toFixed(6)),
    lon: Number((lon + lonStep / 2).toFixed(6)),
  };
}

function normalizeLocator(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

function normalizeCallsign(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

export function resolveCoordinatesByCallsignPrefix(callsign: string | null | undefined): CoordinateResolution {
  const normalizedCallsign = normalizeCallsign(callsign);

  if (!normalizedCallsign) {
    return { lat: null, lon: null, source: "none" };
  }

  let dxccResult: ReturnType<typeof findDxcc> | null = null;

  try {
    dxccResult = findDxcc(normalizedCallsign);
  } catch {
    return { lat: null, lon: null, source: "none" };
  }

  if (!dxccResult) {
    return { lat: null, lon: null, source: "none" };
  }

  const lat = typeof dxccResult.entity.lat === "number" ? Number(dxccResult.entity.lat.toFixed(6)) : null;
  const lon = typeof dxccResult.entity.long === "number" ? Number(dxccResult.entity.long.toFixed(6)) : null;

  if (lat === null || lon === null) {
    return { lat: null, lon: null, source: "none" };
  }

  return {
    lat,
    lon,
    source: "prefix",
    country: dxccResult.entity.name,
  };
}

export function resolveCoordinatesForQso({
  locator,
  callsign,
}: {
  locator: string | null | undefined;
  callsign: string | null | undefined;
}): CoordinateResolution {
  const normalizedLocator = normalizeLocator(locator);
  const shouldUsePrefix = !normalizedLocator || normalizedLocator === "JN99";

  if (!shouldUsePrefix) {
    const locatorCoordinates = maidenheadToLatLon(normalizedLocator);

    if (locatorCoordinates.lat !== null && locatorCoordinates.lon !== null) {
      return {
        ...locatorCoordinates,
        source: "locator",
      };
    }
  }

  return resolveCoordinatesByCallsignPrefix(callsign);
}

export function averageMapCenter(records: QsoRecord[]) {
  const withCoordinates = records.filter((record) => record.lat !== null && record.lon !== null);

  if (!withCoordinates.length) {
    return { lat: 50.08, lon: 14.43 };
  }

  const sum = withCoordinates.reduce(
    (accumulator, record) => ({
      lat: accumulator.lat + (record.lat ?? 0),
      lon: accumulator.lon + (record.lon ?? 0),
    }),
    { lat: 0, lon: 0 },
  );

  return {
    lat: sum.lat / withCoordinates.length,
    lon: sum.lon / withCoordinates.length,
  };
}

export function haversineDistanceKm(from: { lat: number; lon: number }, to: { lat: number; lon: number }) {
  const earthRadiusKm = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const startLat = (from.lat * Math.PI) / 180;
  const endLat = (to.lat * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(startLat) * Math.cos(endLat);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusKm * c);
}

export function getContinentLabel(lat: number | null, lon: number | null) {
  if (lat === null || lon === null) {
    return "Neznámý";
  }

  if (lat >= 35 && lon >= -25 && lon <= 45) {
    return "Evropa";
  }

  if (lat >= -35 && lat <= 37 && lon >= -20 && lon <= 52) {
    return "Afrika";
  }

  if (lat >= 5 && lon <= -30) {
    return "Severní Amerika";
  }

  if (lat < 12 && lon <= -30) {
    return "Jižní Amerika";
  }

  if (lon >= 45 && lon <= 180 && lat >= -10) {
    return "Asie";
  }

  if ((lon >= 110 && lat < -10) || (lon >= 150 && lat <= 10)) {
    return "Oceánie";
  }

  return "Jiné";
}

export function enrichQsoRecords(records: QsoRecord[], homeLocator = ""): EnrichedQsoRecord[] {
  const homeCoordinates = maidenheadToLatLon(homeLocator);

  return records.map((record) => ({
    ...record,
    continent: getContinentLabel(record.lat, record.lon),
    distanceKm:
      homeCoordinates.lat !== null &&
      homeCoordinates.lon !== null &&
      record.lat !== null &&
      record.lon !== null
        ? haversineDistanceKm(
            { lat: homeCoordinates.lat, lon: homeCoordinates.lon },
            { lat: record.lat, lon: record.lon },
          )
        : null,
  }));
}

export function getLargestDx<T extends { distanceKm: number | null }>(records: T[]) {
  return records.reduce<T | null>((currentMax, record) => {
    if (record.distanceKm === null) {
      return currentMax;
    }

    if (!currentMax || record.distanceKm > (currentMax.distanceKm ?? 0)) {
      return record;
    }

    return currentMax;
  }, null);
}
