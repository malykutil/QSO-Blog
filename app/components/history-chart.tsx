"use client";

import { useState } from "react";
import type { SolarTelemetry } from "@/src/lib/solar-data";

type NumericTelemetryKey = Exclude<keyof SolarTelemetry, "recorded_at">;
type ChartSeries = readonly (readonly [NumericTelemetryKey, string, string])[];

function formatValue(value: number | null, unit: string) {
  return typeof value === "number" ? `${value.toFixed(1)} ${unit}` : "—";
}

function formatDate(date: string, withSeconds = false) {
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric", month: "numeric", year: withSeconds ? "numeric" : undefined,
    hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined,
  }).format(new Date(date));
}

export function InteractiveHistoryChart({ history, series, title, unit }: { history: SolarTelemetry[]; series: ChartSeries; title: string; unit: string }) {
  const width = 900;
  const height = 290;
  const padding = 20;
  const plotHeight = height - padding * 2;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const values = series.flatMap(([key]) => history.map((item) => item[key] ?? 0));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);
  const pointX = (index: number) => history.length > 1 ? (index / (history.length - 1)) * width : width / 2;
  const pointY = (key: NumericTelemetryKey, index: number) => height - (((history[index][key] ?? 0) - min) / span) * plotHeight - padding;
  const pathFor = (key: NumericTelemetryKey) => history.map((item, index) => `${index === 0 ? "M" : "L"}${pointX(index).toFixed(1)} ${pointY(key, index).toFixed(1)}`).join(" ");
  const handlePointerMove = (event: React.PointerEvent<SVGRectElement>) => {
    if (history.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - bounds.left) / bounds.width) * width;
    setHoveredIndex(Math.max(0, Math.min(history.length - 1, Math.round((relativeX / width) * (history.length - 1)))));
  };
  const hoveredPoint = hoveredIndex === null ? null : history[hoveredIndex];
  const tooltipX = hoveredIndex === null ? 0 : Math.max(8, Math.min(width - 218, pointX(hoveredIndex) - 109));
  const axisLabels = [max, (max + min) / 2, min];

  return <div className="glass-panel rounded-[2rem] p-6 md:p-8">
    <div><p className="text-xs uppercase tracking-[0.35em] text-slate-500">Historie</p><h2 className="mt-3 text-3xl font-semibold text-slate-950">{title}</h2></div>
    {history.length < 2 ? <p className="mt-6 rounded-[1.2rem] bg-slate-100 px-4 py-4 text-sm text-slate-600">Pro graf potřebuji alespoň dvě měření z Raspberry Pi.</p> : <>
      <div className="mt-6 overflow-hidden rounded-[1.5rem] bg-slate-950 p-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`${title}. Najetím myší zobrazíte čas a hodnoty.`} onMouseLeave={() => setHoveredIndex(null)}>
          <g stroke="#29404c" strokeWidth="1"><path d={`M0 ${padding}H${width}`} /><path d={`M0 ${height / 2}H${width}`} /><path d={`M0 ${height - padding}H${width}`} /></g>
          <g fill="#94a3b8" fontSize="12"><text x="8" y={padding + 4}>{formatValue(axisLabels[0], unit)}</text><text x="8" y={height / 2 + 4}>{formatValue(axisLabels[1], unit)}</text><text x="8" y={height - padding - 4}>{formatValue(axisLabels[2], unit)}</text><text x="58" y={height - 3}>{formatDate(history[0].recorded_at)}</text><text x={width - 58} y={height - 3} textAnchor="end">{formatDate(history[history.length - 1].recorded_at)}</text></g>
          {min < 0 ? <path d={`M0 ${height - ((0 - min) / span) * plotHeight - padding}H${width}`} stroke="#cbd5e1" strokeDasharray="5 5" /> : null}
          {series.map(([key, , color]) => <path key={String(key)} d={pathFor(key)} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />)}
          {hoveredPoint && hoveredIndex !== null ? <>
            <line x1={pointX(hoveredIndex)} x2={pointX(hoveredIndex)} y1={padding} y2={height - padding} stroke="#e2e8f0" strokeDasharray="4 5" />
            {series.map(([key, , color]) => <circle key={`point-${String(key)}`} cx={pointX(hoveredIndex)} cy={pointY(key, hoveredIndex)} r="5" fill={color} stroke="#f8fafc" strokeWidth="2" />)}
            <g transform={`translate(${tooltipX} 18)`}><rect width="218" height={34 + series.length * 22} rx="10" fill="#f8fafc" stroke="#cbd5e1" /><text x="12" y="21" fill="#0f172a" fontSize="13" fontWeight="700">{formatDate(hoveredPoint.recorded_at, true)}</text>{series.map(([key, label, color], seriesIndex) => <g key={String(key)} transform={`translate(12 ${45 + seriesIndex * 22})`}><circle cx="4" cy="-4" r="4" fill={color} /><text x="14" y="0" fill="#334155" fontSize="12">{label}: {formatValue(hoveredPoint[key], unit)}</text></g>)}</g>
          </> : null}
          <rect x="0" y="0" width={width} height={height} fill="transparent" onPointerMove={handlePointerMove} />
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-600">{series.map(([, label, color]) => <span key={label} className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />{label}</span>)}<span className="text-slate-400">{unit} · min / průměr / max · najeďte myší na graf</span></div>
    </>}
  </div>;
}
