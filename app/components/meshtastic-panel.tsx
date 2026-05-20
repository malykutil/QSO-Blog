"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MeshtasticMapClient } from "@/app/components/meshtastic-map-client";
import {
  formatLastSeen,
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

type NodeSnapshot = {
  key: string;
  nodeId: string;
  label: string | null;
  lat: number | null;
  lon: number | null;
  lastSeen: string;
  payloadType: string | null;
};

const DEFAULT_CHANNEL_FILTER = "msh/EU_868/2/json/MediumFast";

function normalizeNodeLookupKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^!/, "");
}

function toNodeId(value: unknown) {
  const key = normalizeNodeLookupKey(value);
  return key ? `!${key}` : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractLatLon(record: Record<string, unknown>) {
  const lat = asNumber(record.latitude ?? record.lat);
  const lon = asNumber(record.longitude ?? record.lon);
  if (lat !== null && lon !== null) {
    return { lat, lon };
  }

  const latI = asNumber(record.latitude_i);
  const lonI = asNumber(record.longitude_i);
  if (latI !== null && lonI !== null) {
    return { lat: latI / 1e7, lon: lonI / 1e7 };
  }

  return { lat: null, lon: null };
}

function extractPacketNodeSnapshots(packet: MeshtasticPacket): NodeSnapshot[] {
  const payload = packet.payloadJson;
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const root = payload as Record<string, unknown>;
  const nested = root.payload && typeof root.payload === "object" ? (root.payload as Record<string, unknown>) : null;

  const snapshots: NodeSnapshot[] = [];

  const objects = [nested, root].filter(Boolean) as Record<string, unknown>[];
  for (const objectValue of objects) {
    const nodeId =
      toNodeId(objectValue.id) ??
      toNodeId(objectValue.sender) ??
      toNodeId(objectValue.fromId) ??
      toNodeId(objectValue.from) ??
      packet.fromNode ??
      packet.nodeId;
    const key = normalizeNodeLookupKey(nodeId);
    if (!key) {
      continue;
    }

    const label = firstString(
      objectValue.short_name,
      objectValue.shortName,
      objectValue.shortname,
      objectValue.long_name,
      objectValue.longName,
      objectValue.longname,
      objectValue.name,
    );
    const coords = extractLatLon(objectValue);
    const payloadType = firstString(objectValue.portnum, root.type, packet.portnum);

    snapshots.push({
      key,
      nodeId: toNodeId(nodeId) ?? `!${key}`,
      label,
      lat: coords.lat,
      lon: coords.lon,
      lastSeen: packet.createdAt,
      payloadType,
    });
  }

  return snapshots;
}

function resolveNodeLabel(
  nodeId: string | null,
  nodeLabelsById: Map<string, string>,
  options: { fallbackBroadcast?: string; fallbackUnknown?: string } = {},
) {
  const key = normalizeNodeLookupKey(nodeId);
  if (!key) {
    return options.fallbackUnknown ?? "Neznamy node";
  }

  if (key === "ffffffff") {
    return options.fallbackBroadcast ?? "Broadcast";
  }

  return nodeLabelsById.get(key) ?? options.fallbackUnknown ?? `Node ${key.toUpperCase()}`;
}

function formatPacketLine(packet: MeshtasticPacket, nodeLabelsById: Map<string, string>) {
  const from = resolveNodeLabel(packet.fromNode, nodeLabelsById);
  const to = resolveNodeLabel(packet.toNode, nodeLabelsById, { fallbackBroadcast: "Broadcast" });
  const inferredType = firstString(packet.portnum, packet.payloadJson?.type);
  const port = inferredType ?? "unknown";
  return `${from} -> ${to} (${port})`;
}

export function MeshtasticPanel() {
  const [nodes, setNodes] = useState<MeshtasticNode[]>([]);
  const [packets, setPackets] = useState<MeshtasticPacket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [channelFilter] = useState(DEFAULT_CHANNEL_FILTER);
  const [status, setStatus] = useState<PanelStatus>(
    isSupabaseConfigured() ? null : { type: "info", message: "Nejdriv nastav Supabase env promenne pro nacitani dat." },
  );

  const loadData = useCallback(async (withStatus = false) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    const [nodesResult, packetsResult] = await Promise.all([
      supabase.from("meshtastic_nodes").select(meshtasticNodeSelectFields).order("last_seen", { ascending: false }).limit(500),
      supabase.from("meshtastic_packets").select(meshtasticPacketSelectFields).order("created_at", { ascending: false }).limit(500),
    ]);

    const nodesErrorCode = (nodesResult.error as { code?: string } | null)?.code;
    const packetsErrorCode = (packetsResult.error as { code?: string } | null)?.code;

    if (nodesErrorCode === "42P01" || packetsErrorCode === "42P01") {
      setStatus({
        type: "error",
        message: "Chybi Meshtastic tabulky v Supabase. Spust SQL ze souboru supabase/meshtastic.sql.",
      });
      setLoading(false);
      return;
    }

    if (nodesResult.error || packetsResult.error) {
      setStatus({
        type: "error",
        message: "Nepodarilo se nacist Meshtastic data z databaze.",
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
        message: "Tabulky jsou pripravene. Jakmile RPi zacne posilat MQTT data, vse se zobrazi automaticky.",
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

  const filteredPackets = useMemo(() => {
    const normalizedFilter = channelFilter.trim().toLowerCase();
    if (!normalizedFilter) {
      return packets;
    }
    return packets.filter((packet) => {
      const channel = (packet.channel ?? "").toLowerCase();
      return channel.includes(normalizedFilter);
    });
  }, [channelFilter, packets]);

  const mergedNodes = useMemo(() => {
    const filteredNodeKeys = new Set<string>();
    for (const packet of filteredPackets) {
      for (const snapshot of extractPacketNodeSnapshots(packet)) {
        filteredNodeKeys.add(snapshot.key);
      }
    }

    const map = new Map<string, MeshtasticNode>();

    for (const node of nodes) {
      const key = normalizeNodeLookupKey(node.nodeId);
      if (!key) {
        continue;
      }
      if (filteredNodeKeys.size && !filteredNodeKeys.has(key)) {
        continue;
      }
      map.set(key, { ...node });
    }

    for (const packet of filteredPackets) {
      const snapshots = extractPacketNodeSnapshots(packet);
      for (const snapshot of snapshots) {
        const existing = map.get(snapshot.key);
        if (!existing) {
          map.set(snapshot.key, {
            id: `derived-${snapshot.key}`,
            nodeId: snapshot.nodeId,
            shortName: snapshot.label,
            longName: null,
            hwModel: null,
            role: null,
            lat: snapshot.lat,
            lon: snapshot.lon,
            batteryLevel: null,
            voltage: null,
            channelUtilization: null,
            airUtilTx: null,
            snr: packet.snr,
            rssi: packet.rssi,
            channel: packet.channel,
            lastPayloadType: snapshot.payloadType,
            lastSeen: snapshot.lastSeen,
            updatedAt: snapshot.lastSeen,
          });
          continue;
        }

        if (!existing.shortName && snapshot.label) {
          existing.shortName = snapshot.label;
        }
        if (existing.lat === null && snapshot.lat !== null) {
          existing.lat = snapshot.lat;
        }
        if (existing.lon === null && snapshot.lon !== null) {
          existing.lon = snapshot.lon;
        }
        if (!existing.lastPayloadType && snapshot.payloadType) {
          existing.lastPayloadType = snapshot.payloadType;
        }
        if (new Date(snapshot.lastSeen).getTime() > new Date(existing.lastSeen).getTime()) {
          existing.lastSeen = snapshot.lastSeen;
          existing.updatedAt = snapshot.lastSeen;
          if (packet.snr !== null) {
            existing.snr = packet.snr;
          }
          if (packet.rssi !== null) {
            existing.rssi = packet.rssi;
          }
          if (packet.channel) {
            existing.channel = packet.channel;
          }
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const timeA = new Date(a.lastSeen).getTime();
      const timeB = new Date(b.lastSeen).getTime();
      return timeB - timeA;
    });
  }, [filteredPackets, nodes]);

  const nodeLabelsById = useMemo(() => {
    const map = new Map<string, string>();

    for (const node of mergedNodes) {
      const key = normalizeNodeLookupKey(node.nodeId);
      if (!key) {
        continue;
      }
      const label = firstString(node.shortName, node.longName);
      if (label) {
        map.set(key, label);
      }
    }

    for (const packet of filteredPackets) {
      for (const snapshot of extractPacketNodeSnapshots(packet)) {
        if (snapshot.label && !map.has(snapshot.key)) {
          map.set(snapshot.key, snapshot.label);
        }
      }
    }

    return map;
  }, [filteredPackets, mergedNodes]);

  const withLocation = useMemo(() => mergedNodes.filter((node) => node.lat !== null && node.lon !== null).length, [mergedNodes]);
  const uniquePacketSenders = useMemo(() => {
    return new Set(filteredPackets.map((packet) => normalizeNodeLookupKey(packet.fromNode)).filter((key) => key && key !== "ffffffff")).size;
  }, [filteredPackets]);
  const lastPacketAt = useMemo(() => {
    if (!filteredPackets.length) {
      return null;
    }
    return filteredPackets[0]?.createdAt ?? null;
  }, [filteredPackets]);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[2.4rem] border border-slate-900/8 bg-[linear-gradient(135deg,_#0a1420_0%,_#14314c_42%,_#1f5d8f_100%)] p-7 text-white shadow-[0_24px_80px_rgba(13,27,50,0.16)] md:p-9">
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-200/80">Meshtastic</p>
          <h1 className="mt-3 font-display text-5xl leading-tight">Mapa nodu a ziva data</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-100/90">Data jsou filtrovana na kanal: {channelFilter}</p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[1.4rem] border border-slate-900/8 bg-white/85 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Packety celkem</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{filteredPackets.length}</p>
        </div>
        <div className="rounded-[1.4rem] border border-slate-900/8 bg-white/85 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Unikatni odesilatele</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{uniquePacketSenders}</p>
        </div>
        <div className="rounded-[1.4rem] border border-slate-900/8 bg-white/85 p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Posledni packet</p>
          <p className="mt-2 text-sm font-semibold text-slate-950">{lastPacketAt ? formatLastSeen(lastPacketAt) : "--"}</p>
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

      {!status && withLocation === 0 ? (
        <p className="rounded-[1.2rem] border border-amber-300/30 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          Zatim neprisla GPS poloha v packet datech. Mapa se zobrazi hned, jak dorazi packet s latitude/longitude.
        </p>
      ) : null}

      {loading ? <p className="text-slate-600">Nacitam Meshtastic data...</p> : null}

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <article className="glass-panel rounded-[2rem] p-5 md:p-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Mapa nodu</p>
              <h2 className="mt-2 text-3xl font-semibold text-slate-950">Meshtastic sit</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowActiveOnly(true)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  showActiveOnly ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                Jen aktivni
              </button>
              <button
                type="button"
                onClick={() => setShowActiveOnly(false)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  !showActiveOnly ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                Vsechny
              </button>
            </div>
          </div>
          <MeshtasticMapClient nodes={mergedNodes} activeOnly={showActiveOnly} />
        </article>

        <article className="glass-panel rounded-[2rem] p-5 md:p-6">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Posledni packety</p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-950">Live feed</h2>

          <div className="mt-4 max-h-[36rem] space-y-3 overflow-auto pr-1">
            {filteredPackets.length ? (
              filteredPackets.map((packet) => (
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
              <p className="rounded-[1rem] border border-slate-900/10 bg-white/90 px-4 py-3 text-sm text-slate-600">Na zvolenem kanalu zatim neprisly zadne packety.</p>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
