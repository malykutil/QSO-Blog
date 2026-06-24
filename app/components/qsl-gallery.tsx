"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  enrichQsoRecords,
  fallbackQsoRecords,
  getLargestDx,
  getQsoKey,
  normalizeBand,
  normalizeQsoRecord,
  qsoSelectFields,
  type EnrichedQsoRecord,
  type QsoRecord,
} from "@/src/lib/qso-data";
import { getHomeLocatorServerSnapshot, readHomeLocator, subscribeHomeLocator } from "@/src/lib/station-settings";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/src/lib/supabase";

type TrafficType = "all" | "digi" | "phone";

const digitalModes = new Set([
  "FT8",
  "FT4",
  "JS8",
  "JS8CALL",
  "JT65",
  "JT9",
  "MFSK",
  "PSK31",
  "ROS",
  "RTTY",
  "SSTV",
  "THOR",
  "WSPR",
  "PACKET",
]);

const phoneModes = new Set(["AM", "DV", "FM", "LSB", "SSB", "USB", "FREEDV", "FM-N"]);

const QslRouteMap = dynamic(
  () => import("@/app/components/qsl-route-map").then((module) => module.QslRouteMap),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-[1.6rem] border border-slate-900/10 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        Načítám mapu trasy...
      </div>
    ),
  },
);

function formatDisplayDate(value: string) {
  if (!value) {
    return "--";
  }

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

function formatDisplayTime(value: string | undefined) {
  if (!value) {
    return "--";
  }

  return value.slice(0, 5);
}

function getModeFamily(mode: string) {
  const normalized = mode.trim().toUpperCase();

  if (digitalModes.has(normalized)) {
    return "digi";
  }

  if (phoneModes.has(normalized)) {
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

function matchesSearch(record: QsoRecord, query: string) {
  if (!query) {
    return true;
  }

  const haystack = [record.callsign, record.band, record.mode, record.locator, record.note ?? "", record.operator ?? ""]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function matchesDateRange(recordDate: string, from: string, to: string) {
  if (from && recordDate < from) {
    return false;
  }

  if (to && recordDate > to) {
    return false;
  }

  return true;
}

function QslCardPreview({
  record,
  active,
}: {
  record: EnrichedQsoRecord;
  active: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[1.7rem] border bg-[#f6efe4] transition ${
        active
          ? "border-red-400/70 shadow-[0_24px_70px_rgba(185,28,28,0.16)]"
          : "border-slate-900/8 shadow-[0_20px_50px_rgba(15,23,42,0.10)] hover:-translate-y-0.5 hover:shadow-[0_28px_70px_rgba(15,23,42,0.14)]"
      }`}
    >
      <div className="relative aspect-[3/2]">
        <Image src="/qsl-template.png" alt="" fill className="object-cover" unoptimized />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(255,255,255,0.04),_rgba(12,18,32,0.22))]" />

        <div className="absolute left-4 right-4 top-4 flex items-start justify-between gap-3">
          <span className="rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-700 shadow-sm">
            {record.isPublic ? "Veřejná" : "Soukromá"}
          </span>
          <span className="rounded-full bg-slate-950/88 px-3 py-1 text-xs font-semibold text-white shadow-sm">
            {record.band || "--"} · {record.mode || "--"}
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="rounded-[1.35rem] bg-white/88 p-4 backdrop-blur-sm">
            <p className="text-[10px] uppercase tracking-[0.34em] text-slate-500">QSL karta</p>
            <div className="mt-2 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="font-display text-3xl leading-none text-slate-950">{record.callsign || "--"}</p>
                <p className="mt-2 text-sm text-slate-600">
                  {formatDisplayDate(record.date)} · {record.locator || "bez lokátoru"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">DX</p>
                <p className="mt-1 text-sm font-semibold text-red-700">{record.distanceKm !== null ? `${record.distanceKm} km` : "--"}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function QslGallery() {
  const [records, setRecords] = useState<QsoRecord[]>(fallbackQsoRecords);
  const [loading, setLoading] = useState(() => isSupabaseConfigured());
  const [status, setStatus] = useState<string | null>(() => (isSupabaseConfigured() ? null : "Zobrazuji ukázková data QSL galerie."));
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedBand, setSelectedBand] = useState("");
  const [selectedMode, setSelectedMode] = useState("");
  const [selectedContinent, setSelectedContinent] = useState("");
  const [selectedTrafficType, setSelectedTrafficType] = useState<TrafficType>("all");
  const [publicOnly, setPublicOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const homeLocator = useSyncExternalStore(subscribeHomeLocator, readHomeLocator, getHomeLocatorServerSnapshot);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    if (!supabase || !isSupabaseConfigured()) {
      return;
    }

    let mounted = true;

    const loadRecords = async () => {
      const { data, error } = await supabase.from("qso_logs").select(qsoSelectFields).order("date", { ascending: false });

      if (!mounted) {
        return;
      }

      if (error) {
        setStatus("QSO z databáze se nepodařilo načíst. Zobrazuji ukázková data.");
        setLoading(false);
        return;
      }

      if (data?.length) {
        setRecords(data.map((row) => normalizeQsoRecord(row)));
        setStatus(null);
      } else {
        setRecords([]);
        setStatus("V databázi nejsou zatím žádná QSO data.");
      }

      setLoading(false);
    };

    void loadRecords();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadAuthStatus = async () => {
      try {
        const response = await fetch("/api/auth/status", {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => null)) as { authenticated?: boolean } | null;

        if (!mounted) {
          return;
        }

        setIsLoggedIn(Boolean(payload?.authenticated));
      } catch {
        if (!mounted) {
          return;
        }

        setIsLoggedIn(false);
      }
    };

    void loadAuthStatus();

    return () => {
      mounted = false;
    };
  }, []);

  const recordsWithDistance = useMemo(() => enrichQsoRecords(records, homeLocator), [homeLocator, records]);

  const availableBands = useMemo(
    () => Array.from(new Set(recordsWithDistance.map((record) => record.band).filter(Boolean))).sort((left, right) => left.localeCompare(right, "cs", { numeric: true })),
    [recordsWithDistance],
  );

  const availableModes = useMemo(
    () => Array.from(new Set(recordsWithDistance.map((record) => record.mode).filter(Boolean))).sort((left, right) => left.localeCompare(right, "cs", { numeric: true })),
    [recordsWithDistance],
  );

  const availableContinents = useMemo(
    () => Array.from(new Set(recordsWithDistance.map((record) => record.continent).filter(Boolean))).sort((left, right) => left.localeCompare(right, "cs")),
    [recordsWithDistance],
  );

  const filteredRecords = useMemo(() => {
    const query = search.trim();

    return recordsWithDistance.filter((record) => {
      return (
        (!publicOnly || record.isPublic) &&
        (!selectedBand || normalizeBand(record.band) === normalizeBand(selectedBand)) &&
        (!selectedMode || record.mode.trim().toUpperCase() === selectedMode.trim().toUpperCase()) &&
        (!selectedContinent || record.continent === selectedContinent) &&
        matchesTrafficType(record, selectedTrafficType) &&
        matchesDateRange(record.date, dateFrom, dateTo) &&
        matchesSearch(record, query)
      );
    });
  }, [dateFrom, dateTo, publicOnly, recordsWithDistance, search, selectedBand, selectedContinent, selectedMode, selectedTrafficType]);

  const resolvedSelectedKey = useMemo(() => {
    if (selectedKey && filteredRecords.some((record) => getQsoKey(record) === selectedKey)) {
      return selectedKey;
    }

    return filteredRecords[0] ? getQsoKey(filteredRecords[0]) : null;
  }, [filteredRecords, selectedKey]);

  const selectedRecord = useMemo(
    () => filteredRecords.find((record) => getQsoKey(record) === resolvedSelectedKey) ?? null,
    [filteredRecords, resolvedSelectedKey],
  );

  const largestDx = useMemo(() => getLargestDx(filteredRecords), [filteredRecords]);
  const publicCount = useMemo(() => filteredRecords.filter((record) => record.isPublic).length, [filteredRecords]);
  const selectedImageUrl = selectedRecord?.id && typeof selectedRecord.id === "string" ? `/api/qsl/card/${selectedRecord.id}` : null;

  if (loading) {
    return <p className="text-slate-600">Načítám QSL galerii...</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="relative overflow-hidden rounded-[2.6rem] border border-slate-900/8 bg-[linear-gradient(135deg,_#0b1220_0%,_#10253d_44%,_#184f7a_100%)] p-7 text-white shadow-[0_24px_80px_rgba(13,27,50,0.16)] md:p-9">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,_rgba(255,165,96,0.22),_transparent_18%),radial-gradient(circle_at_left_bottom,_rgba(93,183,255,0.16),_transparent_26%)]" />
        <div className="relative grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.45em] text-sky-100/70">QSL galerie</p>
            <h1 className="mt-4 max-w-3xl font-display text-6xl leading-[0.94] md:text-7xl">Karty propojené s QSO databází</h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-sky-50/82">
              Každý lístek vzniká přímo z uloženého QSO záznamu. Vybereš si rekord, otevřeš velký náhled a hned pod ním vidíš
              trasu spojení z domácí stanice na protistanici.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/mapa" className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-50">
                Otevřít mapu spojení
              </Link>
              <Link href="/blog" className="rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                Blog
              </Link>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-white/10 px-4 py-2 text-sm text-sky-50/80">
                Detail QSL i mapa jsou veřejné. Přidávání a správa zůstává po přihlášení.
              </span>
              {isLoggedIn ? (
                <Link
                  href="/qsl"
                  className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Správa QSL karet
                </Link>
              ) : (
                <Link
                  href="/login?next=/qsl-galerie"
                  className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Přihlásit se pro přidávání
                </Link>
              )}
            </div>
          </div>

          <div className="glass-panel rounded-[2rem] p-6 text-slate-950">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.35rem] border border-slate-900/8 bg-white/85 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Záznamů ve filtru</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{filteredRecords.length}</p>
              </div>
              <div className="rounded-[1.35rem] border border-slate-900/8 bg-white/85 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Veřejných</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{publicCount}</p>
              </div>
              <div className="rounded-[1.35rem] border border-slate-900/8 bg-white/85 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Kontinentů</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{new Set(filteredRecords.map((record) => record.continent)).size}</p>
              </div>
              <div className="rounded-[1.35rem] border border-red-500/20 bg-red-50 p-4">
                <p className="text-[11px] uppercase tracking-[0.28em] text-red-700">Největší DX</p>
                <p className="mt-2 text-3xl font-semibold text-red-700">
                  {largestDx && largestDx.distanceKm !== null ? `${largestDx.distanceKm} km` : "--"}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-[1.35rem] border border-slate-900/8 bg-white/85 p-4">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                {isLoggedIn ? "Soukromá správa" : "Přidávání po přihlášení"}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {isLoggedIn
                  ? "Odtud můžeš přejít do privátní QSL správy a připravit nové karty ke zveřejnění."
                  : "Veřejně je dostupný detail lístku i mapa. Přidávání a správa QSL karet je až po přihlášení."}
              </p>
              <Link
                href={isLoggedIn ? "/qsl" : "/login?next=/qsl-galerie"}
                className="mt-4 inline-flex rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {isLoggedIn ? "Otevřít správu" : "Přihlásit se"}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-[2.2rem] p-6 md:p-8">
        <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="md:col-span-2 xl:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700">Hledat</label>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="callsign, lokátor, pásmo, poznámka"
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
                {availableModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
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

          <div className="space-y-4 rounded-[1.5rem] border border-slate-900/8 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Filtr příspěvků</p>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={publicOnly} onChange={(event) => setPublicOnly(event.target.checked)} />
                Jen veřejné
              </label>
            </div>

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
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    selectedTrafficType === item.value ? "bg-slate-950 text-white" : "bg-white text-slate-700"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Datum od</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Datum do</label>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
            />
          </div>
          <div className="rounded-[1.2rem] border border-slate-900/8 bg-white px-4 py-3 text-sm text-slate-600">
            Pro karty i mapu vybírej podle dat, pásem, módů nebo kontinentů.
          </div>
        </div>

        {status ? <p className="mt-5 rounded-[1.2rem] bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-700">{status}</p> : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {filteredRecords.map((record, index) => {
              const key = getQsoKey(record, index);
              const active = resolvedSelectedKey === key;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedKey(key)}
                  className="text-left"
                >
                  <QslCardPreview record={record} active={active} />
                </button>
              );
            })}
          </div>

          {!filteredRecords.length ? (
            <div className="rounded-[2rem] border border-dashed border-slate-900/12 bg-white/70 p-8 text-center text-slate-600">
              Pro zadaný filtr jsme nenašli žádnou QSL kartu.
            </div>
          ) : null}
        </div>

        <aside className="xl:sticky xl:top-6 space-y-6 self-start">
          {selectedRecord ? (
            <>
              <div className="overflow-hidden rounded-[2.2rem] border border-slate-900/8 bg-slate-950 text-white shadow-[0_24px_80px_rgba(13,27,50,0.16)]">
                <div className="border-b border-white/10 px-6 py-5">
                  <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Vybraný lístek</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <h2 className="font-display text-4xl leading-tight">{selectedRecord.callsign}</h2>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-200">
                      {selectedRecord.band || "--"} / {selectedRecord.mode || "--"}
                    </span>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-200">
                      {selectedRecord.isPublic ? "Veřejné" : "Soukromé"}
                    </span>
                  </div>
                </div>

                <div className="space-y-5 p-6">
                  <div className="overflow-hidden rounded-[1.7rem] border border-white/10 bg-white/5 p-3">
                    {selectedImageUrl ? (
                      <div className="relative aspect-[3/2] overflow-hidden rounded-[1.2rem] bg-[#f6efe4]">
                        <Image
                          src={selectedImageUrl}
                          alt={`QSL karta ${selectedRecord.callsign}`}
                          fill
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <QslCardPreview record={selectedRecord} active />
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.3rem] border border-white/10 bg-white/5 p-4">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Datum a čas</p>
                      <p className="mt-2 text-lg font-semibold text-white">
                        {formatDisplayDate(selectedRecord.date)} {formatDisplayTime(selectedRecord.timeOn)}
                      </p>
                    </div>
                    <div className="rounded-[1.3rem] border border-white/10 bg-white/5 p-4">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Lokátor</p>
                      <p className="mt-2 text-lg font-semibold text-white">{selectedRecord.locator || "bez lokátoru"}</p>
                    </div>
                    <div className="rounded-[1.3rem] border border-white/10 bg-white/5 p-4">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Vzdálenost</p>
                      <p className="mt-2 text-lg font-semibold text-white">{selectedRecord.distanceKm !== null ? `${selectedRecord.distanceKm} km` : "--"}</p>
                    </div>
                    <div className="rounded-[1.3rem] border border-white/10 bg-white/5 p-4">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Kontinent</p>
                      <p className="mt-2 text-lg font-semibold text-white">{selectedRecord.continent}</p>
                    </div>
                  </div>

                  <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Trasa spojení</p>
                    <div className="mt-4">
                      <QslRouteMap record={selectedRecord} homeLocator={homeLocator} />
                    </div>
                  </div>

                  <div className="rounded-[1.6rem] border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Poznámka</p>
                    <p className="mt-3 text-sm leading-6 text-slate-200">{selectedRecord.note || "Bez poznámky."}</p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-[2.2rem] border border-slate-900/8 bg-slate-950 p-6 text-white">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Vybraný lístek</p>
              <p className="mt-4 text-3xl font-semibold">Žádný záznam není vybraný.</p>
              <p className="mt-3 leading-7 text-slate-300">Zvol libovolnou kartu vlevo a zobrazí se velký náhled i mapová trasa QSO.</p>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
