"use client";

import "leaflet/dist/leaflet.css";

import { dxccEntities, findDxcc } from "@ham-core/fast-dxcc";
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from "react-leaflet";

import {
  averageMapCenter,
  enrichQsoRecords,
  fallbackQsoRecords,
  formatActivityDate,
  getLargestDx,
  getQsoKey,
  maidenheadToLatLon,
  normalizeBand,
  normalizeQsoRecord,
  qsoSelectFields,
  type EnrichedQsoRecord,
  type QsoRecord,
} from "@/src/lib/qso-data";
import { readHomeLocator } from "@/src/lib/station-settings";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/src/lib/supabase";

type MapStatus =
  | {
      type: "info" | "error";
      message: string;
    }
  | null;

type TrafficType = "all" | "digi" | "phone";

type QsoMapProps = {
  mode?: "public" | "private";
  refreshToken?: number;
  layout?: "split" | "wide";
  highlightedQsoKey?: string | null;
  filters?: {
    search?: string;
    band?: string;
    mode?: string;
    continent?: string;
    distanceRange?: string;
    days?: string[];
    trafficType?: TrafficType;
  };
};

const distanceRanges = [
  { value: "", label: "Všechny vzdálenosti" },
  { value: "0-500", label: "do 500 km" },
  { value: "500-1500", label: "500 až 1500 km" },
  { value: "1500-3000", label: "1500 až 3000 km" },
  { value: "3000+", label: "nad 3000 km" },
];

const continentLabelByCode = new Map<string, string>([
  ["EU", "Evropa"],
  ["AF", "Afrika"],
  ["NA", "Severní Amerika"],
  ["SA", "Jižní Amerika"],
  ["AS", "Asie"],
  ["OC", "Oceánie"],
  ["AN", "Antarktida"],
]);

const allPrefixesByContinent = (() => {
  const setByContinent = new Map<string, Set<string>>();

  for (const entity of dxccEntities.values()) {
    if (!entity.primaryPrefix) {
      continue;
    }

    const continent = continentLabelByCode.get(entity.cont ?? "") ?? "Neznámý";
    if (!setByContinent.has(continent)) {
      setByContinent.set(continent, new Set<string>());
    }
    setByContinent.get(continent)?.add(entity.primaryPrefix);
  }

  return new Map<string, string[]>(
    Array.from(setByContinent.entries()).map(([continent, prefixes]) => [continent, Array.from(prefixes).sort((a, b) => a.localeCompare(b, "en"))]),
  );
})();

const totalPrefixesByContinent = (() => {
  return new Map<string, number>(Array.from(allPrefixesByContinent.entries()).map(([continent, prefixes]) => [continent, prefixes.length]));
})();

const digitalModes = new Set([
  "FT8",
  "FT4",
  "PSK31",
  "RTTY",
  "MFSK",
  "JT65",
  "JT9",
  "JS8",
  "WSPR",
  "OLIVIA",
  "THOR",
  "PACKET",
  "SSTV",
  "FSK441",
  "MSK144",
  "ROS",
]);

const phoneModes = new Set(["SSB", "USB", "LSB", "FM", "AM", "SAM", "DV", "FREEDV"]);

function matchesDay(record: QsoRecord, activeDays: string[]) {
  return !activeDays.length || activeDays.includes(record.date);
}

function matchesBand(record: QsoRecord, band: string) {
  return !band || normalizeBand(record.band) === normalizeBand(band);
}

function matchesMode(record: QsoRecord, mode: string) {
  return !mode || record.mode.toLowerCase() === mode.toLowerCase();
}

function matchesSearch(record: QsoRecord, query: string) {
  if (!query) {
    return true;
  }

  const haystack = `${record.callsign} ${record.locator} ${record.note ?? ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function normalizeModeValue(mode: string) {
  return (mode || "").trim().toUpperCase();
}

function getModeFamily(mode: string) {
  const normalizedMode = normalizeModeValue(mode);

  if (digitalModes.has(normalizedMode)) {
    return "digi";
  }
  if (phoneModes.has(normalizedMode)) {
    return "phone";
  }

  return "other";
}

function matchesTrafficType(record: QsoRecord, trafficType: TrafficType) {
  if (trafficType === "all") {
    return true;
  }

  return getModeFamily(record.mode) === trafficType;
}

function matchesContinent(record: EnrichedQsoRecord, continent: string) {
  return !continent || record.continent === continent;
}

function matchesDistance(record: EnrichedQsoRecord, range: string) {
  if (!range) {
    return true;
  }

  if (record.distanceKm === null) {
    return false;
  }

  if (range === "0-500") {
    return record.distanceKm <= 500;
  }
  if (range === "500-1500") {
    return record.distanceKm > 500 && record.distanceKm <= 1500;
  }
  if (range === "1500-3000") {
    return record.distanceKm > 1500 && record.distanceKm <= 3000;
  }
  if (range === "3000+") {
    return record.distanceKm > 3000;
  }

  return true;
}

function resolvePrefixFromCallsign(callsign: string) {
  const normalized = callsign.trim().toUpperCase();
  const parts = normalized
    .split("/")
    .map((part) => part.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean);
  const candidates = Array.from(new Set([normalized, ...parts]));

  for (const candidate of candidates) {
    try {
      const dxcc = findDxcc(candidate);
      if (dxcc?.entity?.primaryPrefix) {
        return {
          prefix: dxcc.entity.primaryPrefix,
          continentCode: dxcc.entity.cont ?? "",
        };
      }
    } catch {
      // ignore candidate
    }
  }

  const fallback = parts.find((part) => /[A-Z]/.test(part) && /\d/.test(part)) || normalized.slice(0, 3);
  return {
    prefix: fallback || "",
    continentCode: "",
  };
}

export function QsoMap({
  mode = "public",
  refreshToken = 0,
  layout = "split",
  highlightedQsoKey = null,
  filters,
}: QsoMapProps) {
  const isPublicMap = mode === "public";
  const syncIntervalMs = isPublicMap ? 15000 : 10000;

  const [records, setRecords] = useState<QsoRecord[]>(fallbackQsoRecords);
  const [selectedBand, setSelectedBand] = useState("");
  const [selectedMode, setSelectedMode] = useState("");
  const [selectedContinent, setSelectedContinent] = useState("");
  const [selectedDistanceRange, setSelectedDistanceRange] = useState("");
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [selectedTrafficType, setSelectedTrafficType] = useState<TrafficType>("all");
  const [search, setSearch] = useState("");
  const [calendarMonth, setCalendarMonth] = useState("");
  const [homeLocator] = useState(() => readHomeLocator());
  const [localRefreshTick, setLocalRefreshTick] = useState(0);
  const [expandedContinent, setExpandedContinent] = useState<string | null>(null);
  const [status, setStatus] = useState<MapStatus>(
    isSupabaseConfigured()
      ? null
      : {
          type: "info",
          message: "Mapa zatím běží nad ukázkovými daty.",
        },
  );

  useEffect(() => {
    const handleChanged = () => {
      setLocalRefreshTick((current) => current + 1);
    };

    window.addEventListener("qso:changed", handleChanged);
    return () => window.removeEventListener("qso:changed", handleChanged);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !isSupabaseConfigured()) {
      return;
    }

    let isMounted = true;

    const loadRecords = async (showSyncStatus = false) => {
      const { data, error } = await supabase.from("qso_logs").select(qsoSelectFields).order("date", { ascending: false });

      if (!isMounted) {
        return;
      }

      if (error) {
        setStatus({
          type: "error",
          message: isPublicMap ? "Nepodařilo se načíst mapu." : "Nepodařilo se načíst soukromou mapu.",
        });
        return;
      }

      if (!data?.length) {
        setStatus({
          type: "info",
          message: isPublicMap ? "Na mapě zatím nejsou žádná spojení." : "Soukromá mapa zatím nemá žádné záznamy.",
        });
        setRecords([]);
        return;
      }

      setRecords(data.map((row) => normalizeQsoRecord(row)));

      if (showSyncStatus) {
        setStatus(null);
      }
    };

    void loadRecords(true);

    const intervalId = window.setInterval(() => {
      void loadRecords(false);
    }, syncIntervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadRecords(true);
      }
    };

    const handleWindowFocus = () => {
      void loadRecords(true);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [isPublicMap, localRefreshTick, refreshToken, syncIntervalMs]);

  const homeCoordinates = useMemo(() => maidenheadToLatLon(homeLocator), [homeLocator]);
  const recordsWithDistance = useMemo(() => enrichQsoRecords(records, homeLocator), [homeLocator, records]);

  const activeSearch = filters?.search ?? search;
  const activeBand = filters?.band ?? selectedBand;
  const activeMode = filters?.mode ?? selectedMode;
  const activeContinent = filters?.continent ?? selectedContinent;
  const activeDistanceRange = filters?.distanceRange ?? selectedDistanceRange;
  const activeDays = filters?.days ?? selectedDays;
  const activeTrafficType = filters?.trafficType ?? selectedTrafficType;

  const availableBands = Array.from(new Set(recordsWithDistance.map((record) => record.band))).sort();
  const availableModes = Array.from(new Set(recordsWithDistance.map((record) => record.mode))).sort();
  const availableDays = Array.from(new Set(recordsWithDistance.map((record) => record.date))).sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0,
  );
  const availableContinents = Array.from(new Set(recordsWithDistance.map((record) => record.continent))).sort();
  const availableDaySet = useMemo(() => new Set(availableDays), [availableDays]);

  const calendarMonths = useMemo(() => {
    const months = new Set<string>();

    for (const day of availableDays) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        months.add(day.slice(0, 7));
      }
    }

    return Array.from(months).sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
  }, [availableDays]);

  const activeCalendarMonth = calendarMonths.includes(calendarMonth) ? calendarMonth : (calendarMonths[0] ?? "");

  const filteredRecords = recordsWithDistance.filter((record) => {
    return (
      matchesBand(record, activeBand) &&
      matchesMode(record, activeMode) &&
      matchesTrafficType(record, activeTrafficType) &&
      matchesContinent(record, activeContinent) &&
      matchesDistance(record, activeDistanceRange) &&
      matchesDay(record, activeDays) &&
      matchesSearch(record, activeSearch)
    );
  });

  const mapRecords = filteredRecords.filter((record) => record.lat !== null && record.lon !== null);
  const uniqueCallsignsCount = new Set(filteredRecords.map((record) => record.callsign.trim().toUpperCase())).size;
  const uniqueContinentsCount = new Set(filteredRecords.map((record) => record.continent)).size;
  const activeDaysCount = activeDays.length;
  const mappedRatio = filteredRecords.length ? Math.round((mapRecords.length / filteredRecords.length) * 100) : 0;
  const center = averageMapCenter(mapRecords.length ? mapRecords : recordsWithDistance);
  const largestDx = getLargestDx(filteredRecords);

  const prefixStatsByContinent = (() => {
    const workedSetByContinent = new Map<string, Set<string>>();

    for (const record of filteredRecords) {
      const resolved = resolvePrefixFromCallsign(record.callsign);
      if (!resolved.prefix) {
        continue;
      }

      const continent = continentLabelByCode.get(resolved.continentCode) || record.continent || "Neznámý";
      if (!workedSetByContinent.has(continent)) {
        workedSetByContinent.set(continent, new Set<string>());
      }
      workedSetByContinent.get(continent)?.add(resolved.prefix);
    }

    return Array.from(totalPrefixesByContinent.entries())
      .map(([continent, total]) => {
        const allPrefixes = allPrefixesByContinent.get(continent) ?? [];
        const workedPrefixes = Array.from(workedSetByContinent.get(continent) ?? []).sort((a, b) => a.localeCompare(b, "en"));
        const workedCount = workedPrefixes.length;
        const workedPrefixSet = new Set(workedPrefixes);
        return {
          continent,
          allPrefixes,
          workedPrefixes,
          workedPrefixSet,
          workedCount,
          totalCount: total,
          percentage: total > 0 ? Math.round((workedCount / total) * 100) : 0,
        };
      })
      .filter((item) => item.totalCount > 0)
      .sort((left, right) => right.workedCount - left.workedCount || left.continent.localeCompare(right.continent, "cs"));
  })();

  const activeExpandedContinent =
    expandedContinent && prefixStatsByContinent.some((item) => item.continent === expandedContinent) ? expandedContinent : null;

  const calendarCells = useMemo(() => {
    if (!activeCalendarMonth) {
      return [] as Array<
        | { type: "empty" }
        | { type: "day"; dayNumber: number; dateKey: string; isActive: boolean; isSelected: boolean }
      >;
    }

    const [yearRaw, monthRaw] = activeCalendarMonth.split("-");
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (!year || !month) {
      return [] as Array<
        | { type: "empty" }
        | { type: "day"; dayNumber: number; dateKey: string; isActive: boolean; isSelected: boolean }
      >;
    }

    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstWeekdayMonday = (firstDay.getDay() + 6) % 7;
    const cells: Array<
      | { type: "empty" }
      | { type: "day"; dayNumber: number; dateKey: string; isActive: boolean; isSelected: boolean }
    > = [];

    for (let index = 0; index < firstWeekdayMonday; index += 1) {
      cells.push({ type: "empty" });
    }

    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
      const dateKey = `${activeCalendarMonth}-${String(dayNumber).padStart(2, "0")}`;
      cells.push({
        type: "day",
        dayNumber,
        dateKey,
        isActive: availableDaySet.has(dateKey),
        isSelected: activeDays.includes(dateKey),
      });
    }

    return cells;
  }, [activeCalendarMonth, activeDays, availableDaySet]);

  const toggleDay = (day: string) => {
    setSelectedDays((current) => (current.includes(day) ? current.filter((value) => value !== day) : [...current, day]));
  };

  const filtersPanel = (
    <div className="glass-panel rounded-[2.2rem] p-6">
      <p className="text-xs uppercase tracking-[0.4em] text-slate-500">{isPublicMap ? "Nastavení filtru mapy" : "Nastavení soukromé mapy"}</p>

      <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <label className="mb-2 block text-sm font-medium text-slate-700">Vyhledat callsign nebo lokátor</label>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="např. DL1ABC nebo JO62"
            className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none transition focus:border-sky-500/35"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Pásmo</label>
          <select
            value={selectedBand}
            onChange={(event) => setSelectedBand(event.target.value)}
            className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
          >
            <option value="">Všechna pásma</option>
            {availableBands.map((band) => (
              <option key={band} value={band}>
                {band}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Mód</label>
          <select
            value={selectedMode}
            onChange={(event) => setSelectedMode(event.target.value)}
            className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
          >
            <option value="">Všechny módy</option>
            {availableModes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Kontinent</label>
          <select
            value={selectedContinent}
            onChange={(event) => setSelectedContinent(event.target.value)}
            className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
          >
            <option value="">Všechny kontinenty</option>
            {availableContinents.map((continent) => (
              <option key={continent} value={continent}>
                {continent}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Vzdálenost</label>
          <select
            value={selectedDistanceRange}
            onChange={(event) => setSelectedDistanceRange(event.target.value)}
            className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
          >
            {distanceRanges.map((range) => (
              <option key={range.value || "all"} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Aktivní dny</label>
          <details className="rounded-[1.2rem] border border-slate-900/10 bg-white">
            <summary className="cursor-pointer list-none rounded-[1.2rem] px-4 py-3 text-sm font-medium text-slate-700">
              Vybrat v kalendáři
            </summary>

            <div className="space-y-3 border-t border-slate-900/10 px-4 pb-4 pt-3">
              <select
                value={activeCalendarMonth}
                onChange={(event) => setCalendarMonth(event.target.value)}
                className="w-full rounded-[0.9rem] border border-slate-900/10 bg-white px-3 py-2 text-sm outline-none"
              >
                {calendarMonths.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-[0.08em] text-slate-500">
                {["Po", "Út", "St", "Čt", "Pá", "So", "Ne"].map((dayLabel) => (
                  <div key={dayLabel}>{dayLabel}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {calendarCells.map((cell, index) => {
                  if (cell.type === "empty") {
                    return <div key={`empty-${index}`} className="h-9 rounded-[0.6rem] bg-slate-50" />;
                  }

                  return (
                    <button
                      key={cell.dateKey}
                      type="button"
                      onClick={() => (cell.isActive ? toggleDay(cell.dateKey) : null)}
                      disabled={!cell.isActive}
                      className={`h-9 rounded-[0.6rem] text-sm transition ${
                        cell.isSelected
                          ? "bg-red-700 text-white"
                          : cell.isActive
                            ? "bg-red-100 text-red-800 hover:bg-red-200"
                            : "bg-slate-50 text-slate-300"
                      } disabled:cursor-not-allowed`}
                      title={cell.isActive ? formatActivityDate(cell.dateKey) : "Bez provozu"}
                    >
                      {cell.dayNumber}
                    </button>
                  );
                })}
              </div>

              <p className="text-xs leading-5 text-slate-500">
                Aktivní dny jsou zvýrazněné červeně. Kliknutím je zapneš nebo vypneš ve filtru mapy.
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );

  const mapPanel = (
    <div className="glass-panel rounded-[2.2rem] p-5 md:p-6">
      <div className="overflow-hidden rounded-[1.8rem] border border-slate-900/10">
        <MapContainer
          center={[center.lat, center.lon]}
          zoom={3}
          scrollWheelZoom
          className={`${layout === "wide" ? "h-[42rem] md:h-[48rem]" : "h-[34rem]"} w-full`}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {homeCoordinates.lat !== null && homeCoordinates.lon !== null
            ? mapRecords.map((record, index) => {
                const key = getQsoKey(record, index);
                const isLargest = largestDx ? getQsoKey(largestDx) === key : false;
                const isHighlighted = highlightedQsoKey === key;

                return (
                  <Polyline
                    key={`line-${key}-${index}`}
                    positions={[
                      [homeCoordinates.lat, homeCoordinates.lon],
                      [record.lat ?? 0, record.lon ?? 0],
                    ]}
                    pathOptions={{
                      color: isLargest ? "#dc2626" : isHighlighted ? "#f59e0b" : isPublicMap ? "#60a5fa" : "#2dd4bf",
                      weight: isLargest ? 4 : isHighlighted ? 3 : 1.5,
                      opacity: isLargest || isHighlighted ? 0.9 : 0.55,
                    }}
                  />
                );
              })
            : null}

          {mapRecords.map((record, index) => {
            const key = getQsoKey(record, index);
            const isLargest = largestDx ? getQsoKey(largestDx) === key : false;
            const isHighlighted = highlightedQsoKey === key;

            return (
              <CircleMarker
                key={`marker-${key}-${index}`}
                center={[record.lat ?? 0, record.lon ?? 0]}
                pathOptions={{
                  color: isLargest ? "#b91c1c" : isHighlighted ? "#b45309" : isPublicMap ? "#1d4ed8" : "#0f766e",
                  fillColor: isLargest ? "#ef4444" : isHighlighted ? "#f59e0b" : isPublicMap ? "#60a5fa" : "#34d399",
                  fillOpacity: 0.9,
                }}
                radius={isLargest ? 10 : isHighlighted ? 9 : 8}
              >
                <Popup>
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold">{record.callsign}</p>
                    <p>
                      {record.band} / {record.mode}
                    </p>
                    <p>
                      {record.date}
                      {record.timeOn ? ` ${record.timeOn}` : ""}
                    </p>
                    <p>{record.locator || "Bez lokátoru"}</p>
                    {record.operator ? <p>Operátor: {record.operator}</p> : null}
                    {record.rstSent || record.rstRcvd ? (
                      <p>
                        RST: {record.rstSent || "--"} / {record.rstRcvd || "--"}
                      </p>
                    ) : null}
                    {record.distanceKm !== null ? <p>Vzdálenost: {record.distanceKm} km</p> : null}
                    {isLargest ? <p className="font-semibold text-red-700">Nejdelší DX v aktuálním filtru</p> : null}
                    {isHighlighted ? <p className="font-semibold text-amber-700">Aktuálně vybrané spojení</p> : null}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );

  const statsPanels = (
    <>
      <div className="hidden">
        <div className="rounded-[2.2rem] border border-slate-900/8 bg-slate-950 p-6 text-white">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Domácí lokátor</p>
          <p className="mt-4 text-3xl font-semibold">{homeLocator || "nenastaven"}</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">Používá se pro výpočet vzdáleností i zvýraznění největšího DX.</p>
        </div>

        <div className="rounded-[2.2rem] border border-red-500/30 bg-red-950 p-6 text-white shadow-[0_18px_40px_rgba(127,29,29,0.18)]">
          <p className="text-xs uppercase tracking-[0.4em] text-red-200">Největší DX</p>
          <p className="mt-4 text-3xl font-semibold">
            {largestDx?.distanceKm !== null && largestDx?.distanceKm !== undefined ? `${largestDx.distanceKm} km` : "--"}
          </p>
          <p className="mt-2 text-sm leading-6 text-red-100/90">
            {largestDx ? `${largestDx.callsign} / ${largestDx.band} / ${largestDx.date}` : "Pro výpočet je potřeba domácí lokátor."}
          </p>
        </div>
      </div>

      <div className="rounded-[2.2rem] border border-slate-900/8 bg-slate-950 p-6 text-white lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-5">
        <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Výsledek filtru</p>
        <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-3">
          <p className="text-5xl font-semibold leading-none">{filteredRecords.length}</p>
          <p className="whitespace-nowrap rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">
            Na mapě {mapRecords.length}
          </p>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">Spojení odpovídající aktuálním filtrům.</p>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-[0.95rem] border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-300">Značky</p>
            <p className="mt-1 text-base font-semibold text-white">{uniqueCallsignsCount}</p>
          </div>
          <div className="rounded-[0.95rem] border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-300">Kont.</p>
            <p className="mt-1 text-base font-semibold text-white">{uniqueContinentsCount}</p>
          </div>
          <div className="rounded-[0.95rem] border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-300">Dny</p>
            <p className="mt-1 text-base font-semibold text-white">{activeDaysCount}</p>
          </div>
        </div>

        <div className="hidden mt-4 divide-y divide-white/10 rounded-[1.1rem] border border-white/10 bg-white/5">
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-slate-300">Volací značky</span>
            <span className="font-semibold text-white">{uniqueCallsignsCount}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-slate-300">Kontinenty</span>
            <span className="font-semibold text-white">{uniqueContinentsCount}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-slate-300">Vybrané dny</span>
            <span className="font-semibold text-white">{activeDaysCount}</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-[0.95rem] border border-white/10 bg-white/5 px-3 py-2.5">
          <p className="text-xs text-slate-300">Geolokace dostupná</p>
          <p className="text-sm font-semibold text-cyan-200">{mappedRatio}%</p>
        </div>

        </div>

        <div className="min-w-0 rounded-[1.2rem] border border-red-400/30 bg-red-900/30 p-4">
          <p className="text-xs uppercase tracking-[0.3em] text-red-100">Největší DX</p>
          <p className="mt-3 text-4xl font-semibold leading-none text-white">
            {largestDx?.distanceKm !== null && largestDx?.distanceKm !== undefined ? `${largestDx.distanceKm} km` : "--"}
          </p>
          <p className="mt-3 text-sm leading-6 text-red-100/90">
            {largestDx ? `${largestDx.callsign} / ${largestDx.band} / ${largestDx.date}` : "Pro výpočet nastav domácí lokátor."}
          </p>
        </div>

        {status?.type === "error" ? (
          <p className="mt-4 rounded-[1.2rem] bg-red-500/20 px-4 py-3 text-sm leading-6 text-red-100 lg:col-span-2">{status.message}</p>
        ) : null}
      </div>

      <div className="glass-panel rounded-[2.2rem] p-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Hotové prefixy podle kontinentů</p>
          <div className="flex flex-wrap gap-2">
            {[
              { value: "all", label: "Vše" },
              { value: "digi", label: "Digi" },
              { value: "phone", label: "Phone" },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setSelectedTrafficType(item.value as TrafficType)}
                className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                  activeTrafficType === item.value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {prefixStatsByContinent.length ? (
            prefixStatsByContinent.map((item) => (
              <div key={item.continent} className="rounded-[1rem] border border-slate-200 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setExpandedContinent((current) => (current === item.continent ? null : item.continent))}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
                >
                  <span className="text-sm font-medium text-slate-800">{item.continent}</span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-red-700 px-2.5 py-1 text-xs font-semibold text-white">
                      {item.workedCount}/{item.totalCount}
                    </span>
                    <span className="text-xs font-semibold text-slate-600">{item.percentage}%</span>
                  </span>
                </button>

                <div className="px-4 pb-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-red-600 transition-all" style={{ width: `${Math.min(item.percentage, 100)}%` }} />
                  </div>
                </div>

                {activeExpandedContinent === item.continent ? (
                  <div className="border-t border-slate-200 px-4 py-3">
                    {item.allPrefixes.length ? (
                      <div className="max-h-44 overflow-auto pr-1">
                        <div className="flex flex-wrap gap-2">
                          {item.allPrefixes.map((prefix) => {
                            const isWorked = item.workedPrefixSet.has(prefix);
                            return (
                              <span
                                key={`${item.continent}-${prefix}`}
                                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                  isWorked ? "bg-red-600 text-white" : "bg-white text-slate-500"
                                }`}
                              >
                                {prefix}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">V aktuálním filtru zatím není žádný hotový prefix.</p>
                    )}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p className="rounded-[1rem] bg-slate-100 px-3 py-3 text-sm text-slate-600">Pro aktuální filtr zatím nejsou dostupné prefixy.</p>
          )}
        </div>
      </div>
    </>
  );

  if (layout === "wide") {
    return (
      <section className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-2">{statsPanels}</div>
        {!filters ? filtersPanel : null}
        {mapPanel}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        {mapPanel}
        <aside className="space-y-6">
          {statsPanels}
          {!filters ? filtersPanel : null}
        </aside>
      </div>
    </section>
  );
}
