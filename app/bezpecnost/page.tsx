"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "@/app/components/app-shell";
import {
  formatAccessDateTime,
  fromDatetimeLocalValue,
  getDeviceLabel,
  normalizeSecurityAccessRecord,
  toDatetimeLocalValue,
  type SecurityAccessRecord,
} from "@/src/lib/security-access";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/src/lib/supabase";

const accessSelectFields =
  "id,created_at,visited_at,path,method,visitor_type,user_id,user_email,ip_address,user_agent,referer";

function formatWho(record: SecurityAccessRecord) {
  if (record.userEmail) {
    return record.userEmail;
  }

  if (record.visitorType === "authenticated") {
    return record.userId ? `Prihlaseny (${record.userId.slice(0, 8)})` : "Prihlaseny uzivatel";
  }

  return "Anonymni navstevnik";
}

function recordMatchesDateRange(record: SecurityAccessRecord, dateFrom: string, dateTo: string) {
  const visitedAt = new Date(record.visitedAt);

  if (Number.isNaN(visitedAt.getTime())) {
    return false;
  }

  if (dateFrom) {
    const from = new Date(`${dateFrom}T00:00:00`);
    if (visitedAt < from) {
      return false;
    }
  }

  if (dateTo) {
    const to = new Date(`${dateTo}T23:59:59.999`);
    if (visitedAt > to) {
      return false;
    }
  }

  return true;
}

export default function BezpecnostPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<SecurityAccessRecord[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [visitorTypeFilter, setVisitorTypeFilter] = useState<"" | "anon" | "authenticated">("");
  const [methodFilter, setMethodFilter] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedTime, setEditedTime] = useState("");
  const [savingTime, setSavingTime] = useState(false);

  useEffect(() => {
    const loadSecurityData = async () => {
      const supabase = getSupabaseBrowserClient();

      if (!supabase) {
        setStatus("Databazove pripojeni neni pripraveno.");
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

      const { data: ownerRow, error: ownerError } = await supabase
        .from("app_owners")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (ownerError) {
        if (ownerError.code === "42P01") {
          setStatus("Chybi tabulka app_owners. Spust v Supabase SQL skript security_access_logs.sql.");
          setLoading(false);
          return;
        }

        router.replace("/dashboard");
        return;
      }

      if (!ownerRow) {
        router.replace("/dashboard");
        return;
      }

      const { data, error } = await supabase
        .from("security_access_logs")
        .select(accessSelectFields)
        .order("visited_at", { ascending: false })
        .limit(1000);

      if (error) {
        if (error.code === "42P01") {
          setStatus("Chybi tabulka security_access_logs. Spust v Supabase SQL skript security_access_logs.sql.");
          setRecords([]);
          setLoading(false);
          return;
        }

        setStatus(
          "Logy bezpecnosti nejdou nacist. Zkontroluj, jestli je v Supabase spustene SQL `supabase/security_access_logs.sql`.",
        );
        setRecords([]);
        setLoading(false);
        return;
      }

      const normalized = (data ?? []).map((row) => normalizeSecurityAccessRecord(row));
      setRecords(normalized);
      setStatus(`Nacteno ${normalized.length} pristupu.`);
      setLoading(false);
    };

    void loadSecurityData();

    const interval = window.setInterval(() => {
      void loadSecurityData();
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, [router]);

  const methods = useMemo(
    () => Array.from(new Set(records.map((record) => record.method.toUpperCase()))).sort(),
    [records],
  );

  const devices = useMemo(
    () => Array.from(new Set(records.map((record) => getDeviceLabel(record.userAgent)))).sort(),
    [records],
  );

  const filteredRecords = useMemo(() => {
    const loweredSearch = search.trim().toLowerCase();

    return records.filter((record) => {
      const method = record.method.toUpperCase();
      const device = getDeviceLabel(record.userAgent);
      const matchesVisitorType = !visitorTypeFilter || record.visitorType === visitorTypeFilter;
      const matchesMethod = !methodFilter || method === methodFilter.toUpperCase();
      const matchesDevice = !deviceFilter || device === deviceFilter;
      const matchesDate = recordMatchesDateRange(record, dateFrom, dateTo);

      const searchable = [
        formatWho(record),
        record.path,
        record.ipAddress || "",
        record.referer || "",
        record.userAgent || "",
        method,
        device,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !loweredSearch || searchable.includes(loweredSearch);

      return matchesVisitorType && matchesMethod && matchesDevice && matchesDate && matchesSearch;
    });
  }, [dateFrom, dateTo, deviceFilter, methodFilter, records, search, visitorTypeFilter]);

  const summary = useMemo(() => {
    const total = filteredRecords.length;
    const anon = filteredRecords.filter((record) => record.visitorType === "anon").length;
    const authenticated = filteredRecords.filter((record) => record.visitorType === "authenticated").length;
    const todayDate = new Date().toISOString().slice(0, 10);
    const today = filteredRecords.filter((record) => record.visitedAt.slice(0, 10) === todayDate).length;

    return { total, anon, authenticated, today };
  }, [filteredRecords]);

  const startEditing = (record: SecurityAccessRecord) => {
    setEditingId(record.id);
    setEditedTime(toDatetimeLocalValue(record.visitedAt));
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditedTime("");
  };

  const saveEditedTime = async (id: string) => {
    const newVisitedAt = fromDatetimeLocalValue(editedTime);

    if (!newVisitedAt) {
      setStatus("Zadany cas nema platny format.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setStatus("Databazove pripojeni neni pripraveno.");
      return;
    }

    setSavingTime(true);

    const { error } = await supabase
      .from("security_access_logs")
      .update({ visited_at: newVisitedAt })
      .eq("id", id);

    setSavingTime(false);

    if (error) {
      setStatus(`Uprava casu selhala: ${error.message}`);
      return;
    }

    setRecords((current) =>
      current.map((record) => (record.id === id ? { ...record, visitedAt: newVisitedAt } : record)),
    );
    setStatus("Cas pristupu byl upraven.");
    cancelEditing();
  };

  if (loading) {
    return (
      <AppShell contentClassName="flex items-center justify-center">
        <p className="text-slate-600">Nacitam bezpecnostni prehled...</p>
      </AppShell>
    );
  }

  if (!isSupabaseConfigured()) {
    return (
      <AppShell contentClassName="flex items-center">
        <div className="mx-auto w-full max-w-3xl rounded-[2rem] border border-amber-300/30 bg-amber-50 p-8">
          <p className="text-sm uppercase tracking-[0.35em] text-amber-900/70">Bezpecnost</p>
          <h1 className="mt-3 font-display text-4xl text-slate-950">Chybi platna Supabase konfigurace</h1>
          <p className="mt-4 max-w-2xl leading-7 text-slate-700">
            Tato sekce potrebuje nastavene `NEXT_PUBLIC_SUPABASE_URL` a `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
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
          <div className="relative">
            <p className="text-xs uppercase tracking-[0.35em] text-sky-100/70">Bezpecnost</p>
            <h1 className="mt-3 font-display text-5xl leading-tight">Prehled pristupu na web</h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-sky-50/80">
              Filtruj pristupy podle toho, kdo prisel, kdy prisel a jakym zpusobem web navstivil. Cas jednotliveho
              zaznamu muzes upravit primo v tabulce.
            </p>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <div className="glass-panel rounded-[2rem] p-6">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Zaznamu celkem</p>
            <p className="mt-3 text-3xl font-semibold text-slate-950">{summary.total}</p>
          </div>
          <div className="glass-panel rounded-[2rem] p-6">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Anonymni</p>
            <p className="mt-3 text-3xl font-semibold text-slate-950">{summary.anon}</p>
          </div>
          <div className="glass-panel rounded-[2rem] p-6">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Prihlaseni</p>
            <p className="mt-3 text-3xl font-semibold text-slate-950">{summary.authenticated}</p>
          </div>
          <div className="rounded-[2rem] border border-red-500/30 bg-red-950 p-6 text-white shadow-[0_20px_50px_rgba(127,29,29,0.18)]">
            <p className="text-xs uppercase tracking-[0.35em] text-red-200">Dnes</p>
            <p className="mt-3 text-3xl font-semibold">{summary.today}</p>
          </div>
        </section>

        <section className="glass-panel rounded-[2rem] p-6 md:p-8">
          <div className="grid gap-4 rounded-[1.6rem] bg-slate-100/80 p-4 md:grid-cols-2 xl:grid-cols-6">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Hledat kdo, cesta, IP, agent..."
              className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none xl:col-span-2"
            />

            <select
              value={visitorTypeFilter}
              onChange={(event) => setVisitorTypeFilter(event.target.value as "" | "anon" | "authenticated")}
              className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
            >
              <option value="">Kdo: vsichni</option>
              <option value="anon">Kdo: anonymni</option>
              <option value="authenticated">Kdo: prihlaseni</option>
            </select>

            <select
              value={methodFilter}
              onChange={(event) => setMethodFilter(event.target.value)}
              className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
            >
              <option value="">Jak: vsechny metody</option>
              {methods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>

            <select
              value={deviceFilter}
              onChange={(event) => setDeviceFilter(event.target.value)}
              className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
            >
              <option value="">Jak: vsechna zarizeni</option>
              {devices.map((device) => (
                <option key={device} value={device}>
                  {device}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-3 xl:col-span-6">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
              />
            </div>
          </div>

          {status ? (
            <p className="mt-5 rounded-[1.2rem] bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-700">{status}</p>
          ) : null}

          <div className="mt-6 max-h-[34rem] overflow-auto rounded-[1.6rem] border border-slate-900/10">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Kdo</th>
                  <th className="px-4 py-3 font-medium">Kdy</th>
                  <th className="px-4 py-3 font-medium">Jak</th>
                  <th className="px-4 py-3 font-medium">Cesta</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">Referer</th>
                  <th className="px-4 py-3 font-medium">Akce</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => {
                  const isEditing = editingId === record.id;

                  return (
                    <tr key={record.id} className="border-t border-slate-900/8 bg-white/80 align-top">
                      <td className="px-4 py-4">
                        <p className="font-medium text-slate-950">{formatWho(record)}</p>
                        <p className="mt-1 text-xs text-slate-500">{record.visitorType === "authenticated" ? "Prihlaseny" : "Anonymni"}</p>
                      </td>
                      <td className="px-4 py-4">
                        {isEditing ? (
                          <input
                            type="datetime-local"
                            value={editedTime}
                            onChange={(event) => setEditedTime(event.target.value)}
                            className="w-full min-w-48 rounded-[0.9rem] border border-slate-900/10 bg-white px-3 py-2 outline-none"
                          />
                        ) : (
                          <p className="text-slate-700">{formatAccessDateTime(record.visitedAt)}</p>
                        )}
                      </td>
                      <td className="px-4 py-4 text-slate-700">
                        <p className="font-medium text-slate-950">{record.method.toUpperCase()}</p>
                        <p className="mt-1 text-xs text-slate-500">{getDeviceLabel(record.userAgent)}</p>
                      </td>
                      <td className="px-4 py-4 text-slate-700">{record.path || "--"}</td>
                      <td className="px-4 py-4 text-slate-700">{record.ipAddress || "--"}</td>
                      <td className="px-4 py-4 text-slate-700">{record.referer || "--"}</td>
                      <td className="px-4 py-4">
                        {isEditing ? (
                          <div className="flex flex-col gap-2">
                            <button
                              type="button"
                              onClick={() => void saveEditedTime(record.id)}
                              disabled={savingTime}
                              className="rounded-full bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                            >
                              {savingTime ? "Ukladam..." : "Ulozit cas"}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditing}
                              className="rounded-full border border-slate-900/12 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                            >
                              Zrusit
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditing(record)}
                            className="rounded-full border border-slate-900/12 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          >
                            Upravit cas
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
