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

export function EventTimeline({ relays, updatedAt }: { relays: SolarRelayState; updatedAt: Partial<Record<SolarRelayName, string>> }) {
  const events = (Object.entries(updatedAt) as [SolarRelayName, string][])
    .filter(([, date]) => Boolean(date))
    .sort((left, right) => new Date(right[1]).getTime() - new Date(left[1]).getTime())
    .slice(0, 6);
  return <SolarPanel title="Poslední známé změny" eyebrow="Události relé">
    {events.length ? <ol className="solar-timeline mt-4">{events.map(([relay, date]) => <li key={relay}><i className={relays[relay] ? "is-on" : ""} /><div><strong>{SOLAR_RELAY_META[relay].label}</strong><p>Požadovaný stav: {relays[relay] ? "zapnuto" : "vypnuto"}</p><time dateTime={date}>{formatDateTime(date)}</time></div></li>)}</ol> : <p className="solar-alert solar-alert--info mt-4">Databáze zatím neobsahuje historii událostí.</p>}
    <p className="mt-4 text-xs leading-5 text-[var(--solar-muted)]">Aktuální databáze ukládá pouze poslední změnu každého relé, nikoliv kompletní časovou osu ani informaci, zda změnu provedla automatika.</p>
  </SolarPanel>;
}
