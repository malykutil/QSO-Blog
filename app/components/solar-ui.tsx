import type { ReactNode } from "react";

import type { SolarDashboardAlert, SolarIconName } from "@/src/lib/solar-dashboard";

export function SolarIcon({ name, className = "" }: { name: SolarIconName; className?: string }) {
  const paths: Record<SolarIconName, ReactNode> = {
    solar: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,
    battery: <><rect x="3" y="6" width="17" height="12" rx="2" /><path d="M20 10h2v4h-2M7 10v4M11 10v4M15 10v4" /></>,
    current: <><path d="M13 2 5 14h6l-1 8 8-12h-6z" /></>,
    load: <><path d="M4 13h16M6 13v7h12v-7M8 10a4 4 0 0 1 8 0M12 2v3" /></>,
    system: <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8M12 18v3M7 9h2M7 13h5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    temperature: <><path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z" /><path d="M12 8v8" /></>,
    humidity: <><path d="M12 2S6 9 6 14a6 6 0 0 0 12 0c0-5-6-12-6-12z" /><path d="M9 15a3 3 0 0 0 3 3" /></>,
    pressure: <><circle cx="12" cy="12" r="9" /><path d="m12 12 4-4M7 16h10" /></>,
    gas: <><path d="M8 19h8M9 19V9a3 3 0 0 1 6 0v10M7 12h10" /><path d="M5 7c1-2 2-3 4-4M19 7c-1-2-2-3-4-4" /></>,
    fan: <><circle cx="12" cy="12" r="2" /><path d="M12 10c-1-5 1-7 3-7 3 0 4 4 1 7M14 12c5-1 7 1 7 3 0 3-4 4-7 1M12 14c1 5-1 7-3 7-3 0-4-4-1-7M10 12c-5 1-7-1-7-3 0-3 4-4 7-1" /></>,
    heat: <><path d="M8 21c-3-3-2-7 1-10 0 3 2 3 2 1 0-4 3-7 5-9 0 4 3 6 3 10 0 5-3 8-7 8z" /><path d="M12 21c-2-2-1-4 1-6 0 2 2 2 2 0 2 3 1 6-3 6z" /></>,
    alert: <><path d="M12 3 2.8 20h18.4z" /><path d="M12 9v5M12 17h.01" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{paths[name]}</svg>;
}

export function SolarPanel({
  id,
  title,
  eyebrow,
  children,
  className = "",
}: {
  id?: string;
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return <section id={id} className={`solar-panel ${className}`}>
    {eyebrow ? <p className="solar-eyebrow">{eyebrow}</p> : null}
    {title ? <h2 className="mt-1 text-xl font-semibold text-[var(--solar-text)]">{title}</h2> : null}
    {children}
  </section>;
}

export function MetricCard({
  label,
  value,
  unit,
  detail,
  icon,
  tone = "neutral",
  stale = false,
}: {
  label: string;
  value: string;
  unit?: string;
  detail: string;
  icon: SolarIconName;
  tone?: "neutral" | "positive" | "warning" | "negative" | "info" | "solar";
  stale?: boolean;
}) {
  return <article className={`solar-overview-card solar-overview-card--${tone} ${stale ? "is-stale" : ""}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.11em] text-[var(--solar-muted)]">{label}</p>
        <p className="mt-3 flex items-baseline gap-1.5 font-mono text-2xl font-semibold text-[var(--solar-text)] sm:text-3xl">
          <span>{value}</span>{unit ? <span className="text-sm font-semibold text-[var(--solar-muted)]">{unit}</span> : null}
        </p>
      </div>
      <span className="solar-overview-icon"><SolarIcon name={icon} className="h-5 w-5" /></span>
    </div>
    <p className="mt-3 text-xs leading-5 text-[var(--solar-muted)]">{detail}</p>
    {stale ? <span className="solar-stale-badge mt-3">Zastaralá hodnota</span> : null}
  </article>;
}

export function AlertList({ alerts }: { alerts: SolarDashboardAlert[] }) {
  return <section aria-label="Aktivní upozornění" className="grid gap-2">
    {alerts.map((alert) => <article key={alert.id} className={`solar-alert-card solar-alert-card--${alert.level}`} role={alert.level === "critical" ? "alert" : undefined}>
      <SolarIcon name="alert" className="mt-0.5 h-5 w-5 flex-none" />
      <div><h2 className="font-semibold">{alert.title}</h2><p className="mt-1 text-sm leading-5 opacity-85">{alert.detail}</p></div>
    </article>)}
  </section>;
}
