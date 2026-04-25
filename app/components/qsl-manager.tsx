"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { normalizeQsoRecord, qsoSelectFields } from "@/src/lib/qso-data";
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
import { readHamqthSettings } from "@/src/lib/station-settings";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/src/lib/supabase";

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

export function QslManager() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<QslQueueItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | QslStatus>("");
  const [editingEmails, setEditingEmails] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadQueue = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setStatus("Databázové připojení není připravené.");
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
    setEditingEmails(Object.fromEntries(normalized.map((item) => [item.id, item.contactEmail])));
    setStatus(`Načteno ${normalized.length} QSL záznamů.`);
    setLoading(false);
  };

  useEffect(() => {
    void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    return items.filter((item) => {
      const matchesStatus = !statusFilter || item.status === statusFilter;
      const haystack = `${item.callsign} ${item.contactEmail} ${item.band} ${item.mode} ${item.locator}`.toLowerCase();
      const matchesSearch = !query || haystack.includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [items, search, statusFilter]);

  const summary = useMemo(
    () => ({
      total: items.length,
      ready: items.filter((item) => item.status === "ready").length,
      missing: items.filter((item) => item.status === "missing_email").length,
      sent: items.filter((item) => item.status === "sent").length,
    }),
    [items],
  );

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
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncing ? "Synchronizuji..." : "Synchronizovat QSO"}
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="glass-panel rounded-[2rem] p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Celkem</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">{summary.total}</p>
        </div>
        <div className="glass-panel rounded-[2rem] p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Připraveno</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">{summary.ready}</p>
        </div>
        <div className="glass-panel rounded-[2rem] p-6">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Chybí e-mail</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950">{summary.missing}</p>
        </div>
        <div className="rounded-[2rem] border border-emerald-500/30 bg-emerald-950 p-6 text-white shadow-[0_20px_50px_rgba(6,78,59,0.18)]">
          <p className="text-xs uppercase tracking-[0.35em] text-emerald-200">Odesláno</p>
          <p className="mt-3 text-3xl font-semibold">{summary.sent}</p>
        </div>
      </section>

      <section className="glass-panel rounded-[2rem] p-6 md:p-8">
        <div className="grid gap-4 rounded-[1.6rem] bg-slate-100/80 p-4 md:grid-cols-[1fr_16rem]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Hledat callsign, e-mail, pásmo nebo lokátor"
            className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "" | QslStatus)}
            className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
          >
            <option value="">Všechny stavy</option>
            <option value="missing_email">Chybí e-mail</option>
            <option value="ready">Připraveno</option>
            <option value="sent">Odesláno</option>
            <option value="failed">Chyba</option>
          </select>
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
