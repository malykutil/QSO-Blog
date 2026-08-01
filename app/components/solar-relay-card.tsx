"use client";

import type { SolarEnergyPoint, SolarRelayName } from "@/src/lib/solar-data";
import { SOLAR_RELAY_META } from "@/src/lib/solar-dashboard";
import { SolarIcon } from "@/app/components/solar-ui";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatNumber(value: number | null | undefined, unit: string) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : "N/A";
}

export function RelayCard({
  relay,
  requestedState,
  updatedAt,
  disabled,
  busy,
  error,
  onToggle,
}: {
  relay: SolarRelayName;
  requestedState: boolean;
  updatedAt?: string;
  disabled: boolean;
  busy: boolean;
  error?: string | null;
  onToggle: (relay: SolarRelayName, desiredState: boolean) => void;
}) {
  const meta = SOLAR_RELAY_META[relay];
  const desiredState = !requestedState;
  return <article className={`solar-device-card ${error ? "has-error" : ""}`}>
    <div className="flex items-start gap-3">
      <span className={`solar-device-icon ${requestedState ? "is-on" : ""}`}><SolarIcon name={meta.icon} className="h-5 w-5" /></span>
      <div className="min-w-0"><h3 className="font-semibold text-[var(--solar-text)]">{meta.label}</h3><p className="mt-1 text-xs leading-5 text-[var(--solar-muted)]">{meta.description}</p></div>
    </div>
    <dl className="solar-device-state mt-4">
      <div><dt>Požadovaný stav</dt><dd className={requestedState ? "is-on" : ""}>{busy ? "ODESÍLÁNÍ…" : requestedState ? "ZAPNUTO" : "VYPNUTO"}</dd></div>
      <div><dt>Fyzický stav</dt><dd>N/A</dd></div>
      <div><dt>Režim</dt><dd>{requestedState ? "RUČNĚ ZAPNUTO" : "RUČNĚ VYPNUTO"}</dd></div>
      <div><dt>Poslední změna</dt><dd>{formatDateTime(updatedAt)}</dd></div>
    </dl>
    <p className="mt-3 text-xs leading-5 text-[var(--solar-muted)]">AUTO zatím databáze nepodporuje. Fyzické potvrzení relé se z Raspberry Pi nevrací, proto jej UI nepředstírá.</p>
    {error ? <p className="solar-device-error mt-3">{error}</p> : null}
    <button type="button" disabled={disabled || busy} onClick={() => onToggle(relay, desiredState)} className={`solar-device-action mt-4 ${desiredState ? "is-on" : "is-off"}`}>
      {busy ? "Čekám na server…" : desiredState ? "Požádat o zapnutí" : "Požádat o vypnutí"}
    </button>
  </article>;
}

export function RelayConfirmationDialog({
  relay,
  desiredState,
  telemetry,
  onConfirm,
  onCancel,
}: {
  relay: SolarRelayName;
  desiredState: boolean;
  telemetry: SolarEnergyPoint | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const meta = SOLAR_RELAY_META[relay];
  return <div className="solar-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onCancel(); }}>
    <section className="solar-dialog" role="alertdialog" aria-modal="true" aria-labelledby="relay-dialog-title">
      <div className="flex items-start gap-3"><span className="solar-device-icon"><SolarIcon name={meta.icon} className="h-5 w-5" /></span><div><p className="solar-eyebrow">Potvrzení rizikového zařízení</p><h2 id="relay-dialog-title" className="mt-1 text-xl font-semibold">Opravdu chcete {desiredState ? "zapnout" : "vypnout"} {meta.label.toLowerCase()}?</h2></div></div>
      <dl className="solar-dialog-details mt-5">
        <div><dt>Stav baterie</dt><dd>{telemetry?.battery_state === "charging" ? "Nabíjení" : telemetry?.battery_state === "discharging" ? "Vybíjení" : telemetry?.battery_state === "idle" ? "Klid" : "N/A"}</dd></div>
        <div><dt>Napětí baterie</dt><dd>{formatNumber(telemetry?.battery_voltage, "V")}</dd></div>
        <div><dt>Poslední data</dt><dd>{formatDateTime(telemetry?.recorded_at)}</dd></div>
        <div><dt>Teplota v objektu</dt><dd>{formatNumber(telemetry?.object_temperature, "°C")}</dd></div>
      </dl>
      <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={onCancel} className="solar-dialog-cancel">Zrušit</button><button type="button" onClick={onConfirm} className="solar-dialog-confirm">Potvrdit příkaz</button></div>
    </section>
  </div>;
}
