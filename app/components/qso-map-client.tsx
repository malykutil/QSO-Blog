"use client";

import dynamic from "next/dynamic";

const QsoMapInner = dynamic(
  () => import("@/app/components/qso-map").then((module) => module.QsoMap),
  {
    ssr: false,
    loading: () => (
      <div className="glass-panel rounded-[2.2rem] p-8 text-slate-700">
        Načítám interaktivní mapu...
      </div>
    ),
  },
);

export function QsoMapClient({
  mode = "public",
  refreshToken = 0,
  layout = "split",
  filters,
  highlightedQsoKey,
}: {
  mode?: "public" | "private";
  refreshToken?: number;
  layout?: "split" | "wide";
  filters?: {
    search?: string;
    band?: string;
    mode?: string;
    continent?: string;
    distanceRange?: string;
    days?: string[];
  };
  highlightedQsoKey?: string | null;
}) {
  return (
    <QsoMapInner
      mode={mode}
      refreshToken={refreshToken}
      layout={layout}
      filters={filters}
      highlightedQsoKey={highlightedQsoKey}
    />
  );
}
