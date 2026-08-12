"use client";

export type HistoryRange = "1h" | "6h" | "24h" | "2d" | "7d" | "30d";

const ranges: readonly { value: HistoryRange; label: string }[] = [
  { value: "1h", label: "1 hodina" },
  { value: "6h", label: "6 hodin" },
  { value: "24h", label: "24 hodin" },
  { value: "2d", label: "2 dny" },
  { value: "7d", label: "7 dní" },
  { value: "30d", label: "30 dní" },
];

export function SolarHistoryControls({ value, loading, onChange }: { value: HistoryRange; loading: boolean; onChange: (range: HistoryRange) => void }) {
  return <div className="solar-history-controls" aria-busy={loading}>
    <div><p className="solar-eyebrow">Časový rozsah</p><h2 className="mt-1 text-xl font-semibold text-[var(--solar-text)]">Historické grafy</h2>{loading ? <p className="mt-1 text-xs text-[var(--solar-muted)]">Načítám zvolené období…</p> : null}</div>
    <div className="solar-history-ranges" role="group" aria-label="Časový rozsah grafů">
      {ranges.map((range) => <button key={range.value} type="button" onClick={() => onChange(range.value)} className={`solar-range ${value === range.value ? "is-active" : ""}`} aria-pressed={value === range.value}>{range.label}</button>)}
    </div>
  </div>;
}
