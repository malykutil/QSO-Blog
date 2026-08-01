"use client";

import { useRef, useState, type PointerEvent } from "react";
import type { SolarEnergyPoint } from "@/src/lib/solar-data";
import { SOLAR_MEASUREMENT_CONFIG } from "@/src/lib/solar-energy";

type NumericTelemetryKey = {
  [Key in keyof SolarEnergyPoint]: SolarEnergyPoint[Key] extends number | null ? Key : never;
}[keyof SolarEnergyPoint];
type ChartSeries = readonly (readonly [NumericTelemetryKey, string, string])[];
type DragState = { pointerId: number; startX: number; startEnd: number };

const CHART_WIDTH = 900;
const CHART_HEIGHT = 290;
const CHART_PADDING = 20;
const MAX_VISIBLE_POINTS = 240;
const OVERVIEW_POINTS = 180;

function downsampleHistory(history: SolarEnergyPoint[], maxPoints: number) {
  if (history.length <= maxPoints) return history;
  return Array.from({ length: maxPoints }, (_, index) => history[Math.round((index / (maxPoints - 1)) * (history.length - 1))]);
}

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

export function InteractiveHistoryChart({ history, series, title, unit }: { history: SolarEnergyPoint[]; series: ChartSeries; title: string; unit: string }) {
  const plotHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeKeys, setActiveKeys] = useState<NumericTelemetryKey[]>(() => series.map(([key]) => key));
  const [viewEnd, setViewEnd] = useState(history.length);
  const [followLatest, setFollowLatest] = useState(true);
  const dragRef = useRef<DragState | null>(null);

  const effectiveViewEnd = followLatest ? history.length : Math.min(history.length, Math.max(0, viewEnd));
  const visibleStart = Math.max(0, effectiveViewEnd - MAX_VISIBLE_POINTS);
  const visibleHistory = history.slice(visibleStart, effectiveViewEnd);
  const overviewHistory = downsampleHistory(history, OVERVIEW_POINTS);
  const visibleSeries = series.filter(([key]) => activeKeys.includes(key));
  const availableValues = series.flatMap(([key]) => history
    .map((item) => item[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  const values = visibleSeries.flatMap(([key]) => visibleHistory
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
    let previousTimestamp: number | null = null;
    visibleHistory.forEach((item, index) => {
      const value = item[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        previousTimestamp = null;
        return;
      }
      const timestamp = new Date(item.recorded_at).getTime();
      const startsNewSegment =
        previousTimestamp === null ||
        timestamp - previousTimestamp > SOLAR_MEASUREMENT_CONFIG.maxIntegrationGapMs;
      path += `${startsNewSegment ? "M" : "L"}${pointX(index).toFixed(1)} ${pointY(key, index).toFixed(1)} `;
      previousTimestamp = timestamp;
    });
    return path.trim();
  };
  const overviewPathFor = (key: NumericTelemetryKey) => {
    let path = "";
    let previousTimestamp: number | null = null;
    overviewHistory.forEach((item, index) => {
      const value = item[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        previousTimestamp = null;
        return;
      }
      const x = overviewHistory.length > 1
        ? (index / (overviewHistory.length - 1)) * CHART_WIDTH
        : CHART_WIDTH / 2;
      const y = 36 - (((value - min) / span) * 28);
      const timestamp = new Date(item.recorded_at).getTime();
      const startsNewSegment =
        previousTimestamp === null ||
        timestamp - previousTimestamp > SOLAR_MEASUREMENT_CONFIG.maxIntegrationGapMs;
      path += `${startsNewSegment ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
      previousTimestamp = timestamp;
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
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startEnd: effectiveViewEnd };
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

  return <div className="solar-panel p-4 md:p-5">
    <div>
      <p className="solar-eyebrow">Historie</p>
      <h2 className="mt-1 text-xl font-semibold text-[var(--solar-text)]">{title}</h2>
    </div>
    {history.length < 2 || availableValues.length < 2 ? <p className="solar-alert solar-alert--info mt-4">Pro zvolené veličiny nejsou v tomto období alespoň dvě platná měření.</p> : <>
      <div className="mt-4 overflow-hidden rounded-lg bg-slate-950 p-3">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className={`h-auto w-full touch-none ${history.length > MAX_VISIBLE_POINTS ? "cursor-grab active:cursor-grabbing" : ""}`} role="img" aria-label={`${title}. Tažením posunete časovou osu, najetím zobrazíte hodnoty.`} onMouseLeave={() => { if (!dragRef.current) setHoveredIndex(null); }}>
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
        <span className="self-center px-2 text-sm text-slate-400">{unit} · kliknutím skryjete křivku</span>
        {history.length > MAX_VISIBLE_POINTS ? <><span className="hidden text-sm text-slate-400 sm:inline">Tažením grafu posunete čas</span><button type="button" onClick={() => { setViewEnd(history.length); setFollowLatest(true); setHoveredIndex(null); }} className="rounded-full bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">Nejnovější</button></> : null}
      </div>
      {history.length > MAX_VISIBLE_POINTS ? <div className="mt-3 rounded-2xl bg-slate-100/80 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>Přehled celého zvoleného období</span>
          <span>{formatDate(history[0].recorded_at)} — {formatDate(history[history.length - 1].recorded_at)}</span>
        </div>
        <svg viewBox={`0 0 ${CHART_WIDTH} 44`} className="mt-1 h-10 w-full" role="img" aria-label="Přehled celé časové osy">
          <path d={`M0 36H${CHART_WIDTH}`} stroke="#cbd5e1" strokeWidth="1" />
          {visibleSeries.map(([key, , color]) => <path key={`overview-${String(key)}`} d={overviewPathFor(key)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}
          <rect
            x={Math.max(0, (visibleStart / Math.max(1, history.length - 1)) * CHART_WIDTH)}
            y="3"
            width={Math.max(8, ((visibleHistory.length - 1) / Math.max(1, history.length - 1)) * CHART_WIDTH)}
            height="36"
            rx="4"
            fill="#0f172a"
            opacity=".12"
          />
        </svg>
      </div> : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {visibleSeries.map(([key, label, color]) => {
          const numbers = history.map((item) => item[key]).filter((item): item is number => typeof item === "number" && Number.isFinite(item));
          const minimum = numbers.length ? Math.min(...numbers) : null;
          const average = numbers.length ? numbers.reduce((total, item) => total + item, 0) / numbers.length : null;
          const maximum = numbers.length ? Math.max(...numbers) : null;
          return <div key={String(key)} className="rounded-lg bg-slate-100/80 px-4 py-3 text-xs text-slate-500"><p className="flex items-center gap-2 font-semibold text-slate-700"><i className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</p><p className="mt-2">min {formatValue(minimum, unit)} · průměr {formatValue(average, unit)} · max {formatValue(maximum, unit)}</p></div>;
        })}
      </div>
    </>}
  </div>;
}
