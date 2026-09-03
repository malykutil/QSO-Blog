"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/app/components/app-shell";
import type { SdrStatus } from "@/src/lib/sdr";

const emptyStatus: SdrStatus = {
  active: false,
  ready: false,
  available: false,
  canControl: false,
  deviceConnected: false,
  idleTimeoutSeconds: 180,
  secondsRemaining: 0,
  receiverUrl: "https://ft-891.taild81c91.ts.net",
};

export default function SdrPage() {
  const [status, setStatus] = useState<SdrStatus>(emptyStatus);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/sdr", { cache: "no-store" });
      const nextStatus = await response.json() as SdrStatus;
      setStatus(nextStatus);
      if (nextStatus.available) setError(null);
    } catch {
      setStatus((current) => ({ ...current, active: false, available: false }));
      setError("Stav přijímače se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), 5_000);
    return () => window.clearInterval(timer);
  }, [loadStatus]);

  useEffect(() => {
    if (!status.active || !status.canControl) return;
    const heartbeat = async () => {
      await fetch("/api/sdr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "heartbeat" }),
      }).catch(() => undefined);
    };
    const timer = window.setInterval(() => void heartbeat(), 30_000);
    return () => window.clearInterval(timer);
  }, [status.active, status.canControl]);

  const runAction = async (action: "start" | "stop") => {
    if (busy) return;
    if (action === "start" && !window.confirm("Zapnout RTL-SDR V4 a zpřístupnit WebSDR? Přijímač se po několika minutách bez aktivní stránky automaticky vypne.")) return;
    setBusy(action);
    setError(null);
    try {
      const response = await fetch("/api/sdr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json() as SdrStatus & { error?: string };
      if (!response.ok) throw new Error(result.error || "RPi příkaz nepotvrdilo.");
      setStatus((current) => ({ ...current, ...result }));
      if (action === "start") window.setTimeout(() => setFrameKey((key) => key + 1), 4_000);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "WebSDR se nepodařilo ovládat.");
    } finally {
      setBusy(null);
      void loadStatus();
    }
  };

  const remainingMinutes = Math.max(1, Math.ceil(status.secondsRemaining / 60));

  return <AppShell contentClassName="min-w-0">
    <div className="mx-auto w-full max-w-[1500px] space-y-5">
      <header className="rounded-[2rem] border border-slate-900/10 bg-slate-950 px-6 py-7 text-white shadow-[0_24px_80px_rgba(15,23,42,0.18)] md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div><p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-300">OK2MKJ · vzdálený přijímač</p><h1 className="mt-2 font-display text-4xl md:text-5xl">WebSDR · RTL-SDR V4</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">Živý vodopád, ladění frekvence, AM/FM/SSB a poslech přímo v prohlížeči. Přijímač běží pouze po ručním zapnutí.</p></div>
          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${status.active ? "bg-emerald-400/20 text-emerald-200" : status.available ? "bg-slate-700 text-slate-200" : "bg-rose-400/20 text-rose-200"}`}>{loading ? "Kontroluji…" : status.active ? "Přijímač běží" : status.available ? "Přijímač je vypnutý" : "RPi nedostupné"}</span>
        </div>
      </header>

      <section className="rounded-[2rem] border border-slate-900/10 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] md:p-7">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1"><h2 className="text-xl font-semibold text-slate-950">Ovládání přijímače</h2><p className="mt-1 text-sm leading-6 text-slate-600">Zařízení: RTLSDRBlog Blog V4 · tuner R828D · bias‑tee vypnutý. {status.active ? `Automatické vypnutí za přibližně ${remainingMinutes} min bez potvrzení stránky.` : "SDR nyní nespotřebovává výkon pro zpracování signálu."}</p></div>
          <div className="flex gap-2">{status.active ? <button type="button" onClick={() => void runAction("stop")} disabled={busy !== null} className="rounded-2xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50">{busy === "stop" ? "Vypínám…" : "Vypnout SDR"}</button> : <button type="button" onClick={() => void runAction("start")} disabled={busy !== null || !status.available || !status.deviceConnected} className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">{busy === "start" ? "Zapínám…" : "Zapnout WebSDR"}</button>}</div>
        </div>
        {!status.deviceConnected && status.available ? <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">RTL-SDR V4 není připojené k USB.</p> : null}
        {error || status.error ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error ?? status.error}</p> : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[2rem] border border-sky-900/10 bg-sky-50/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] md:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Nastavení příjmu</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">LNA / RF Gain</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">V živém panelu OpenWebRX otevřete nastavení SDR a položkou <strong>RF Gain</strong> přidáte nebo uberete zesílení LNA. Změna se provede za běhu bez restartu přijímače a zachová všechny přednastavené profily pásem.</p>
        </div>
        <div className="rounded-[2rem] border border-emerald-900/10 bg-emerald-50/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] md:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Stanice</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">OK2MKJ · Vrchůra</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Země</dt><dd className="font-semibold text-slate-900">Česká republika</dd></div><div><dt className="text-slate-500">Lokátor</dt><dd className="font-semibold text-slate-900">JN99AK</dd></div></dl>
        </div>
      </section>

      {status.active && status.ready ? <section className="overflow-hidden rounded-[2rem] border border-slate-900/10 bg-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 text-white"><div><h2 className="font-semibold">Živý přijímač</h2><p className="text-xs text-slate-400">Volné ladění: klikněte na číselník frekvence, zadejte libovolnou hodnotu a potvrďte Enterem. Režim, filtr a hlasitost ovládejte přímo v panelu.</p></div><div className="flex gap-2"><button type="button" onClick={() => setFrameKey((key) => key + 1)} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/15">Obnovit panel</button><a href={status.receiverUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950">Otevřít celé okno</a></div></div>
        <iframe key={frameKey} src={status.receiverUrl} title="OK2MKJ WebSDR" allow="autoplay; local-network-access; local-network; loopback-network" className="h-[78vh] min-h-[620px] w-full border-0 bg-slate-950" />
      </section> : <section className="grid min-h-72 place-items-center rounded-[2rem] border border-dashed border-slate-400/50 bg-white/60 p-8 text-center"><div><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-slate-950 text-2xl text-white">⌁</div><h2 className="mt-5 text-xl font-semibold text-slate-950">{status.active ? "WebSDR se spouští…" : "WebSDR je vypnuté"}</h2><p className="mt-2 max-w-lg text-sm leading-6 text-slate-600">{status.active ? "OpenWebRX připravuje přijímač a vodopád. Panel se otevře automaticky." : "Po zapnutí se zde otevře kompletní přijímač s vodopádem a zvukem. Po několika minutách bez aktivní stránky se automaticky vypne."}</p></div></section>}
    </div>
  </AppShell>;
}
