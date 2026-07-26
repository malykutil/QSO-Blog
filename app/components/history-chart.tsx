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

function formatAxisDate(date: string, spanHours: number) {
  const options: Intl.DateTimeFormatOptions = spanHours <= 24
    ? { hour: "2-digit", minute: "2-digit" }
    : spanHours <= 48
      ? { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "numeric" };
  return new Intl.DateTimeFormat("cs-CZ", options).format(new Date(date));
}

export function InteractiveHistoryChart({ history, series, title, unit }: { history: SolarTelemetry[]; series: ChartSeries; title: string; unit: string }) {
  const width = 900;
  const height = 290;
  const padding = 20;
  const plotHeight = height - padding * 2;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeKeys, setActiveKeys] = useState<NumericTelemetryKey[]>(() => series.map(([key]) => key));
  const visibleSeries = series.filter(([key]) => activeKeys.includes(key));
  const values = visibleSeries.flatMap(([key]) => history.map((item) => item[key] ?? 0));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);
  const pointX = (index: number) => history.length > 1 ? (index / (history.length - 1)) * width : width / 2;
  const pointY = (key: NumericTelemetryKey, index: number) => height - (((history[index][key] ?? 0) - min) / span) * plotHeight - padding;
  const pathFor = (key: NumericTelemetryKey) => history.map((item, index) => `${index === 0 ? "M" : "L"}${pointX(index).toFixed(1)} ${pointY(key, index).toFixed(1)}`).join(" ");
  const spanHours = history.length > 1 ? (new Date(history[history.length - 1].recorded_at).getTime() - new Date(history[0].recorded_at).getTime()) / 3600000 : 0;
  const timeTicks = Array.from({ length: 5 }, (_, index) => {
    const historyIndex = Math.round((index / 4) * Math.max(0, history.length - 1));
    return { index: historyIndex, x: pointX(historyIndex), label: history[historyIndex] ? formatAxisDate(history[historyIndex].recorded_at, spanHours) : "" };
  });
  const handlePointerMove = (event: React.PointerEvent<SVGRectElement>) => {
    if (history.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - bounds.left) / bounds.width) * width;
    setHoveredIndex(Math.max(0, Math.min(history.length - 1, Math.round((relativeX / width) * (history.length - 1)))));
  };
  const hoveredPoint = hoveredIndex === null ? null : history[hoveredIndex];
  const tooltipX = hoveredIndex === null ? 0 : Math.max(8, Math.min(width - 218, pointX(hoveredIndex) - 109));
  const axisLabels = [max, (max + min) / 2, min];
  const toggleSeries = (key: NumericTelemetryKey) => setActiveKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);

  return <div className="glass-panel rounded-[2rem] p-6 md:p-8">
    <div><p className="text-xs uppercase tracking-[0.35em] text-slate-500">Historie</p><h2 className="mt-3 text-3xl font-semibold text-slate-950">{title}</h2></div>
    {history.length < 2 ? <p className="mt-6 rounded-[1.2rem] bg-slate-100 px-4 py-4 text-sm text-slate-600">Pro graf potřebuji alespoň dvě měření z Raspberry Pi.</p> : <>
      <div className="mt-6 overflow-hidden rounded-[1.5rem] bg-slate-950 p-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`${title}. Najetím myší zobrazíte čas a hodnoty.`} onMouseLeave={() => setHoveredIndex(null)}>
          <g stroke="#29404c" strokeWidth="1"><path d={`M0 ${padding}H${width}`} /><path d={`M0 ${height / 2}H${width}`} /><path d={`M0 ${height - padding}H${width}`} />{timeTicks.map((tick) => <path key={`grid-${tick.index}`} d={`M${tick.x} ${padding}V${height - padding}`} stroke="#29404c" strokeDasharray="2 7" opacity=".8" />)}</g>
          <g fill="#94a3b8" fontSize="12"><text x="8" y={padding + 4}>{formatValue(axisLabels[0], unit)}</text><text x="8" y={height / 2 + 4}>{formatValue(axisLabels[1], unit)}</text><text x="8" y={height - padding - 4}>{formatValue(axisLabels[2], unit)}</text>{timeTicks.map((tick, index) => <text key={`label-${tick.index}`} x={tick.x} y={height - 3} textAnchor={index === 0 ? "start" : index === timeTicks.length - 1 ? "end" : "middle"}>{tick.label}</text>)}</g>
          {min < 0 ? <path d={`M0 ${height - ((0 - min) / span) * plotHeight - padding}H${width}`} stroke="#cbd5e1" strokeDasharray="5 5" /> : null}
          {visibleSeries.map(([key, , color]) => <path key={String(key)} d={pathFor(key)} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />)}
          {hoveredPoint && hoveredIndex !== null ? <>
            <line x1={pointX(hoveredIndex)} x2={pointX(hoveredIndex)} y1={padding} y2={height - padding} stroke="#e2e8f0" strokeDasharray="4 5" />
            {visibleSeries.map(([key, , color]) => <circle key={`point-${String(key)}`} cx={pointX(hoveredIndex)} cy={pointY(key, hoveredIndex)} r="5" fill={color} stroke="#f8fafc" strokeWidth="2" />)}
            <g transform={`translate(${tooltipX} 18)`}><rect width="218" height={34 + visibleSeries.length * 22} rx="10" fill="#f8fafc" stroke="#cbd5e1" /><text x="12" y="21" fill="#0f172a" fontSize="13" fontWeight="700">{formatDate(hoveredPoint.recorded_at, true)}</text>{visibleSeries.map(([key, label, color], seriesIndex) => <g key={String(key)} transform={`translate(12 ${45 + seriesIndex * 22})`}><circle cx="4" cy="-4" r="4" fill={color} /><text x="14" y="0" fill="#334155" fontSize="12">{label}: {formatValue(hoveredPoint[key], unit)}</text></g>)}</g>
          </> : null}
          <rect x="0" y="0" width={width} height={height} fill="transparent" onPointerMove={handlePointerMove} />
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{series.map(([key, label, color]) => <button key={String(key)} type="button" onClick={() => toggleSeries(key)} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition ${activeKeys.includes(key) ? "border-slate-300 bg-white text-slate-700" : "border-slate-200 bg-slate-100 text-slate-400 line-through"}`}><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeKeys.includes(key) ? color : "#94a3b8" }} />{label}</button>)}<span className="self-center px-2 text-sm text-slate-400">{unit} · kliknutím skryjete křivku</span></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{visibleSeries.map(([key, label, color]) => { const numbers = history.map((item) => item[key]).filter((item): item is number => typeof item === "number"); const minimum = Math.min(...numbers); const average = numbers.reduce((total, item) => total + item, 0) / numbers.length; const maximum = Math.max(...numbers); return <div key={String(key)} className="rounded-2xl bg-slate-100/80 px-4 py-3 text-xs text-slate-500"><p className="flex items-center gap-2 font-semibold text-slate-700"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</p><p className="mt-2">min {formatValue(minimum, unit)} · průměr {formatValue(average, unit)} · max {formatValue(maximum, unit)}</p></div>; })}</div>
    </>}
  </div>;
}
