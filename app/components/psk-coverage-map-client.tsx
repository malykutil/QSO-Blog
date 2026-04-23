"use client";

import dynamic from "next/dynamic";

import type { PskSpot } from "@/app/components/psk-coverage-map";

const PskCoverageMapInner = dynamic(
  () => import("@/app/components/psk-coverage-map").then((module) => module.PskCoverageMap),
  {
    ssr: false,
    loading: () => (
      <div className="glass-panel rounded-[2rem] p-8 text-slate-700">
        Nacitam mapu slysetelnosti...
      </div>
    ),
  },
);

export function PskCoverageMapClient({ spots }: { spots: PskSpot[] }) {
  return <PskCoverageMapInner spots={spots} />;
}

