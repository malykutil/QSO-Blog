"use client";

import { useEffect, useState } from "react";
import type { SolarTelemetry } from "@/src/lib/solar-data";

function numeric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function display(value: number | null, unit: string) {
  return value === null ? "—" : `${value.toFixed(1)} ${unit}`;
}

export function SolarSummaryCards({ telemetry }: { telemetry: SolarTelemetry | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10000); return () => window.clearInterval(timer); }, []);
  const directPower = numeric(telemetry?.solar1_power) !== null || numeric(telemetry?.solar2_power) !== null
    ? (numeric(telemetry?.solar1_power) ?? 0) + (numeric(telemetry?.solar2_power) ?? 0)
    : null;
  const estimatedPower = telemetry && (numeric(telemetry.solar1_voltage) !== null || numeric(telemetry.solar2_voltage) !== null)
    ? (numeric(telemetry.solar1_voltage) ?? 0) * (numeric(telemetry.solar1_current) ?? 0) + (numeric(telemetry.solar2_voltage) ?? 0) * (numeric(telemetry.solar2_current) ?? 0)
    : null;
  const solarPower = directPower ?? estimatedPower;
  const batteryVoltage = numeric(telemetry?.battery_voltage);
  const batteryPercent = batteryVoltage === null ? null : Math.max(0, Math.min(100, ((batteryVoltage - 11.2) / (14.4 - 11.2)) * 100));
  const ageSeconds = telemetry && now !== null ? Math.max(0, Math.round((now - new Date(telemetry.recorded_at).getTime()) / 1000)) : null;
  const isOnline = ageSeconds !== null && ageSeconds < 90;

  return <section className="grid gap-4 md:grid-cols-3">
    <div className="glass-panel rounded-[2rem] p-6"><p className="text-sm text-slate-500">Aktuální výkon panelů</p><p className="mt-3 text-4xl font-semibold text-slate-950">{display(solarPower, "W")}</p><p className="mt-2 text-sm text-slate-600">Součet obou solárních větví</p></div>
    <div className="glass-panel rounded-[2rem] p-6"><div className="flex items-center justify-between gap-3"><p className="text-sm text-slate-500">Baterie</p><span className="text-sm font-semibold text-slate-700">{batteryPercent === null ? "—" : `${batteryPercent.toFixed(0)} %`}</span></div><div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${batteryPercent ?? 0}%` }} /></div><p className="mt-3 text-sm text-slate-600">Napětí {display(batteryVoltage, "V")}</p></div>
    <div className={`rounded-[2rem] p-6 ${isOnline ? "border border-emerald-200 bg-emerald-50" : "border border-amber-200 bg-amber-50"}`}><div className="flex items-center justify-between gap-3"><p className="text-sm text-slate-600">Raspberry Pi</p><span className={`h-3 w-3 rounded-full ${isOnline ? "bg-emerald-500" : "bg-amber-500"}`} /></div><p className={`mt-3 text-2xl font-semibold ${isOnline ? "text-emerald-950" : "text-amber-950"}`}>{telemetry ? (isOnline ? "Online" : "Zpožděná data") : "Čekám na data"}</p><p className="mt-2 text-sm text-slate-600">{ageSeconds === null ? "Zatím bez měření" : `Poslední měření před ${ageSeconds} s`}</p></div>
  </section>;
}
