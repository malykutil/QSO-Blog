"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { SolarTelemetry } from "@/src/lib/solar-data";

type NumericTelemetryKey = Exclude<keyof SolarTelemetry, "recorded_at">;
type ChartSeries = readonly (readonly [NumericTelemetryKey, string, string])[];
type DragState = { pointerId: number; startX: number; startEnd: number };

const CHART_WIDTH = 900;
const CHART_HEIGHT = 290;
const CHART_PADDING = 20;
const MAX_VISIBLE_POINTS = 240;

function formatValue(value: number | null | undefined, unit: string) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : "—";
}

function formatDate(date: string, withSeconds = false) {
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: withSeconds ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
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
  const plotHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeKeys, setActiveKeys] = useState<NumericTelemetryKey[]>(() => series.map(([key]) => key));
  const [viewEnd, setViewEnd] = useState(history.length);
  const [followLatest, setFollowLatest] = useState(true);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    setViewEnd((current) => followLatest ? history.length : Math.min(history.length, Math.max(0, current)));
    setHoveredIndex(null);
  }, [history.length, followLatest]);

  const visibleStart = Math.max(0, viewEnd - MAX_VISIBLE_POINTS);
  const visibleHistory = history.slice(visibleStart, viewEnd);
  const visibleSeries = series.filter(([key]) => activeKeys.includes(key));
  const values = visibleSeries.flatMap(([key]) => history
    .map((item) => item[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);
  const pointX = (index: number) => visibleHistory.length > 1
    ? (index / (visibleHistory.length - 1)) * CHART_WIDTH
    : CHART_WIDTH / 2;
  const pointY = (key: NumericTelemetryKey, index: number) => CHART_HEIGHT
    - (((visibleHistory[index][key] as number) - min) / span) * plotHeight
    - CHART_PADDING;
  const pathFor = (key: NumericTelemetryKey) => {
    let path = "";
    let previousIndex: number | null = null;
    visibleHistory.forEach((item, index) => {
      const value = item[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        previousIndex = null;
        return;
      }
      path += `${previousIndex === null ? "M" : "L"}${pointX(index).toFixed(1)} ${pointY(key, index).toFixed(1)} `;
      previousIndex = index;
    });
    return path.trim();
  };
  const spanHours = visibleHistory.length > 1
    ? (new Date(visibleHistory[visibleHistory.length - 1].recorded_at).getTime() - new Date(visibleHistory[0].recorded_at).getTime()) / 3600000
    : 0;
  const timeTicks = Array.from({ length: 5 }, (_, index) => {
    const historyIndex = Math.round((index / 4) * Math.max(0, visibleHistory.length - 1));
    return {
      index: historyIndex,
      x: pointX(historyIndex),
      label: visibleHistory[historyIndex] ? formatAxisDate(visibleHistory[historyIndex].recorded_at, spanHours) : "",
    };
  });

  const handlePointerDown = (event: PointerEvent<SVGRectElement>) => {
    if (history.length <= MAX_VISIBLE_POINTS) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startEnd: viewEnd };
    setFollowLatest(false);
    setHoveredIndex(null);
  };

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    if (visibleHistory.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const drag = dragRef.current;
    if (drag) {
      const pointsMoved = Math.round(((event.clientX - drag.startX) / bounds.width) * Math.max(1, visibleHistory.length - 1));
      const nextEnd = Math.max(MAX_VISIBLE_POINTS, Math.min(history.length, drag.startEnd - pointsMoved));
      setViewEnd(nextEnd);
      return;
    }
    const relativeX = ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH;
    setHoveredIndex(Math.max(0, Math.min(visibleHistory.length - 1, Math.round((relativeX / CHART_WIDTH) * (visibleHistory.length - 1)))));
  };

  const handlePointerUp = (event: PointerEvent<SVGRectElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const hoveredPoint = hoveredIndex === null ? null : visibleHistory[hoveredIndex];
  const tooltipX = hoveredIndex === null ? 0 : Math.max(8, Math.min(CHART_WIDTH - 218, pointX(hoveredIndex) - 109));
  const axisLabels = [max, (max + min) / 2, min];
  const toggleSeries = (key: NumericTelemetryKey) => setActiveKeys((current) => current.includes(key)
    ? current.filter((item) => item !== key)
    : [...current, key]);

  return <div className="glass-panel rounded-[2rem] p-6 md:p-8">
    <div>
      <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Historie</p>
      <h2 className="mt-3 text-3xl font-semibold text-slate-950">{title}</h2>
    </div>
    {history.length < 2 ? <p className="mt-6 rounded-[1.2rem] bg-slate-100 px-4 py-4 text-sm text-slate-600">Pro graf potrebuji alespon dve mereni z Raspberry Pi.</p> : <>
      <div className="mt-6 overflow-hidden rounded-[1.5rem] bg-slate-950 p-3">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className={`h-auto w-full touch-none ${history.length > MAX_VISIBLE_POINTS ? "cursor-grab active:cursor-grabbing" : ""}`} role="img" aria-label={`${title}. Tazenim posunete casovou osu, najetim zobrazite hodnoty.`} onMouseLeave={() => { if (!dragRef.current) setHoveredIndex(null); }}>
          <g stroke="#29404c" strokeWidth="1">
            <path d={`M0 ${CHART_PADDING}H${CHART_WIDTH}`} />
            <path d={`M0 ${CHART_HEIGHT / 2}H${CHART_WIDTH}`} />
            <path d={`M0 ${CHART_HEIGHT - CHART_PADDING}H${CHART_WIDTH}`} />
            {timeTicks.map((tick) => <path key={`grid-${tick.index}`} d={`M${tick.x} ${CHART_PADDING}V${CHART_HEIGHT - CHART_PADDING}`} strokeDasharray="2 7" opacity=".8" />)}
          </g>
          <g fill="#94a3b8" fontSize="12">
            <text x="8" y={CHART_PADDING + 4}>{formatValue(axisLabels[0], unit)}</text>
            <text x="8" y={CHART_HEIGHT / 2 + 4}>{formatValue(axisLabels[1], unit)}</text>
            <text x="8" y={CHART_HEIGHT - CHART_PADDING - 4}>{formatValue(axisLabels[2], unit)}</text>
            {timeTicks.map((tick, index) => <text key={`label-${tick.index}`} x={tick.x} y={CHART_HEIGHT - 3} textAnchor={index === 0 ? "start" : index === timeTicks.length - 1 ? "end" : "middle"}>{tick.label}</text>)}
          </g>
          {min < 0 ? <path d={`M0 ${CHART_HEIGHT - ((0 - min) / span) * plotHeight - CHART_PADDING}H${CHART_WIDTH}`} stroke="#cbd5e1" strokeDasharray="5 5" /> : null}
          {visibleSeries.map(([key, , color]) => <path key={String(key)} d={pathFor(key)} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />)}
          {hoveredPoint && hoveredIndex !== null ? <>
            <line x1={pointX(hoveredIndex)} x2={pointX(hoveredIndex)} y1={CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} stroke="#e2e8f0" strokeDasharray="4 5" />
            {visibleSeries.map(([key, , color]) => typeof hoveredPoint[key] === "number" && Number.isFinite(hoveredPoint[key]) ? <circle key={`point-${String(key)}`} cx={pointX(hoveredIndex)} cy={pointY(key, hoveredIndex)} r="5" fill={color} stroke="#f8fafc" strokeWidth="2" /> : null)}
            <g transform={`translate(${tooltipX} 18)`}>
              <rect width="218" height={34 + visibleSeries.length * 22} rx="10" fill="#f8fafc" stroke="#cbd5e1" />
              <text x="12" y="21" fill="#0f172a" fontSize="13" fontWeight="700">{formatDate(hoveredPoint.recorded_at, true)}</text>
              {visibleSeries.map(([key, label, color], seriesIndex) => <g key={String(key)} transform={`translate(12 ${45 + seriesIndex * 22})`}><circle cx="4" cy="-4" r="4" fill={color} /><text x="14" y="0" fill="#334155" fontSize="12">{label}: {formatValue(hoveredPoint[key], unit)}</text></g>)}
            </g>
          </> : null}
          <rect x="0" y="0" width={CHART_WIDTH} height={CHART_HEIGHT} fill="transparent" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} />
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {series.map(([key, label, color]) => <button key={String(key)} type="button" onClick={() => toggleSeries(key)} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition ${activeKeys.includes(key) ? "border-slate-300 bg-white text-slate-700" : "border-slate-200 bg-slate-100 text-slate-400 line-through"}`}><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeKeys.includes(key) ? color : "#94a3b8" }} />{label}</button>)}
        <span className="self-center px-2 text-sm text-slate-400">{unit} · kliknutim skryjete krivku</span>
        {history.length > MAX_VISIBLE_POINTS ? <><span className="hidden text-sm text-slate-400 sm:inline">Tazenim grafu posunete cas</span><button type="button" onClick={() => { setViewEnd(history.length); setFollowLatest(true); setHoveredIndex(null); }} className="rounded-full bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">Nejnovejsi</button></> : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {visibleSeries.map(([key, label, color]) => {
          const numbers = history.map((item) => item[key]).filter((item): item is number => typeof item === "number" && Number.isFinite(item));
          const minimum = numbers.length ? Math.min(...numbers) : null;
          const average = numbers.length ? numbers.reduce((total, item) => total + item, 0) / numbers.length : null;
          const maximum = numbers.length ? Math.max(...numbers) : null;
          return <div key={String(key)} className="rounded-2xl bg-slate-100/80 px-4 py-3 text-xs text-slate-500"><p className="flex items-center gap-2 font-semibold text-slate-700"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</p><p className="mt-2">min {formatValue(minimum, unit)} · prumer {formatValue(average, unit)} · max {formatValue(maximum, unit)}</p></div>;
        })}
      </div>
    </>}
  </div>;
}
