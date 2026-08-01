"use client";

import { useState } from "react";
import type { SolarEnergyPoint } from "@/src/lib/solar-data";
import { SOLAR_MEASUREMENT_CONFIG } from "@/src/lib/solar-energy";

type NumericTelemetryKey = {
  [Key in keyof SolarEnergyPoint]: SolarEnergyPoint[Key] extends number | null ? Key : never;
}[keyof SolarEnergyPoint];
type ChartSeries = readonly (readonly [NumericTelemetryKey, string, string])[];
type ChartReferenceLine = readonly [number, string, string];
type DisplayPoint = { item: SolarEnergyPoint; sourceIndex: number };

const CHART_WIDTH = 900;
const CHART_HEIGHT = 290;
const CHART_PADDING = 20;
const MAX_RENDERED_POINTS = 600;

function downsampleHistory(
  history: SolarEnergyPoint[],
  maxPoints: number,
  keys: readonly NumericTelemetryKey[],
): DisplayPoint[] {
  if (history.length <= maxPoints) {
    return history.map((item, sourceIndex) => ({ item, sourceIndex }));
  }

  const selectedIndices = new Set<number>([0, history.length - 1]);
  const pointsPerBucket = Math.max(1, keys.length * 2);
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / pointsPerBucket));

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket / bucketCount) * history.length);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) / bucketCount) * history.length));

    for (const key of keys) {
      let minimumIndex: number | null = null;
      let maximumIndex: number | null = null;
      for (let index = start; index < end; index += 1) {
        const value = history[index]?.[key];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        if (minimumIndex === null || value < (history[minimumIndex][key] as number)) minimumIndex = index;
        if (maximumIndex === null || value > (history[maximumIndex][key] as number)) maximumIndex = index;
      }
      if (minimumIndex !== null) selectedIndices.add(minimumIndex);
      if (maximumIndex !== null) selectedIndices.add(maximumIndex);
    }
  }

  return [...selectedIndices]
    .sort((left, right) => left - right)
    .map((sourceIndex) => ({ item: history[sourceIndex], sourceIndex }));
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

export function InteractiveHistoryChart({
  history,
  series,
  title,
  unit,
  referenceLines = [],
}: {
  history: SolarEnergyPoint[];
  series: ChartSeries;
  title: string;
  unit: string;
  referenceLines?: readonly ChartReferenceLine[];
}) {
  const plotHeight = CHART_HEIGHT - CHART_PADDING * 2;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeKeys, setActiveKeys] = useState<NumericTelemetryKey[]>(() => series.map(([key]) => key));
  const visibleSeries = series.filter(([key]) => activeKeys.includes(key));
  const displayPoints = downsampleHistory(history, MAX_RENDERED_POINTS, series.map(([key]) => key));
  const visibleHistory = displayPoints.map(({ item }) => item);
  const availableValues = series.flatMap(([key]) => history
    .map((item) => item[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  const values = visibleSeries.flatMap(([key]) => history
    .map((item) => item[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value)))
    .concat(referenceLines.map(([value]) => value));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);
  const rangeStartMs = history[0] ? new Date(history[0].recorded_at).getTime() : 0;
  const rangeEndMs = history[history.length - 1] ? new Date(history[history.length - 1].recorded_at).getTime() : rangeStartMs;
  const rangeSpanMs = Math.max(1, rangeEndMs - rangeStartMs);
  const pointX = (index: number) => visibleHistory.length > 1
    ? ((new Date(visibleHistory[index].recorded_at).getTime() - rangeStartMs) / rangeSpanMs) * CHART_WIDTH
    : CHART_WIDTH / 2;
  const pointY = (key: NumericTelemetryKey, index: number) => CHART_HEIGHT
    - (((visibleHistory[index][key] as number) - min) / span) * plotHeight
    - CHART_PADDING;
  const referenceY = (value: number) => CHART_HEIGHT
    - ((value - min) / span) * plotHeight
    - CHART_PADDING;
  const gapPrefixes = Object.fromEntries(series.map(([key]) => {
    const prefix = Array.from({ length: history.length }, () => 0);
    for (let index = 1; index < history.length; index += 1) {
      const previous = history[index - 1][key];
      const current = history[index][key];
      const timestampGap = new Date(history[index].recorded_at).getTime()
        - new Date(history[index - 1].recorded_at).getTime();
      const isBreak =
        typeof previous !== "number" || !Number.isFinite(previous) ||
        typeof current !== "number" || !Number.isFinite(current) ||
        timestampGap > SOLAR_MEASUREMENT_CONFIG.maxIntegrationGapMs;
      prefix[index] = prefix[index - 1] + (isBreak ? 1 : 0);
    }
    return [key, prefix];
  })) as Partial<Record<NumericTelemetryKey, number[]>>;
  const pathFor = (key: NumericTelemetryKey) => {
    let path = "";
    let previousSourceIndex: number | null = null;
    visibleHistory.forEach((item, index) => {
      const value = item[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        previousSourceIndex = null;
        return;
      }
      const sourceIndex = displayPoints[index].sourceIndex;
      const gapPrefix = gapPrefixes[key];
      const startsNewSegment =
        previousSourceIndex === null ||
        !gapPrefix ||
        gapPrefix[sourceIndex] - gapPrefix[previousSourceIndex] > 0;
      path += `${startsNewSegment ? "M" : "L"}${pointX(index).toFixed(1)} ${pointY(key, index).toFixed(1)} `;
      previousSourceIndex = sourceIndex;
    });
    return path.trim();
  };
  const spanHours = rangeSpanMs / 3600000;
  const timeTicks = Array.from({ length: 5 }, (_, index) => {
    const timestamp = rangeStartMs + (index / 4) * rangeSpanMs;
    return {
      index,
      x: (index / 4) * CHART_WIDTH,
      label: history.length ? formatAxisDate(new Date(timestamp).toISOString(), spanHours) : "",
    };
  });

  const handlePointerMove = (event: React.PointerEvent<SVGRectElement>) => {
    if (visibleHistory.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - bounds.left) / bounds.width) * CHART_WIDTH;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    visibleHistory.forEach((_, index) => {
      const distance = Math.abs(pointX(index) - relativeX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    setHoveredIndex(nearestIndex);
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
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-auto w-full touch-none" role="img" aria-label={`${title}. Graf zobrazuje celé zvolené období, najetím zobrazíte hodnoty.`} onMouseLeave={() => setHoveredIndex(null)}>
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
          {referenceLines.map(([value, label, color]) => <g key={`${label}-${value}`}>
            <path d={`M0 ${referenceY(value)}H${CHART_WIDTH}`} stroke={color} strokeWidth="2" strokeDasharray="8 6" />
            <text x={CHART_WIDTH - 8} y={Math.max(CHART_PADDING + 14, referenceY(value) - 6)} textAnchor="end" fill={color} fontSize="12" fontWeight="700">{label}: {formatValue(value, unit)}</text>
          </g>)}
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
          <rect x="0" y="0" width={CHART_WIDTH} height={CHART_HEIGHT} fill="transparent" onPointerMove={handlePointerMove} />
        </svg>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {series.map(([key, label, color]) => <button key={String(key)} type="button" onClick={() => toggleSeries(key)} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition ${activeKeys.includes(key) ? "border-slate-300 bg-white text-slate-700" : "border-slate-200 bg-slate-100 text-slate-400 line-through"}`}><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeKeys.includes(key) ? color : "#94a3b8" }} />{label}</button>)}
        <span className="self-center px-2 text-sm text-slate-400">{unit} · kliknutím skryjete křivku</span>
      </div>
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
