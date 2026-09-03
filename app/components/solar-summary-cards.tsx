"use client";

import { useEffect, useState } from "react";

import type { SolarEnergyPoint } from "@/src/lib/solar-data";
import { getTelemetryFreshness } from "@/src/lib/solar-energy";

function display(value: number | null | undefined, unit: string) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : "—";
}

export function SolarSummaryCards({ telemetry }: { telemetry: SolarEnergyPoint | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const freshness = getTelemetryFreshness(telemetry?.recorded_at, now);

  return (
    <section className="grid gap-4 md:grid-cols-3">
      <div className="solar-metric">
        <p className="text-sm text-[var(--solar-muted)]">Celkový solární proud</p>
        <p className="mt-3 text-3xl font-semibold text-[var(--solar-text)]">{display(telemetry?.solar_total_current, "A")}</p>
        <p className="mt-2 text-sm text-[var(--solar-muted)]">ACS712 A3 · skutečný solární proud</p>
      </div>
      <div className="solar-metric">
        <p className="text-sm text-[var(--solar-muted)]">Proud zátěže</p>
        <p className="mt-3 text-3xl font-semibold text-[var(--solar-text)]">{display(telemetry?.battery_flow_current_a, "A")}</p>
        <p className="mt-2 text-sm text-[var(--solar-muted)]">Zátěžová větev · převrácené znaménko A1</p>
      </div>
      <div className="solar-metric">
        <p className="text-sm text-[var(--solar-muted)]">Raspberry Pi</p>
        <p className="mt-3 text-2xl font-semibold text-[var(--solar-text)]">
          {freshness === "online" ? "Online" : freshness === "delayed" ? "Zpožděná data" : "Offline"}
        </p>
        <p className="mt-2 text-sm text-[var(--solar-muted)]">Stav je určen podle stáří telemetrie.</p>
      </div>
    </section>
  );
}
