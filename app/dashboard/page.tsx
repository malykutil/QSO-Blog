"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { AdifImportPanel } from "@/app/components/adif-import-panel";
import { AppShell } from "@/app/components/app-shell";
import { QsoMapClient } from "@/app/components/qso-map-client";
import {
  enrichQsoRecords,
  fallbackQsoRecords,
  formatActivityDate,
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

type UserEmail = string | null;

const distanceRanges = [
  { value: "", label: "Všechny vzdálenosti" },
  { value: "0-500", label: "do 500 km" },
  { value: "500-1500", label: "500 až 1500 km" },
  { value: "1500-3000", label: "1500 až 3000 km" },
  { value: "3000+", label: "nad 3000 km" },
];

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

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<UserEmail>(null);
  const [records, setRecords] = useState<QsoRecord[]>(fallbackQsoRecords);
  const [dataStatus, setDataStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedBand, setSelectedBand] = useState("");
  const [selectedMode, setSelectedMode] = useState("");
  const [selectedContinent, setSelectedContinent] = useState("");
  const [selectedDistanceRange, setSelectedDistanceRange] = useState("");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [mapVersion, setMapVersion] = useState(0);
  const [updatingQsoId, setUpdatingQsoId] = useState<string | null>(null);
  const [bulkPublishing, setBulkPublishing] = useState(false);
  const [selectedQsoKey, setSelectedQsoKey] = useState<string | null>(null);
  const homeLocator = useSyncExternalStore(subscribeHomeLocator, readHomeLocator, getHomeLocatorServerSnapshot);
  const router = useRouter();

  useEffect(() => {
    const checkUser = async () => {
      const supabase = getSupabaseBrowserClient();

      if (!supabase) {
        setLoading(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      setUserEmail(user.email ?? null);

      const { data, error } = await supabase
        .from("qso_logs")
        .select(qsoSelectFields)
        .eq("created_by", user.id)
        .order("date", { ascending: false });

      if (error) {
        setDataStatus("Nepodařilo se načíst tabulku qso_logs. Zobrazuji ukázková data.");
      } else if (data?.length) {
        const normalized = data.map((row) => normalizeQsoRecord(row));
        setRecords(normalized);
        setSelectedQsoKey(getQsoKey(normalized[0]));
        setDataStatus(`Načteno ${data.length} záznamů z databáze.`);
      } else {
        setDataStatus("Databáze je zatím prázdná. Můžeš rovnou importovat ADIF.");
      }

      setLoading(false);
    };

    void checkUser();
  }, [router]);

  const handleLogout = async () => {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      router.push("/");
      router.refresh();
      return;
    }

    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  };

  const handleImported = (newRecords: QsoRecord[]) => {
    setRecords((current) => [...newRecords, ...current]);
    setSelectedQsoKey(newRecords.length ? getQsoKey(newRecords[0]) : null);
    setDataStatus(`Poslední import přidal ${newRecords.length} záznamů.`);
    setMapVersion((current) => current + 1);
  };

  const enrichedRecords = useMemo(() => enrichQsoRecords(records, homeLocator), [homeLocator, records]);
  const availableBands = Array.from(new Set(enrichedRecords.map((record) => record.band))).sort();
  const availableModes = Array.from(new Set(enrichedRecords.map((record) => record.mode))).sort();
  const availableContinents = Array.from(new Set(enrichedRecords.map((record) => record.continent))).sort();
  const availableDates = Array.from(new Set(enrichedRecords.map((record) => record.date))).sort((a, b) =>
    a < b ? 1 : a > b ? -1 : 0,
  );

  const filteredRecords = enrichedRecords.filter((record) => {
    const matchesSearch = !search
      ? true
      : `${record.callsign} ${record.locator} ${record.operator || ""}`.toLowerCase().includes(search.toLowerCase());
    const matchesBand = !selectedBand ? true : normalizeBand(record.band) === normalizeBand(selectedBand);
    const matchesMode = !selectedMode ? true : record.mode.toLowerCase() === selectedMode.toLowerCase();
    const matchesContinent = !selectedContinent ? true : record.continent === selectedContinent;
    const matchesDay = !selectedDates.length ? true : selectedDates.includes(record.date);

    return matchesSearch && matchesBand && matchesMode && matchesContinent && matchesDay && matchesDistance(record, selectedDistanceRange);
  });

  const largestDx = getLargestDx(filteredRecords);
  const selectedQso =
    filteredRecords.find((record, index) => getQsoKey(record, index) === selectedQsoKey) ??
    enrichedRecords.find((record, index) => getQsoKey(record, index) === selectedQsoKey) ??
    null;

  const toggleDay = (day: string) => {
    setSelectedDates((current) => (current.includes(day) ? current.filter((value) => value !== day) : [...current, day]));
  };

  const handleTogglePublic = async (qso: QsoRecord) => {
    if (!qso.id) {
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setDataStatus("Změna veřejnosti je momentálně nedostupná.");
      return;
    }

    const qsoKey = getQsoKey(qso);
    setUpdatingQsoId(qsoKey);

    const { data, error } = await supabase
      .from("qso_logs")
      .update({ is_public: !qso.isPublic })
      .eq("id", qso.id)
      .select(qsoSelectFields)
      .single();

    setUpdatingQsoId(null);

    if (error) {
      setDataStatus(`Nepodařilo se změnit veřejnost QSO: ${error.message}`);
      return;
    }

    const updatedRecord = normalizeQsoRecord(data);
    setRecords((current) => current.map((record) => (String(record.id) === String(updatedRecord.id) ? updatedRecord : record)));
    setMapVersion((current) => current + 1);
    setDataStatus(updatedRecord.isPublic ? "Spojení bylo zveřejněno." : "Spojení bylo skryto z veřejné mapy.");
  };

  const handlePublishAll = async () => {
    if (!records.length) {
      setDataStatus("V databázi zatím není žádné QSO ke zveřejnění.");
      return;
    }

    if (!records.some((record) => !record.isPublic)) {
      setDataStatus("Všechna tvoje QSO už jsou veřejná.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setDataStatus("Hromadné zveřejnění je momentálně nedostupné.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setDataStatus("Pro hromadné zveřejnění je potřeba být přihlášený.");
      return;
    }

    setBulkPublishing(true);

    const { error } = await supabase
      .from("qso_logs")
      .update({ is_public: true })
      .eq("created_by", user.id)
      .eq("is_public", false);

    setBulkPublishing(false);

    if (error) {
      setDataStatus(`Nepodařilo se zveřejnit všechna QSO: ${error.message}`);
      return;
    }

    setRecords((current) => current.map((record) => ({ ...record, isPublic: true })));
    setMapVersion((current) => current + 1);
    setDataStatus("Všechna tvoje QSO byla zveřejněna.");
  };

  if (loading) {
    return (
      <AppShell contentClassName="flex items-center justify-center">
        <p className="text-slate-600">Načítám zabezpečený dashboard...</p>
      </AppShell>
    );
  }

  if (!isSupabaseConfigured()) {
    return (
      <AppShell contentClassName="flex items-center">
        <div className="mx-auto w-full max-w-3xl rounded-[2rem] border border-amber-300/30 bg-amber-50 p-8">
          <p className="text-sm uppercase tracking-[0.35em] text-amber-900/70">Dashboard</p>
          <h1 className="mt-3 font-display text-4xl text-slate-950">Chybí platná Supabase konfigurace</h1>
          <p className="mt-4 max-w-2xl leading-7 text-slate-700">
            Přihlášení, import ADIF i databázový dashboard budou fungovat až po doplnění platných hodnot
            `NEXT_PUBLIC_SUPABASE_URL` a `NEXT_PUBLIC_SUPABASE_ANON_KEY` do `.env.local`.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="relative overflow-hidden rounded-[2.4rem] border border-slate-900/8 bg-[linear-gradient(135deg,_#0a1420_0%,_#14314c_42%,_#1f5d8f_100%)] p-7 text-white shadow-[0_24px_80px_rgba(13,27,50,0.16)] md:p-9">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,_rgba(255,165,96,0.22),_transparent_18%),radial-gradient(circle_at_left_bottom,_rgba(93,183,255,0.16),_transparent_26%)]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-sky-100/70">Dashboard</p>
              <h1 className="mt-3 font-display text-5xl leading-tight">Správa QSO a provozu</h1>
              <p className="mt-4 max-w-2xl text-lg leading-8 text-sky-50/80">
                Přihlášený uživatel: <span className="font-medium text-white">{userEmail}</span>
              </p>
            </div>

            <button
              onClick={handleLogout}
              className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-50"
            >
              Odhlásit se
            </button>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
          <section id="import" className="scroll-mt-6 glass-panel rounded-[2rem] p-6 md:p-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Import dat</p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-950">Samostatný ADIF import</h2>
              </div>
              <span className="rounded-full border border-slate-900/10 px-4 py-2 text-xs uppercase tracking-[0.25em] text-slate-500">
                import
              </span>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
              Import nejdřív odfiltruje duplicity v samotném ADIF souboru, pak porovná záznamy s existující databází a
              vloží jen nová QSO.
            </p>
            <div className="mt-6">
              <AdifImportPanel onImported={handleImported} />
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <div className="glass-panel rounded-[2rem] p-6">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Databáze</p>
              <p className="mt-3 text-3xl font-semibold text-slate-950">{records.length}</p>
              <p className="mt-2 text-sm text-slate-600">celkem uložených QSO</p>
            </div>
            <div className="glass-panel rounded-[2rem] p-6">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Kontinenty</p>
              <p className="mt-3 text-3xl font-semibold text-slate-950">{availableContinents.length}</p>
              <p className="mt-2 text-sm text-slate-600">aktuálně v logbooku</p>
            </div>
            <div className="rounded-[2rem] border border-red-500/30 bg-red-950 p-6 text-white shadow-[0_20px_50px_rgba(127,29,29,0.18)]">
              <p className="text-xs uppercase tracking-[0.35em] text-red-200">Největší DX</p>
              <p className="mt-3 text-3xl font-semibold">
                {largestDx?.distanceKm !== null && largestDx?.distanceKm !== undefined ? `${largestDx.distanceKm} km` : "--"}
              </p>
              <p className="mt-2 text-sm text-red-100/90">
                {largestDx ? `${largestDx.callsign} / ${largestDx.band}` : "Nastav domácí lokátor pro výpočet."}
              </p>
            </div>
          </section>
        </section>

        <section id="databaze" className="scroll-mt-6 glass-panel rounded-[2rem] p-6 md:p-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Databáze QSO</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-950">Práce s logbookem</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handlePublishAll()}
                disabled={bulkPublishing || !records.length}
                className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {bulkPublishing ? "Zveřejňuji..." : "Zveřejnit všechna QSO"}
              </button>
              <span className="rounded-full border border-slate-900/10 px-4 py-2 text-xs uppercase tracking-[0.25em] text-slate-500">
                qso_logs
              </span>
            </div>
          </div>

          {dataStatus ? (
            <p className="mt-5 rounded-[1.2rem] bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-700">{dataStatus}</p>
          ) : null}

          <div className="mt-6 grid gap-4 rounded-[1.6rem] bg-slate-100/80 p-4 md:grid-cols-2 xl:grid-cols-5">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Hledat callsign nebo lokátor"
              className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none xl:col-span-2"
            />
            <select
              value={selectedBand}
              onChange={(event) => setSelectedBand(event.target.value)}
              className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
            >
              <option value="">Všechna pásma</option>
              {availableBands.map((band) => (
                <option key={band} value={band}>
                  {band}
                </option>
              ))}
            </select>
            <select
              value={selectedMode}
              onChange={(event) => setSelectedMode(event.target.value)}
              className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
            >
              <option value="">Všechny módy</option>
              {availableModes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
            <select
              value={selectedContinent}
              onChange={(event) => setSelectedContinent(event.target.value)}
              className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
            >
              <option value="">Všechny kontinenty</option>
              {availableContinents.map((continent) => (
                <option key={continent} value={continent}>
                  {continent}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 grid gap-4 rounded-[1.6rem] bg-slate-100/80 p-4 lg:grid-cols-[0.9fr_1.1fr]">
            <select
              value={selectedDistanceRange}
              onChange={(event) => setSelectedDistanceRange(event.target.value)}
              className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
            >
              {distanceRanges.map((range) => (
                <option key={range.value || "all"} value={range.value}>
                  {range.label}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap gap-2">
              {availableDates.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`rounded-full px-3 py-2 text-xs transition ${
                    selectedDates.includes(day) ? "bg-slate-950 text-white" : "bg-white text-slate-700"
                  }`}
                >
                  {formatActivityDate(day)}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 max-h-[26rem] overflow-auto rounded-[1.6rem] border border-slate-900/10">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Callsign</th>
                  <th className="px-4 py-3 font-medium">Pásmo</th>
                  <th className="px-4 py-3 font-medium">Mód</th>
                  <th className="px-4 py-3 font-medium">Datum / čas</th>
                  <th className="px-4 py-3 font-medium">Kontinent</th>
                  <th className="px-4 py-3 font-medium">Vzdálenost</th>
                  <th className="px-4 py-3 font-medium">Veřejnost</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((qso, index) => {
                  const qsoKey = getQsoKey(qso, index);
                  const isLargestDx = largestDx ? getQsoKey(largestDx) === qsoKey : false;
                  const isSelected = selectedQsoKey === qsoKey;

                  return (
                    <tr
                      key={qsoKey}
                      onClick={() => setSelectedQsoKey(qsoKey)}
                      className={`cursor-pointer border-t border-slate-900/8 ${
                        isSelected ? "bg-amber-50" : isLargestDx ? "bg-red-50" : "bg-white/80"
                      }`}
                    >
                      <td className="px-4 py-4 text-slate-950">{qso.callsign}</td>
                      <td className="px-4 py-4 text-slate-700">{qso.band}</td>
                      <td className="px-4 py-4 text-slate-700">{qso.mode}</td>
                      <td className="px-4 py-4 text-slate-700">
                        {qso.date}
                        {qso.timeOn ? ` ${qso.timeOn}` : ""}
                      </td>
                      <td className="px-4 py-4 text-slate-700">{qso.continent}</td>
                      <td className={`px-4 py-4 ${isLargestDx ? "font-semibold text-red-700" : "text-slate-700"}`}>
                        {qso.distanceKm !== null ? `${qso.distanceKm} km` : "--"}
                      </td>
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleTogglePublic(qso);
                          }}
                          disabled={updatingQsoId === qsoKey}
                          className={`rounded-full px-3 py-2 text-xs font-semibold transition ${
                            qso.isPublic
                              ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
                              : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          {updatingQsoId === qsoKey ? "Ukládám..." : qso.isPublic ? "Veřejné" : "Soukromé"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[1.8rem] border border-slate-900/10 bg-slate-100/80 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Detail spojení</p>
              {selectedQso ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-sm text-slate-500">Callsign</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">{selectedQso.callsign}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Datum a čas</p>
                    <p className="mt-1 text-slate-900">
                      {selectedQso.date}
                      {selectedQso.timeOn ? ` ${selectedQso.timeOn}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Pásmo / mód</p>
                    <p className="mt-1 text-slate-900">
                      {selectedQso.band} / {selectedQso.mode}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Kontinent</p>
                    <p className="mt-1 text-slate-900">{selectedQso.continent}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Lokátor</p>
                    <p className="mt-1 text-slate-900">{selectedQso.locator || "--"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Vzdálenost</p>
                    <p className="mt-1 text-slate-900">{selectedQso.distanceKm !== null ? `${selectedQso.distanceKm} km` : "--"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Operátor</p>
                    <p className="mt-1 text-slate-900">{selectedQso.operator || "--"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">RST</p>
                    <p className="mt-1 text-slate-900">
                      {selectedQso.rstSent || "--"} / {selectedQso.rstRcvd || "--"}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-sm text-slate-500">Poznámka</p>
                    <p className="mt-1 text-slate-900">{selectedQso.note || "Bez poznámky."}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-slate-600">Klikni na řádek v tabulce a zobrazí se detail vybraného spojení.</p>
              )}
            </div>

            <div className="rounded-[1.8rem] border border-slate-900/10 bg-slate-100/80 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Stav zveřejnění</p>
              {selectedQso ? (
                <>
                  <p className="mt-4 text-lg font-semibold text-slate-950">{selectedQso.isPublic ? "Spojení je veřejné" : "Spojení je soukromé"}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {selectedQso.isPublic
                      ? "Aktuálně se zobrazuje i na veřejné mapě."
                      : "Aktuálně zůstává jen v soukromé části dashboardu."}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleTogglePublic(selectedQso)}
                    disabled={updatingQsoId === getQsoKey(selectedQso)}
                    className="mt-5 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updatingQsoId === getQsoKey(selectedQso)
                      ? "Ukládám..."
                      : selectedQso.isPublic
                        ? "Skrýt z veřejné mapy"
                        : "Zveřejnit na mapě"}
                  </button>
                </>
              ) : (
                <p className="mt-4 text-sm leading-6 text-slate-600">Vyber spojení, které chceš zveřejnit nebo skrýt.</p>
              )}
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[2rem] p-6 md:p-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Soukromá mapa</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-950">Mapa všech tvých QSO</h2>
            </div>
            <span className="rounded-full border border-slate-900/10 px-4 py-2 text-xs uppercase tracking-[0.25em] text-slate-500">
              private
            </span>
          </div>
          <div className="mt-6">
            <QsoMapClient
              mode="private"
              refreshToken={mapVersion}
              highlightedQsoKey={selectedQsoKey}
              filters={{
                search,
                band: selectedBand,
                mode: selectedMode,
                continent: selectedContinent,
                distanceRange: selectedDistanceRange,
                days: selectedDates,
              }}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
