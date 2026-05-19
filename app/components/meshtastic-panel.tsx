"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MeshtasticMapClient } from "@/app/components/meshtastic-map-client";
import {
  formatLastSeen,
  isNodeOnline,
  meshtasticNodeSelectFields,
  meshtasticPacketSelectFields,
  normalizeMeshtasticNode,
  normalizeMeshtasticPacket,
  type MeshtasticNode,
  type MeshtasticPacket,
} from "@/src/lib/meshtastic";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/src/lib/supabase";

type PanelStatus = {
  type: "info" | "error";
  message: string;
} | null;

function normalizeNodeLookupKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^!/, "");
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractPacketAliases(packet: MeshtasticPacket) {
  const payload = packet.payloadJson;
  if (!payload || typeof payload !== "object") {
    return [] as Array<{ key: string; label: string }>;
  }

  const record = payload as Record<string, unknown>;
  const aliases: Array<{ key: string; label: string }> = [];

  const baseLabel = firstString(
    record.short_name,
    record.shortName,
    record.shortname,
    record.long_name,
    record.longName,
    record.longname,
    record.name,
    record.sender_name,
    record.senderName,
  );
  const baseId = normalizeNodeLookupKey(record.id ?? record.fromId ?? record.sender ?? record.from ?? packet.fromNode ?? packet.nodeId);
  if (baseLabel && baseId) {
    aliases.push({ key: baseId, label: baseLabel });
  }

  const user = record.user;
  if (user && typeof user === "object") {
    const userRecord = user as Record<string, unknown>;
    const userLabel = firstString(
      userRecord.short_name,
      userRecord.shortName,
      userRecord.shortname,
      userRecord.long_name,
      userRecord.longName,
      userRecord.longname,
      userRecord.name,
    );
    const userId = normalizeNodeLookupKey(userRecord.id ?? packet.fromNode ?? packet.nodeId);
    if (userLabel && userId) {
      aliases.push({ key: userId, label: userLabel });
    }
  }

  return aliases;
}

function resolveNodeLabel(
  nodeId: string | null,
  nodeLabelsById: Map<string, string>,
  options: { fallbackBroadcast?: string; fallbackUnknown?: string } = {},
) {
  const key = normalizeNodeLookupKey(nodeId);
  if (!key) {
    return options.fallbackUnknown ?? "Neznámý node";
  }

  if (key === "ffffffff") {
    return options.fallbackBroadcast ?? "Broadcast";
  }

  return nodeLabelsById.get(key) ?? options.fallbackUnknown ?? "Neznámý node";
}

function formatPacketLine(packet: MeshtasticPacket, nodeLabelsById: Map<string, string>) {
  const from = resolveNodeLabel(packet.fromNode, nodeLabelsById);
  const to = resolveNodeLabel(packet.toNode, nodeLabelsById, { fallbackBroadcast: "Broadcast" });
  const inferredType = typeof packet.payloadJson?.type === "string" ? packet.payloadJson.type : null;
  const port = packet.portnum ?? inferredType ?? "unknown";
  return `${from} -> ${to} (${port})`;
}

export function MeshtasticPanel() {
  const [nodes, setNodes] = useState<MeshtasticNode[]>([]);
  const [packets, setPackets] = useState<MeshtasticPacket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [status, setStatus] = useState<PanelStatus>(
    isSupabaseConfigured() ? null : { type: "info", message: "Nejdřív nastav Supabase env proměnné pro načítání dat." },
  );

  const loadData = useCallback(async (withStatus = false) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    const [nodesResult, packetsResult] = await Promise.all([
      supabase.from("meshtastic_nodes").select(meshtasticNodeSelectFields).order("last_seen", { ascending: false }).limit(500),
      supabase.from("meshtastic_packets").select(meshtasticPacketSelectFields).order("created_at", { ascending: false }).limit(300),
    ]);

    const nodesErrorCode = (nodesResult.error as { code?: string } | null)?.code;
    const packetsErrorCode = (packetsResult.error as { code?: string } | null)?.code;

    if (nodesErrorCode === "42P01" || packetsErrorCode === "42P01") {
      setStatus({
        type: "error",
        message: "Chybí Meshtastic tabulky v Supabase. Spusť SQL ze souboru supabase/meshtastic.sql.",
      });
      setLoading(false);
      return;
    }

    if (nodesResult.error || packetsResult.error) {
      setStatus({
        type: "error",
        message: "Nepodařilo se načíst Meshtastic data z databáze.",
      });
      setLoading(false);
      return;
    }

    const normalizedNodes = (nodesResult.data ?? []).map((row) => normalizeMeshtasticNode(row));
    const normalizedPackets = (packetsResult.data ?? []).map((row) => normalizeMeshtasticPacket(row));
    setNodes(normalizedNodes);
    setPackets(normalizedPackets);

    if (!normalizedNodes.length && !normalizedPackets.length) {
      setStatus({
        type: "info",
        message: "Tabulky jsou připravené. Jakmile RPi začne posílat MQTT data, vše se zobrazí automaticky.",
      });
    } else if (withStatus) {
      setStatus(null);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    const initialId = window.setTimeout(() => {
      void loadData(true);
    }, 0);

    const intervalId = window.setInterval(() => {
      void loadData(false);
    }, 15000);

    return () => {
      window.clearTimeout(initialId);
      window.clearInterval(intervalId);
    };
  }, [loadData]);

  const onlineNodes = useMemo(() => nodes.filter((node) => isNodeOnline(node.lastSeen)).length, [nodes]);
  const withLocation = useMemo(() => nodes.filter((node) => node.lat !== null && node.lon !== null).length, [nodes]);

  const nodeLabelsById = useMemo(() => {
    const map = new Map<string, string>();

    for (const node of nodes) {
      const key = normalizeNodeLookupKey(node.nodeId);
      if (!key) {
        continue;
      }
      const label = firstString(node.shortName, node.longName);
      if (label) {
        map.set(key, label);
      }
    }

    for (const packet of packets) {
      for (const alias of extractPacketAliases(packet)) {
        if (!map.has(alias.key)) {
          map.set(alias.key, alias.label);
        }
      }
    }

    return map;
  }, [nodes, packets]);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[2.4rem] border border-slate-900/8 bg-[linear-gradient(135deg,_#0a1420_0%,_#14314c_42%,_#1f5d8f_100%)] p-7 text-white shadow-[0_24px_80px_rgba(13,27,50,0.16)] md:p-9">
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-200/80">Meshtastic</p>
          <h1 className="mt-3 font-display text-5xl leading-tight">Mapa nodeů a živá data</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-100/90">Aktivní nody a packet feed se aktualizují automaticky každých 15 sekund.</p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[1.4rem] border border-slate-900/8 bg-white/85 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Node celkem</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{nodes.length}</p>
        </div>
        <div className="rounded-[1.4rem] border border-slate-900/8 bg-white/85 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Aktivní</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-700">{onlineNodes}</p>
        </div>
        <div className="rounded-[1.4rem] border border-slate-900/8 bg-white/85 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">S GPS</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{withLocation}</p>
        </div>
        <div className="rounded-[1.4rem] border border-slate-900/8 bg-white/85 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Packety (feed)</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{packets.length}</p>
        </div>
      </section>

      {status ? (
        <p
          className={`rounded-[1.2rem] border px-4 py-3 text-sm leading-6 ${
            status.type === "error" ? "border-red-300/30 bg-red-50 text-red-800" : "border-sky-300/30 bg-sky-50 text-sky-900"
          }`}
        >
          {status.message}
        </p>
      ) : null}

      {loading ? <p className="text-slate-600">Načítám Meshtastic data...</p> : null}

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <article className="glass-panel rounded-[2rem] p-5 md:p-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Mapa nodeů</p>
              <h2 className="mt-2 text-3xl font-semibold text-slate-950">Meshtastic síť</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowActiveOnly(true)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  showActiveOnly ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                Jen aktivní
              </button>
              <button
                type="button"
                onClick={() => setShowActiveOnly(false)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  !showActiveOnly ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                Všechny
              </button>
            </div>
          </div>
          <MeshtasticMapClient nodes={nodes} activeOnly={showActiveOnly} />
        </article>

        <article className="glass-panel rounded-[2rem] p-5 md:p-6">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Poslední packety</p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-950">Live feed</h2>

          <div className="mt-4 max-h-[36rem] space-y-3 overflow-auto pr-1">
            {packets.length ? (
              packets.map((packet) => (
                <div key={packet.id} className="rounded-[1rem] border border-slate-900/10 bg-white/90 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">{formatPacketLine(packet, nodeLabelsById)}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatLastSeen(packet.createdAt)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {packet.snr !== null ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">SNR {packet.snr} dB</span> : null}
                    {packet.rssi !== null ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">RSSI {packet.rssi} dBm</span> : null}
                    {packet.channel ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{packet.channel}</span> : null}
                  </div>
                  {packet.payloadText ? <p className="mt-2 line-clamp-2 text-xs text-slate-600">{packet.payloadText}</p> : null}
                </div>
              ))
            ) : (
              <p className="rounded-[1rem] border border-slate-900/10 bg-white/90 px-4 py-3 text-sm text-slate-600">Zatím nepřišly žádné packety.</p>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
