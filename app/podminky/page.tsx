"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { AppShell } from "@/app/components/app-shell";
import { PskCoverageMapClient } from "@/app/components/psk-coverage-map-client";
import type { PskSpot } from "@/app/components/psk-coverage-map";
import { pskBandOptions, pskTimeOptions } from "@/src/lib/pskreporter";

type PskPayload = {
  callsign: string;
  band: string;
  seconds: number;
  count: number;
  uniqueReceivers: number;
  uniqueCountries: number;
  spots: PskSpot[];
  fetchedAt: string;
  latestSeenAt?: string | null;
  source?: "retrieve" | "pskquery" | "query" | "cache";
};

type PskQuery = {
  callsign: string;
  band: string;
  seconds: number;
};

function formatFrequencyMhz(value: string) {
  const frequency = Number(value);
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return "--";
  }

  return `${(frequency / 1_000_000).toFixed(3)} MHz`;
}

function formatUnixSeconds(value: number) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

export default function PodminkyPage() {
  const [callsignInput, setCallsignInput] = useState("OK2MKJ");
  const [bandInput, setBandInput] = useState("all");
  const [secondsInput, setSecondsInput] = useState(43200);
  const [activeQuery, setActiveQuery] = useState<PskQuery>({
    callsign: "OK2MKJ",
    band: "all",
    seconds: 43200,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<PskPayload | null>(null);

  const loadPsk = useCallback(async (query: PskQuery) => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      callsign: query.callsign.trim().toUpperCase() || "OK2MKJ",
      band: query.band,
      seconds: String(query.seconds),
    });

    const response = await fetch(`/api/pskreporter?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "PSK data nejdou načíst.");
      setLoading(false);
      return;
    }

    const data = (await response.json()) as PskPayload;
    setPayload(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    const immediate = window.setTimeout(() => {
      void loadPsk(activeQuery);
    }, 0);

    const interval = window.setInterval(() => {
      void loadPsk(activeQuery);
    }, 120000);

    return () => {
      window.clearTimeout(immediate);
      window.clearInterval(interval);
    };
  }, [activeQuery, loadPsk]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setActiveQuery({
      callsign: callsignInput.trim().toUpperCase() || "OK2MKJ",
      band: bandInput,
      seconds: secondsInput,
    });
  };

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="glass-panel rounded-[2.4rem] border border-slate-900/8 bg-white p-7 shadow-[0_24px_80px_rgba(13,27,50,0.08)] md:p-9">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Podmínky vysílání</p>
            <h1 className="mt-3 font-display text-5xl leading-tight text-slate-950">Podmínky šíření</h1>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[35%_65%]">
          <article className="glass-panel rounded-[2rem] p-6 md:p-8">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">HamSolar</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-950">Aktuální podmínky</h2>
            </div>

            <div className="mt-5 rounded-[1.3rem] border border-slate-900/10 bg-slate-50 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://www.hamqsl.com/solar100sc.php"
                alt="HamSolar podmínky"
                className="h-auto w-full rounded-[1rem] border border-slate-900/10 bg-white"
              />
            </div>
          </article>

          <article className="glass-panel rounded-[2rem] p-6 md:p-8">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">PSK Reporter</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-950">Nastavení filtru</h2>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 grid gap-3 rounded-[1.4rem] bg-slate-100/80 p-4 md:grid-cols-3">
              <input
                value={callsignInput}
                onChange={(event) => setCallsignInput(event.target.value.toUpperCase())}
                placeholder="Volačka"
                className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 text-sm outline-none"
                required
              />

              <select
                value={bandInput}
                onChange={(event) => setBandInput(event.target.value)}
                className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 text-sm outline-none"
              >
                {pskBandOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <select
                value={secondsInput}
                onChange={(event) => setSecondsInput(Number(event.target.value))}
                className="rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 text-sm outline-none"
              >
                {pskTimeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                disabled={loading}
                className="md:col-span-3 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Načítám spoty..." : "Použít nastavení"}
              </button>
            </form>

            {error ? (
              <p className="mt-4 rounded-[1.1rem] border border-red-300/30 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
            ) : null}
            {!error && payload && payload.count === 0 ? (
              <p className="mt-4 rounded-[1.1rem] border border-amber-300/30 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Pro zadanou volačku a interval nebyly nalezeny žádné PSK spoty.
                {payload.latestSeenAt ? ` Poslední zachyt byl ${new Date(payload.latestSeenAt).toLocaleString("cs-CZ")}.` : ""} Zkus delší čas (např.
                24 hodin) nebo všechna pásma.
              </p>
            ) : null}

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[1.2rem] border border-slate-900/8 bg-white/80 p-4">
                <p className="text-[11px] uppercase tracking-[0.25em] text-slate-500">Spotů</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{payload?.count ?? "--"}</p>
              </div>
              <div className="rounded-[1.2rem] border border-slate-900/8 bg-white/80 p-4">
                <p className="text-[11px] uppercase tracking-[0.25em] text-slate-500">RX stanice</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{payload?.uniqueReceivers ?? "--"}</p>
              </div>
              <div className="rounded-[1.2rem] border border-slate-900/8 bg-white/80 p-4">
                <p className="text-[11px] uppercase tracking-[0.25em] text-slate-500">Země</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{payload?.uniqueCountries ?? "--"}</p>
              </div>
            </div>
          </article>
        </section>

        <section className="glass-panel rounded-[2rem] p-6 md:p-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Mapa slyšitelnosti</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-950">Kde je stanice slyšet</h2>
            </div>
            <p className="text-sm text-slate-500">
              Poslední aktualizace: {payload?.fetchedAt ? new Date(payload.fetchedAt).toLocaleString("cs-CZ") : "--"}
            </p>
          </div>

          <div className="mt-6">
            <PskCoverageMapClient spots={payload?.spots ?? []} />
          </div>

          <div className="mt-6 max-h-[22rem] overflow-auto rounded-[1.2rem] border border-slate-900/10">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Kdy</th>
                  <th className="px-4 py-3 font-medium">RX</th>
                  <th className="px-4 py-3 font-medium">Lokátor</th>
                  <th className="px-4 py-3 font-medium">Země</th>
                  <th className="px-4 py-3 font-medium">Mód</th>
                  <th className="px-4 py-3 font-medium">SNR</th>
                  <th className="px-4 py-3 font-medium">Frekvence</th>
                </tr>
              </thead>
              <tbody>
                {(payload?.spots ?? []).slice(0, 120).map((spot, index) => (
                  <tr key={`${spot.receiverCallsign}-${spot.flowStartSeconds}-${index}`} className="border-t border-slate-900/8 bg-white/80">
                    <td className="px-4 py-3 text-slate-700">{formatUnixSeconds(spot.flowStartSeconds)}</td>
                    <td className="px-4 py-3 font-medium text-slate-950">{spot.receiverCallsign}</td>
                    <td className="px-4 py-3 text-slate-700">{spot.receiverLocator || "--"}</td>
                    <td className="px-4 py-3 text-slate-700">{spot.receiverDXCC || "--"}</td>
                    <td className="px-4 py-3 text-slate-700">{spot.mode || "--"}</td>
                    <td className="px-4 py-3 text-slate-700">{spot.snr || "--"}</td>
                    <td className="px-4 py-3 text-slate-700">{formatFrequencyMhz(spot.frequency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
