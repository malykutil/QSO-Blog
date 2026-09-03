import type { SolarRelayName, SolarRelayState } from "@/src/lib/solar-data";
import { SOLAR_RELAY_META } from "@/src/lib/solar-dashboard";
import { SolarPanel } from "@/app/components/solar-ui";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

type ResetEvent = { id: number; occurredAt: string; label: string };

export function EventTimeline({
  relays,
  updatedAt,
  events: resetEvents = [],
}: {
  relays: SolarRelayState;
  updatedAt: Partial<Record<SolarRelayName, string>>;
  events?: ResetEvent[];
}) {
  const relayEvents = (Object.entries(updatedAt) as [SolarRelayName, string][])
    .filter(([, date]) => Boolean(date))
    .map(([relay, date]) => ({ type: "relay" as const, key: relay, date, relay }));
  const events = [...relayEvents, ...resetEvents.map((event) => ({
    type: "reset" as const,
    key: `reset-${event.id}`,
    date: event.occurredAt,
    label: event.label,
  }))]
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, 8);

  return <SolarPanel title="Poslední známé změny" eyebrow="Události relé">
    {events.length ? <ol className="solar-timeline mt-4">{events.map((event) => <li key={event.key}>
      <i className={event.type === "relay" && relays[event.relay] ? "is-on" : ""} />
      <div>
        <strong>{event.type === "reset" ? event.label : SOLAR_RELAY_META[event.relay].label}</strong>
        <p>{event.type === "reset" ? "Všechna relé byla bezpečně odpojena." : `Požadovaný stav: ${relays[event.relay] ? "zapnuto" : "vypnuto"}`}</p>
        <time dateTime={event.date}>{formatDateTime(event.date)}</time>
      </div>
    </li>)}</ol> : <p className="solar-alert solar-alert--info mt-4">Databáze zatím neobsahuje historii událostí.</p>}
    <p className="mt-4 text-xs text-[var(--solar-muted)]">Zobrazuje poslední změny relé a automatické bezpečnostní resety.</p>
  </SolarPanel>;
}
