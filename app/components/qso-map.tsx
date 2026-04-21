"use client";

import "leaflet/dist/leaflet.css";

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
  };
};

const distanceRanges = [
  { value: "", label: "Všechny vzdálenosti" },
  { value: "0-500", label: "do 500 km" },
  { value: "500-1500", label: "500 až 1500 km" },
  { value: "1500-3000", label: "1500 až 3000 km" },
  { value: "3000+", label: "nad 3000 km" },
];

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

export function QsoMap({ mode = "public", refreshToken = 0, layout = "split", highlightedQsoKey = null, filters }: QsoMapProps) {
  const isPublicMap = mode === "public";
  const syncIntervalMs = isPublicMap ? 15000 : 10000;

  const [records, setRecords] = useState<QsoRecord[]>(fallbackQsoRecords);
  const [selectedBand, setSelectedBand] = useState("");
  const [selectedMode, setSelectedMode] = useState("");
  const [selectedContinent, setSelectedContinent] = useState("");
  const [selectedDistanceRange, setSelectedDistanceRange] = useState("");
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [homeLocator] = useState(() => readHomeLocator());
  const [localRefreshTick, setLocalRefreshTick] = useState(0);
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
        return;
      }

      setRecords(data.map((row) => normalizeQsoRecord(row)));

      if (showSyncStatus) {
        setStatus({
          type: "info",
          message: isPublicMap ? "Mapa je synchronizovaná s provozem stanice." : "Soukromá mapa je synchronizovaná s logbookem.",
        });
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

  const availableBands = Array.from(new Set(recordsWithDistance.map((record) => record.band))).sort();
  const availableModes = Array.from(new Set(recordsWithDistance.map((record) => record.mode))).sort();
  const availableDays = Array.from(new Set(recordsWithDistance.map((record) => record.date))).sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0,
  );
  const availableContinents = Array.from(new Set(recordsWithDistance.map((record) => record.continent))).sort();

  const filteredRecords = recordsWithDistance.filter((record) => {
    return (
      matchesBand(record, activeBand) &&
      matchesMode(record, activeMode) &&
      matchesContinent(record, activeContinent) &&
      matchesDistance(record, activeDistanceRange) &&
      matchesDay(record, activeDays) &&
      matchesSearch(record, activeSearch)
    );
  });

  const mapRecords = filteredRecords.filter((record) => record.lat !== null && record.lon !== null);
  const center = averageMapCenter(mapRecords.length ? mapRecords : recordsWithDistance);
  const largestDx = getLargestDx(filteredRecords);

  const toggleDay = (day: string) => {
    setSelectedDays((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day],
    );
  };

  const filtersPanel = (
    <div className="glass-panel rounded-[2.2rem] p-6">
      <p className="text-xs uppercase tracking-[0.4em] text-slate-500">{isPublicMap ? "Filtry mapy" : "Filtry soukromé mapy"}</p>

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
          <p className="mb-2 text-sm font-medium text-slate-700">Aktivní dny</p>
          <div className="flex flex-wrap gap-2">
            {availableDays.map((day) => {
              const active = activeDays.includes(day);

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    active ? "bg-slate-950 text-white" : "bg-white text-slate-700"
                  }`}
                >
                  {formatActivityDate(day)}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  const mapPanel = (
    <div className="glass-panel rounded-[2.2rem] p-5 md:p-6">
      <div className="overflow-hidden rounded-[1.8rem] border border-slate-900/10">
        <MapContainer
          center={[center.lat, center.lon]}
          zoom={5}
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
                    key={`line-${key}`}
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
                key={key}
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
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

      <div className="rounded-[2.2rem] border border-slate-900/8 bg-slate-950 p-6 text-white">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Výsledek filtru</p>
        <p className="mt-4 text-4xl font-semibold">{filteredRecords.length}</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">Tolik spojení odpovídá zvoleným filtrům.</p>

        {status ? (
          <p className="mt-5 rounded-[1.2rem] bg-white/8 px-4 py-3 text-sm leading-6 text-slate-200">{status.message}</p>
        ) : null}
      </div>

      <div className="glass-panel rounded-[2.2rem] p-6">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Aktuální spojení</p>
        <div className={`${layout === "wide" ? "max-h-96" : "max-h-72"} mt-4 space-y-3 overflow-auto pr-1`}>
          {filteredRecords.map((record, index) => {
            const isLargest = largestDx ? getQsoKey(largestDx) === getQsoKey(record, index) : false;

            return (
              <div
                key={getQsoKey(record, index)}
                className={`rounded-[1.2rem] px-4 py-4 ${
                  isLargest ? "border border-red-200 bg-red-50" : "bg-slate-100"
                }`}
              >
                <p className="font-medium text-slate-950">{record.callsign}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {record.date} / {record.band} / {record.mode}
                </p>
                <p className="mt-1 text-sm text-slate-500">{record.locator || "Bez lokátoru"}</p>
                <p className="mt-1 text-sm text-slate-500">{record.continent}</p>
                {record.distanceKm !== null ? (
                  <p className={`mt-1 text-sm ${isLargest ? "font-semibold text-red-700" : "text-slate-600"}`}>
                    {record.distanceKm} km od domácího lokátoru
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );

  if (layout === "wide") {
    return (
      <section className="space-y-6">
        {!filters ? filtersPanel : null}
        {mapPanel}
        <div className="grid gap-6 xl:grid-cols-[0.8fr_0.8fr_1.2fr]">{statsPanels}</div>
      </section>
    );
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      {mapPanel}
      <aside className="space-y-6">
        {!filters ? filtersPanel : null}
        {statsPanels}
      </aside>
    </section>
  );
}
