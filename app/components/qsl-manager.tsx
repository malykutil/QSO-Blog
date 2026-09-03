"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { enrichQsoRecords, normalizeQsoRecord, qsoSelectFields, type EnrichedQsoRecord, type QsoRecord } from "@/src/lib/qso-data";
import {
  ensureQslQueueForRecords,
  getQslStatusLabel,
  isValidEmail,
  normalizeEmail,
  normalizeQslQueueItem,
  qslQueueSelectFields,
  type QslQueueItem,
  type QslStatus,
} from "@/src/lib/qsl-data";
import {
  getHomeLocatorServerSnapshot,
  readHamqthSettings,
  readHomeLocator,
  readQrzSettings,
  subscribeHomeLocator,
} from "@/src/lib/station-settings";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/src/lib/supabase";

const QslRouteMap = dynamic(
  () => import("@/app/components/qsl-route-map").then((module) => module.QslRouteMap),
  {
    ssr: false,
    loading: () => <div className="h-[28rem] animate-pulse rounded-[1.5rem] bg-slate-100" />,
  },
);

function formatDateTime(value: string | null) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getStatusClasses(status: QslStatus) {
  if (status === "sent") {
    return "bg-emerald-100 text-emerald-900";
  }

  if (status === "ready") {
    return "bg-sky-100 text-sky-900";
  }

  if (status === "failed") {
    return "bg-red-100 text-red-900";
  }

  return "bg-amber-100 text-amber-900";
}

function formatQsoDate(record: QsoRecord) {
  if (!record.date) {
    return "Neznámé datum";
  }

  const date = new Date(`${record.date}T00:00:00`);
  const formatted = Number.isNaN(date.getTime())
    ? record.date
    : new Intl.DateTimeFormat("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);

  return record.timeOn ? `${formatted} v ${record.timeOn.slice(0, 5)} UTC` : formatted;
}

function formatQslPreviewDate(value: string) {
  if (!value) {
    return "--";
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function QslManager() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<QslQueueItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string | null }>({ connected: false, email: null });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<QslStatus>("ready");
  const [editingEmails, setEditingEmails] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [bulkLookupRunning, setBulkLookupRunning] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkSendProgress, setBulkSendProgress] = useState({ current: 0, total: 0 });
  const [isAddPanelOpen, setIsAddPanelOpen] = useState(false);
  const [callsignQuery, setCallsignQuery] = useState("");
  const [qsoMatches, setQsoMatches] = useState<QsoRecord[]>([]);
  const [qsoSearchLoading, setQsoSearchLoading] = useState(false);
  const [selectedQso, setSelectedQso] = useState<QsoRecord | null>(null);
  const [addingQso, setAddingQso] = useState(false);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [savingCustomCard, setSavingCustomCard] = useState(false);
  const [customCard, setCustomCard] = useState({ callsign: "", qsoDate: "", timeOn: "", band: "", mode: "FT8", rstSent: "", rstRcvd: "" });
  const homeLocator = useSyncExternalStore(subscribeHomeLocator, readHomeLocator, getHomeLocatorServerSnapshot);

  const loadQueue = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setStatus("Databázové připojení není připravené.");
      setLoading(false);
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user ?? null;

    if (!user) {
      router.replace("/login");
      return;
    }

    setUserId(user.id);

    const { data, error } = await supabase
      .from("qsl_queue")
      .select(qslQueueSelectFields)
      .eq("created_by", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      setStatus("QSL frontu nejde načíst. Spusť v Supabase SQL skript `supabase/qsl.sql`.");
      setItems([]);
      setLoading(false);
      return;
    }

    const normalized = (data ?? []).map((row) => normalizeQslQueueItem(row));
    setItems(normalized);
    setPreviewItemId((current) => (current && normalized.some((item) => item.id === current) ? current : normalized[0]?.id ?? null));
    setEditingEmails(Object.fromEntries(normalized.map((item) => [item.id, item.contactEmail])));
    setStatus(`Načteno ${normalized.length} QSL záznamů.`);
    setLoading(false);
  };

  useEffect(() => {
    void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetch("/api/auth/gmail/status", { cache: "no-store" }).then((response) => response.json()).then(setGmailStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    const query = callsignQuery.trim().toUpperCase();
    const supabase = getSupabaseBrowserClient();

    if (!supabase || !userId || query.length < 2) {
      setQsoMatches([]);
      setQsoSearchLoading(false);
      return;
    }

    let mounted = true;
    const timer = window.setTimeout(async () => {
      setQsoSearchLoading(true);
      const { data, error } = await supabase
        .from("qso_logs")
        .select(qsoSelectFields)
        .eq("created_by", userId)
        .ilike("callsign", `%${query}%`)
        .order("date", { ascending: false })
        .limit(24);

      if (!mounted) {
        return;
      }

      setQsoSearchLoading(false);
      if (error) {
        setQsoMatches([]);
        setStatus(`QSO pro tuto volačku se nepodařilo načíst: ${error.message}`);
        return;
      }

      setQsoMatches((data ?? []).map((row) => normalizeQsoRecord(row)));
    }, 250);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [callsignQuery, userId]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    return items.filter((item) => {
      const matchesStatus = statusFilter === "ready"
        ? item.status === "ready" || item.status === "failed"
        : item.status === statusFilter;
      const haystack = `${item.callsign} ${item.contactEmail} ${item.band} ${item.mode} ${item.locator}`.toLowerCase();
      const matchesSearch = !query || haystack.includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [items, search, statusFilter]);

  const summary = useMemo(
    () => ({
      total: items.length,
      ready: items.filter((item) => item.status === "ready" || item.status === "failed").length,
      missing: items.filter((item) => item.status === "missing_email").length,
      sent: items.filter((item) => item.status === "sent").length,
    }),
    [items],
  );

  const selectedQsoWithDistance = useMemo<EnrichedQsoRecord | null>(() => {
    if (!selectedQso) {
      return null;
    }

    return enrichQsoRecords([selectedQso], homeLocator)[0] ?? null;
  }, [homeLocator, selectedQso]);

  const previewItem = useMemo(
    () => items.find((item) => item.id === previewItemId) ?? items[0] ?? null,
    [items, previewItemId],
  );

  useEffect(() => {
    if (!previewItem) return;
    setCustomCard({
      callsign: previewItem.callsign,
      qsoDate: previewItem.qsoDate,
      timeOn: previewItem.timeOn.slice(0, 5),
      band: previewItem.band,
      mode: previewItem.mode || "FT8",
      rstSent: previewItem.rstSent,
      rstRcvd: previewItem.rstRcvd,
    });
  }, [previewItem]);

  const saveCustomCard = async () => {
    const supabase = getSupabaseBrowserClient();
    const callsign = customCard.callsign.trim().toUpperCase();
    const timeOn = customCard.timeOn.trim();

    if (!supabase || !userId || !previewItem) {
      setStatus("Vlastní údaje lze uložit až po přihlášení.");
      return;
    }
    if (!callsign) {
      setStatus("Volačka nesmí být prázdná.");
      return;
    }
    if (timeOn && !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOn)) {
      setStatus("Čas UTC zadej ve formátu HH:MM, například 15:59.");
      return;
    }

    setSavingCustomCard(true);
    const updatedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("qsl_queue")
      .update({
        callsign,
        qso_date: customCard.qsoDate || null,
        time_on: timeOn || null,
        band: customCard.band.trim() || null,
        mode: customCard.mode,
        rst_sent: customCard.rstSent.trim().toUpperCase() || null,
        rst_rcvd: customCard.rstRcvd.trim().toUpperCase() || null,
        updated_at: updatedAt,
      })
      .eq("id", previewItem.id)
      .eq("created_by", userId)
      .select(qslQueueSelectFields)
      .single();
    setSavingCustomCard(false);

    if (error || !data) {
      setStatus(`Vlastní údaje se nepodařilo uložit: ${error?.message ?? "neznámá chyba"}`);
      return;
    }

    const updated = normalizeQslQueueItem(data);
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setStatus(`Vlastní QSL pro ${updated.callsign} byl uložen a náhled aktualizován.`);
  };

  const addSelectedQso = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !userId || !selectedQso) {
      setStatus("Nejdřív vyber konkrétní QSO ze seznamu.");
      return;
    }

    setAddingQso(true);
    try {
      const result = await ensureQslQueueForRecords({ supabase, records: [selectedQso], userId });
      await loadQueue();
      setStatus(
        result.inserted
          ? `QSL pro ${selectedQso.callsign} byl přidán do fronty.`
          : `QSL pro ${selectedQso.callsign} už ve frontě existuje.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? `QSL se nepodařilo přidat: ${error.message}` : "QSL se nepodařilo přidat.");
    } finally {
      setAddingQso(false);
    }
  };

  const handleSync = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !userId) {
      setStatus("Synchronizace QSL je dostupná až po přihlášení.");
      return;
    }

    setSyncing(true);
    setStatus("Porovnávám QSO databázi s QSL frontou...");

    const { data, error } = await supabase
      .from("qso_logs")
      .select(qsoSelectFields)
      .eq("created_by", userId)
      .order("date", { ascending: false });

    if (error) {
      setSyncing(false);
      setStatus(`QSO databázi se nepodařilo načíst: ${error.message}`);
      return;
    }

    try {
      const result = await ensureQslQueueForRecords({
        supabase,
        records: (data ?? []).map((row) => normalizeQsoRecord(row)),
        userId,
      });
      setStatus(`Synchronizace hotová. Přidáno ${result.inserted}, přeskočeno ${result.skipped}.`);
      await loadQueue();
    } catch (error) {
      setStatus(error instanceof Error ? `Synchronizace selhala: ${error.message}` : "Synchronizace selhala.");
    }

    setSyncing(false);
  };

  const saveEmail = async (item: QslQueueItem) => {
    const supabase = getSupabaseBrowserClient();
    const email = normalizeEmail(editingEmails[item.id] ?? "");

    if (!supabase || !userId) {
      setStatus("Uložení e-mailu je dostupné až po přihlášení.");
      return;
    }

    if (!isValidEmail(email)) {
      setStatus("Zadej platný e-mail.");
      return;
    }

    setBusyId(item.id);

    const { error: contactError } = await supabase.from("qsl_contacts").insert({
      created_by: userId,
      callsign: item.callsign.toUpperCase(),
      email,
      source: "manual",
      is_verified: true,
    });

    if (contactError) {
      if (contactError.code === "23505") {
        await supabase
          .from("qsl_contacts")
          .update({
            source: "manual",
            is_verified: true,
          })
          .eq("created_by", userId)
          .eq("callsign", item.callsign.toUpperCase())
          .eq("email", email);
      } else {
        setBusyId(null);
        setStatus(`Kontakt se nepodařilo uložit: ${contactError.message}`);
        return;
      }
    }

    const { data, error } = await supabase
      .from("qsl_queue")
      .update({
        contact_email: email,
        status: item.status === "sent" ? "sent" : "ready",
        error_message: null,
      })
      .eq("id", item.id)
      .select(qslQueueSelectFields)
      .single();

    setBusyId(null);

    if (error) {
      setStatus(`E-mail se nepodařilo uložit: ${error.message}`);
      return;
    }

    const updated = normalizeQslQueueItem(data);
    setItems((current) => current.map((row) => (row.id === updated.id ? updated : row)));
    setStatus(`E-mail pro ${updated.callsign} byl uložen.`);
  };

  const lookupEmail = async (item: QslQueueItem) => {
    const hamqthSettings = readHamqthSettings();
    const qrzSettings = readQrzSettings();

    setBusyId(item.id);
    setStatus(`Hledám e-mail pro ${item.callsign}...`);

    const response = await fetch("/api/qsl/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        queueId: item.id,
        hamqth:
          hamqthSettings.username && hamqthSettings.password
            ? {
                username: hamqthSettings.username,
                password: hamqthSettings.password,
              }
            : undefined,
        qrz:
          qrzSettings.username && qrzSettings.password
            ? {
                username: qrzSettings.username,
                password: qrzSettings.password,
              }
            : undefined,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { email?: string; error?: string } | null;
    setBusyId(null);

    if (!response.ok || !payload?.email) {
      setStatus(payload?.error ?? "E-mail se nepodařilo dohledat.");
      return;
    }

    setEditingEmails((current) => ({ ...current, [item.id]: payload.email ?? "" }));
    await loadQueue();
    setStatus(`Nalezený e-mail pro ${item.callsign}: ${payload.email}`);
  };

  const sendQsl = async (item: QslQueueItem) => {
    if (item.status === "sent") {
      setStatus("Tenhle QSL lístek už byl odeslán.");
      return;
    }

    const email = normalizeEmail(editingEmails[item.id] ?? item.contactEmail);
    if (!isValidEmail(email)) {
      setStatus("Před odesláním doplň platný e-mail.");
      return;
    }

    if (email !== item.contactEmail) {
      await saveEmail(item);
    }

    setBusyId(item.id);
    setStatus(`Odesílám QSL pro ${item.callsign}...`);

    const response = await fetch("/api/qsl/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ queueId: item.id, email }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyId(null);

    if (!response.ok) {
      setStatus(payload?.error ?? "QSL e-mail se nepodařilo odeslat.");
      await loadQueue();
      return;
    }

    setStatus(`QSL pro ${item.callsign} byl odeslán.`);
    await loadQueue();
  };

  const sendAllQsl = async () => {
    const eligibleQueue = items.filter((item) => {
      const email = normalizeEmail(editingEmails[item.id] ?? item.contactEmail);
      return item.status !== "sent" && isValidEmail(email);
    });
    const queue = eligibleQueue.slice(0, 15);

    if (!queue.length) {
      setStatus("Ve frontě není žádný neodeslaný QSL lístek s platným e-mailem.");
      return;
    }

    setBulkSending(true);
    setBulkSendProgress({ current: 0, total: queue.length });
    setStatus(`Zařazuji ${queue.length} QSL lístků do serverové fronty…`);

    try {
      const response = await fetch("/api/qsl/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          items: queue.map((item) => ({
            queueId: item.id,
            email: normalizeEmail(editingEmails[item.id] ?? item.contactEmail),
          })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        queued?: number;
        intervalMinutes?: number;
      } | null;

      if (!response.ok) {
        setStatus(payload?.error ?? "QSL lístky se nepodařilo zařadit do fronty.");
      } else {
        const queued = payload?.queued ?? queue.length;
        setBulkSendProgress({ current: queued, total: queue.length });
        setStatus(
          `${queued} QSL lístků je v serverové frontě. Web odešle jeden přibližně každých ${payload?.intervalMinutes ?? 10} minut; počítač můžeš vypnout.`
          + (eligibleQueue.length > queue.length ? ` Dalších ${eligibleQueue.length - queue.length} zatím zařazeno nebylo.` : ""),
        );
      }
    } catch {
      setStatus("Serverová fronta není dostupná. Žádný e-mail nebyl odeslán.");
    } finally {
      setBusyId(null);
      setBulkSending(false);
      await loadQueue();
    }
  };

  const lookupAllEmails = async () => {
    const hamqthSettings = readHamqthSettings();
    const qrzSettings = readQrzSettings();
    const queueIds = items
      .filter((item) => item.status !== "sent" && !isValidEmail(item.contactEmail))
      .map((item) => item.id);

    if (!queueIds.length) {
      setStatus("Všechny QSL záznamy už mají e-mail.");
      return;
    }

    setBulkLookupRunning(true);
    setStatus(`Dohledávám e-maily pro ${queueIds.length} záznamů...`);
    try {
      const response = await fetch("/api/qsl/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          queueIds,
          hamqth:
            hamqthSettings.username && hamqthSettings.password
              ? {
                  username: hamqthSettings.username,
                  password: hamqthSettings.password,
                }
              : undefined,
          qrz:
            qrzSettings.username && qrzSettings.password
              ? {
                  username: qrzSettings.username,
                  password: qrzSettings.password,
                }
              : undefined,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { found?: number; failed?: number; error?: string }
        | null;

      if (!response.ok) {
        setStatus(payload?.error ?? "Hromadné dohledání e-mailů selhalo.");
        return;
      }

      await loadQueue();
      setStatus(`Hotovo. Nalezeno ${payload?.found ?? 0} e-mailů, nenalezeno ${payload?.failed ?? 0}.`);
    } catch {
      setStatus("Hromadné dohledání e-mailů se nepodařilo dokončit.");
    } finally {
      setBulkLookupRunning(false);
    }
  };

  if (loading) {
    return <p className="text-slate-600">Načítám QSL frontu...</p>;
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="rounded-[2rem] border border-amber-300/30 bg-amber-50 p-8">
        <p className="text-sm uppercase tracking-[0.35em] text-amber-900/70">QSL</p>
        <h1 className="mt-3 font-display text-4xl text-slate-950">Chybí platná Supabase konfigurace</h1>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="relative overflow-hidden rounded-[2.4rem] border border-slate-900/8 bg-[linear-gradient(135deg,_#0a1420_0%,_#14314c_42%,_#1f5d8f_100%)] p-7 text-white shadow-[0_24px_80px_rgba(13,27,50,0.16)] md:p-9">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,_rgba(255,165,96,0.22),_transparent_18%),radial-gradient(circle_at_left_bottom,_rgba(93,183,255,0.16),_transparent_26%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-sky-100/70">QSL lístky</p>
            <h1 className="mt-3 font-display text-5xl leading-tight">Fronta ke schválení</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setIsAddPanelOpen((current) => !current)}
              className="rounded-full bg-red-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-400"
            >
              {isAddPanelOpen ? "Zavřít přidání" : "Přidat QSL"}
            </button>
            <button
              type="button"
              onClick={() => void lookupAllEmails()}
              disabled={bulkLookupRunning || syncing}
              className="rounded-full border border-white/40 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bulkLookupRunning ? "Dohledávám e-maily..." : "Dohledat všechny e-maily"}
            </button>
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing || bulkLookupRunning}
              className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncing ? "Synchronizuji..." : "Synchronizovat QSO"}
            </button>
          </div>
        </div>
      </section>

      <section id="qsl-nahled" className="glass-panel scroll-mt-6 overflow-hidden rounded-[2.2rem]">
        <div className="grid xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.72fr)]">
          <div className="bg-slate-950 p-4 sm:p-6 lg:p-8">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-white">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-sky-200/70">Náhled před odesláním</p>
                <h2 className="mt-2 font-display text-3xl">Tvůj digitální QSL lístek</h2>
              </div>
              {previewItem ? (
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/qsl/preview/${encodeURIComponent(previewItem.id)}?v=${encodeURIComponent(previewItem.updatedAt)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
                  >
                    Otevřít PNG
                  </a>
                  <a
                    href={`/api/qsl/preview/${encodeURIComponent(previewItem.id)}?download=1`}
                    download={`QSL-OK2MKJ-${previewItem.callsign}.png`}
                    className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-sky-100"
                  >
                    Uložit QSL
                  </a>
                  <a
                    href="/qsl-template.png"
                    download="QSL-OK2MKJ-prazdna.png"
                    className="rounded-full border border-amber-200/60 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-950 transition hover:bg-amber-100"
                  >
                    Stáhnout prázdnou kartu
                  </a>
                </div>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-[1.25rem] border border-white/10 bg-[#d9c7a5] shadow-[0_28px_60px_rgba(0,0,0,0.35)]">
              {previewItem ? (
                <Image
                  key={`${previewItem.id}-${previewItem.updatedAt}`}
                  src={`/api/qsl/preview/${encodeURIComponent(previewItem.id)}?v=${encodeURIComponent(previewItem.updatedAt)}`}
                  alt={`Náhled QSL lístku OK2MKJ pro ${previewItem.callsign}`}
                  width={1536}
                  height={1024}
                  unoptimized
                  className="h-auto w-full"
                  priority
                />
              ) : (
                <Image
                  src="/qsl-template.png"
                  alt="Prázdná šablona QSL lístku OK2MKJ"
                  width={1536}
                  height={1024}
                  className="h-auto w-full opacity-75"
                  priority
                />
              )}
            </div>
            {!previewItem ? (
              <p className="mt-4 text-sm leading-6 text-slate-300">Přidej nebo synchronizuj první QSO. Potom se zde ukáže karta vyplněná skutečnými údaji.</p>
            ) : null}
          </div>

          <div className="flex flex-col bg-white/80 p-6 md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Údaje na lístku</p>
            {previewItem ? (
              <>
                <div className="mt-5 flex items-start justify-between gap-4 border-b border-slate-900/10 pb-5">
                  <div>
                    <p className="font-display text-5xl text-slate-950">{previewItem.callsign}</p>
                    <p className="mt-2 text-sm text-slate-500">Protistanice · {previewItem.locator || "lokátor neuveden"}</p>
                  </div>
                  <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${getStatusClasses(previewItem.status)}`}>
                    {getQslStatusLabel(previewItem.status)}
                  </span>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5">
                  <div>
                    <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Datum spojení</dt>
                    <dd className="mt-1.5 font-semibold text-slate-950">{formatQslPreviewDate(previewItem.qsoDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Čas UTC</dt>
                    <dd className="mt-1.5 font-semibold text-slate-950">{previewItem.timeOn?.slice(0, 5) || "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Pásmo</dt>
                    <dd className="mt-1.5 font-semibold text-slate-950">{previewItem.band || "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Mód</dt>
                    <dd className="mt-1.5 font-semibold text-slate-950">{previewItem.mode || "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-500">RST odeslaný</dt>
                    <dd className="mt-1.5 font-semibold text-slate-950">{previewItem.rstSent || "--"}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-500">RST přijatý</dt>
                    <dd className="mt-1.5 font-semibold text-slate-950">{previewItem.rstRcvd || "--"}</dd>
                  </div>
                </dl>

                <div className="mt-6 rounded-[1.25rem] bg-slate-100 p-4">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-slate-500">Příjemce</p>
                  <p className="mt-2 break-all text-sm font-semibold text-slate-800">{previewItem.contactEmail || "E-mail zatím není dohledaný"}</p>
                </div>

                <div className="mt-5 rounded-[1.25rem] border border-sky-200 bg-sky-50/80 p-4">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-sky-800">Vlastní údaje na kartě</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <label className="col-span-2 text-xs font-semibold text-slate-700">
                      Volačka
                      <input
                        value={customCard.callsign}
                        onChange={(event) => setCustomCard((current) => ({ ...current, callsign: event.target.value.toUpperCase() }))}
                        maxLength={24}
                        className="mt-1.5 w-full rounded-xl border border-slate-900/10 bg-white px-3 py-2.5 text-base font-semibold uppercase outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-700">
                      Datum spojení
                      <input
                        type="date"
                        value={customCard.qsoDate}
                        onChange={(event) => setCustomCard((current) => ({ ...current, qsoDate: event.target.value }))}
                        className="mt-1.5 w-full rounded-xl border border-slate-900/10 bg-white px-3 py-2.5 outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-700">
                      Čas UTC
                      <input
                        type="time"
                        value={customCard.timeOn}
                        onChange={(event) => setCustomCard((current) => ({ ...current, timeOn: event.target.value }))}
                        className="mt-1.5 w-full rounded-xl border border-slate-900/10 bg-white px-3 py-2.5 outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-700">
                      Pásmo
                      <input
                        value={customCard.band}
                        onChange={(event) => setCustomCard((current) => ({ ...current, band: event.target.value }))}
                        list="qsl-band-options"
                        placeholder="Např. 20m"
                        maxLength={16}
                        className="mt-1.5 w-full rounded-xl border border-slate-900/10 bg-white px-3 py-2.5 font-semibold outline-none focus:border-sky-500"
                      />
                      <datalist id="qsl-band-options">
                        <option value="160m" />
                        <option value="80m" />
                        <option value="60m" />
                        <option value="40m" />
                        <option value="30m" />
                        <option value="20m" />
                        <option value="17m" />
                        <option value="15m" />
                        <option value="12m" />
                        <option value="10m" />
                        <option value="6m" />
                        <option value="2m" />
                        <option value="70cm" />
                      </datalist>
                    </label>
                    <label className="text-xs font-semibold text-slate-700">
                      Mód
                      <select
                        value={customCard.mode}
                        onChange={(event) => setCustomCard((current) => ({ ...current, mode: event.target.value }))}
                        className="mt-1.5 w-full rounded-xl border border-slate-900/10 bg-white px-3 py-2.5 font-semibold outline-none focus:border-sky-500"
                      >
                        <option value="FT8">FT8</option>
                        <option value="SSB">SSB</option>
                        <option value="CW">CW</option>
                      </select>
                    </label>
                    <div className="col-span-2 grid grid-cols-2 gap-2">
                      <label className="text-xs font-semibold text-slate-700">
                        RST TX
                        <input
                          value={customCard.rstSent}
                          onChange={(event) => setCustomCard((current) => ({ ...current, rstSent: event.target.value }))}
                          maxLength={8}
                          className="mt-1.5 w-full rounded-xl border border-slate-900/10 bg-white px-3 py-2.5 uppercase outline-none focus:border-sky-500"
                        />
                      </label>
                      <label className="text-xs font-semibold text-slate-700">
                        RST RX
                        <input
                          value={customCard.rstRcvd}
                          onChange={(event) => setCustomCard((current) => ({ ...current, rstRcvd: event.target.value }))}
                          maxLength={8}
                          className="mt-1.5 w-full rounded-xl border border-slate-900/10 bg-white px-3 py-2.5 uppercase outline-none focus:border-sky-500"
                        />
                      </label>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveCustomCard()}
                    disabled={savingCustomCard}
                    className="mt-4 w-full rounded-full bg-sky-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-60"
                  >
                    {savingCustomCard ? "Ukládám…" : "Uložit vlastní údaje"}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => document.getElementById("qsl-fronta")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="mt-auto pt-6 text-left text-sm font-semibold text-sky-800 transition hover:text-sky-600"
                >
                  Vybrat jiný QSL ve frontě ↓
                </button>
              </>
            ) : (
              <div className="mt-5 rounded-[1.25rem] border border-dashed border-slate-300 p-5 text-sm leading-6 text-slate-600">
                Ve frontě zatím není žádné spojení k náhledu.
              </div>
            )}
          </div>
        </div>
      </section>

      {isAddPanelOpen ? (
        <section className="glass-panel overflow-hidden rounded-[2rem] p-6 md:p-8">
          <div className="flex flex-col gap-2 border-b border-slate-900/8 pb-6">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Nová QSL karta</p>
            <h2 className="font-display text-4xl text-slate-950">Najdi spojení podle volačky</h2>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              Vyber přesné QSO z databáze. Datum, čas, pásmo i protistanice se doplní automaticky a stejný záznam nelze do fronty přidat dvakrát.
            </p>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(26rem,1.08fr)]">
            <div>
              <label className="text-sm font-semibold text-slate-800" htmlFor="qsl-callsign-search">
                Volačka protistanice
              </label>
              <input
                id="qsl-callsign-search"
                value={callsignQuery}
                onChange={(event) => {
                  setCallsignQuery(event.target.value.toUpperCase());
                  setSelectedQso(null);
                }}
                placeholder="Např. DL1ABC"
                autoComplete="off"
                className="mt-2 w-full rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3.5 text-lg font-semibold uppercase outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
              />
              <p className="mt-2 text-xs leading-5 text-slate-500">Začni alespoň dvěma znaky. Hledá se jen ve tvé databázi QSO.</p>

              <div className="mt-5 max-h-[29rem] space-y-3 overflow-y-auto pr-1">
                {qsoSearchLoading ? <p className="rounded-[1rem] bg-slate-100 p-4 text-sm text-slate-600">Hledám spojení…</p> : null}
                {!qsoSearchLoading && callsignQuery.trim().length >= 2 && !qsoMatches.length ? (
                  <p className="rounded-[1rem] bg-slate-100 p-4 text-sm leading-6 text-slate-600">Pro zadanou volačku jsme nenašli žádné QSO.</p>
                ) : null}
                {qsoMatches.map((record, index) => {
                  const isSelected = selectedQso?.id !== undefined && record.id === selectedQso.id;
                  return (
                    <button
                      key={record.id !== undefined ? String(record.id) : `${record.callsign}-${record.date}-${record.timeOn}-${index}`}
                      type="button"
                      onClick={() => setSelectedQso(record)}
                      className={`w-full rounded-[1.35rem] border p-4 text-left transition ${
                        isSelected
                          ? "border-red-400 bg-red-50 shadow-[0_14px_30px_rgba(185,28,28,0.10)]"
                          : "border-slate-900/10 bg-white hover:border-sky-300 hover:bg-sky-50/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-lg font-semibold text-slate-950">{record.callsign}</p>
                          <p className="mt-1 text-sm text-slate-600">{formatQsoDate(record)}</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          {record.band || "--"} / {record.mode || "--"}
                        </span>
                      </div>
                      <p className="mt-3 text-sm text-slate-500">{record.locator || "Bez lokátoru"}{record.note ? ` · ${record.note}` : ""}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-slate-900/10 bg-slate-50/80 p-4 md:p-5">
              {selectedQsoWithDistance ? (
                <>
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Vybrané spojení</p>
                      <h3 className="mt-2 font-display text-4xl text-slate-950">{selectedQsoWithDistance.callsign}</h3>
                      <p className="mt-2 text-sm text-slate-600">{formatQsoDate(selectedQsoWithDistance)} · {selectedQsoWithDistance.band || "--"} / {selectedQsoWithDistance.mode || "--"}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void addSelectedQso()}
                      disabled={addingQso}
                      className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {addingQso ? "Přidávám…" : "Přidat do QSL fronty"}
                    </button>
                  </div>
                  <QslRouteMap record={selectedQsoWithDistance} homeLocator={homeLocator} />
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-[1rem] bg-white p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Odkud</p><p className="mt-1 font-semibold text-slate-800">{homeLocator || "Nenastaveno"}</p></div>
                    <div className="rounded-[1rem] bg-white p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Kam</p><p className="mt-1 font-semibold text-slate-800">{selectedQsoWithDistance.locator || "Bez lokátoru"}</p></div>
                  </div>
                </>
              ) : (
                <div className="flex h-full min-h-[28rem] flex-col items-center justify-center rounded-[1.35rem] border border-dashed border-slate-300 bg-white p-8 text-center">
                  <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Trasa QSO</p>
                  <p className="mt-4 max-w-sm text-lg leading-7 text-slate-700">Vyber vlevo konkrétní spojení a zobrazí se zde mapa z domácí stanice na protistanici.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <button type="button" onClick={() => setStatusFilter("ready")} className={`rounded-[2rem] p-6 text-left transition ${statusFilter === "ready" ? "bg-sky-950 text-white shadow-xl" : "glass-panel text-slate-950 hover:bg-sky-50"}`}>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Připraveno</p>
          <p className="mt-3 text-3xl font-semibold">{summary.ready}</p>
          <p className={`mt-2 text-xs ${statusFilter === "ready" ? "text-sky-200" : "text-slate-500"}`}>Kliknutím zobrazíš připravené a chybové záznamy</p>
        </button>
        <button type="button" onClick={() => setStatusFilter("missing_email")} className={`rounded-[2rem] p-6 text-left transition ${statusFilter === "missing_email" ? "bg-amber-700 text-white shadow-xl" : "glass-panel text-slate-950 hover:bg-amber-50"}`}>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Chybí e-mail</p>
          <p className="mt-3 text-3xl font-semibold">{summary.missing}</p>
          <p className={`mt-2 text-xs ${statusFilter === "missing_email" ? "text-amber-100" : "text-slate-500"}`}>Spojení, u kterých je potřeba doplnit adresu</p>
        </button>
        <button type="button" onClick={() => setStatusFilter("sent")} className={`rounded-[2rem] p-6 text-left transition ${statusFilter === "sent" ? "bg-emerald-950 text-white shadow-xl" : "glass-panel text-slate-950 hover:bg-emerald-50"}`}>
          <p className="text-xs uppercase tracking-[0.35em] text-emerald-200">Odesláno</p>
          <p className="mt-3 text-3xl font-semibold">{summary.sent}</p>
          <p className={`mt-2 text-xs ${statusFilter === "sent" ? "text-emerald-200" : "text-slate-500"}`}>Historie úspěšně odeslaných QSL lístků</p>
        </button>
      </section>

      <section id="qsl-fronta" className="glass-panel scroll-mt-6 rounded-[2rem] p-6 md:p-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-100/80 p-4">
          <div><p className="text-xs uppercase tracking-[0.25em] text-slate-500">Odesílání</p><p className="mt-1 text-sm text-slate-700">{gmailStatus.connected ? `Gmail připojen: ${gmailStatus.email || "ověřený účet"}` : "Gmail zatím není připojený."}</p></div>
          <div className="flex flex-wrap gap-2">
            {bulkSending ? (
              <button
                type="button"
                disabled
                className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-500"
              >
                Zařazuji ({bulkSendProgress.current}/{bulkSendProgress.total})
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void sendAllQsl()}
                disabled={syncing || bulkLookupRunning}
                className="rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Zařadit k postupnému odeslání
              </button>
            )}
            <a href="/api/auth/gmail/start" className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700">{gmailStatus.connected ? "Připojit jiný Gmail" : "Přihlásit Gmail"}</a>
          </div>
        </div>
        <div className="rounded-[1.6rem] bg-slate-100/80 p-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Hledat callsign, e-mail, pásmo nebo lokátor"
            className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
          />
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-slate-800">{getQslStatusLabel(statusFilter)} · {filteredItems.length} záznamů</p>
          <p className="text-xs text-slate-500">Celkem ve frontě: {summary.total}</p>
        </div>

        {status ? (
          <p className="mt-5 rounded-[1.2rem] bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-700">{status}</p>
        ) : null}

        <div className="mt-6 max-h-[42rem] overflow-auto rounded-[1.6rem] border border-slate-900/10">
          <table className="w-full min-w-[78rem] border-collapse text-left text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Stav</th>
                <th className="px-4 py-3 font-medium">QSO</th>
                <th className="px-4 py-3 font-medium">E-mail</th>
                <th className="px-4 py-3 font-medium">Odesláno</th>
                <th className="px-4 py-3 font-medium">Akce</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className="border-t border-slate-900/8 bg-white/80 align-top">
                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusClasses(item.status)}`}>
                      {getQslStatusLabel(item.status)}
                    </span>
                    {item.errorMessage ? <p className="mt-2 max-w-xs text-xs leading-5 text-red-700">{item.errorMessage}</p> : null}
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-semibold text-slate-950">{item.callsign}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.qsoDate || "--"} {item.timeOn || ""} / {item.band || "--"} / {item.mode || "--"}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      RST {item.rstSent || "--"} / {item.rstRcvd || "--"} / {item.locator || "bez lokátoru"}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <input
                      value={editingEmails[item.id] ?? ""}
                      onChange={(event) => setEditingEmails((current) => ({ ...current, [item.id]: event.target.value }))}
                      disabled={item.status === "sent"}
                      placeholder="email@example.com"
                      className="w-full min-w-72 rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none disabled:bg-slate-100"
                    />
                  </td>
                  <td className="px-4 py-4 text-slate-700">{formatDateTime(item.sentAt)}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewItemId(item.id);
                          window.requestAnimationFrame(() => {
                            document.getElementById("qsl-nahled")?.scrollIntoView({ behavior: "smooth", block: "start" });
                          });
                        }}
                        className="rounded-full border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900 transition hover:bg-sky-100"
                      >
                        Náhled
                      </button>
                      <button
                        type="button"
                        onClick={() => void lookupEmail(item)}
                        disabled={busyId === item.id || item.status === "sent"}
                        className="rounded-full border border-slate-900/12 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Dohledat
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveEmail(item)}
                        disabled={busyId === item.id || item.status === "sent"}
                        className="rounded-full border border-slate-900/12 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Uložit e-mail
                      </button>
                      <button
                        type="button"
                        onClick={() => void sendQsl(item)}
                        disabled={busyId === item.id || item.status === "sent"}
                        className="rounded-full bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Schválit a odeslat
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
