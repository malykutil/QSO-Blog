"use client";

import dynamic from "next/dynamic";

import type { MeshtasticNode } from "@/src/lib/meshtastic";

const MeshtasticMapInner = dynamic(
  () => import("@/app/components/meshtastic-map").then((module) => module.MeshtasticMap),
  {
    ssr: false,
    loading: () => <div className="glass-panel rounded-[2rem] p-6 text-slate-700">Načítám mapu Meshtastic nodeů...</div>,
  },
);

export function MeshtasticMapClient({ nodes, activeOnly }: { nodes: MeshtasticNode[]; activeOnly: boolean }) {
  return <MeshtasticMapInner nodes={nodes} activeOnly={activeOnly} />;
}
