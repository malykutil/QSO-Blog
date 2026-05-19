export type MeshtasticNode = {
  id: string;
  nodeId: string;
  shortName: string | null;
  longName: string | null;
  hwModel: string | null;
  role: string | null;
  lat: number | null;
  lon: number | null;
  batteryLevel: number | null;
  voltage: number | null;
  channelUtilization: number | null;
  airUtilTx: number | null;
  snr: number | null;
  rssi: number | null;
  channel: string | null;
  lastPayloadType: string | null;
  lastSeen: string;
  updatedAt: string;
};

export type MeshtasticPacket = {
  id: string;
  nodeId: string | null;
  fromNode: string | null;
  toNode: string | null;
  portnum: string | null;
  payloadText: string | null;
  payloadJson: Record<string, unknown> | null;
  hopLimit: number | null;
  snr: number | null;
  rssi: number | null;
  channel: string | null;
  createdAt: string;
};

export const meshtasticNodeSelectFields =
  "id,node_id,short_name,long_name,hw_model,role,lat,lon,battery_level,voltage,channel_utilization,air_util_tx,snr,rssi,channel,last_payload_type,last_seen,updated_at";

export const meshtasticPacketSelectFields =
  "id,node_id,from_node,to_node,portnum,payload_text,payload_json,hop_limit,snr,rssi,channel,created_at";

export function normalizeMeshtasticNode(row: Record<string, unknown>): MeshtasticNode {
  return {
    id: String(row.id ?? ""),
    nodeId: String(row.node_id ?? ""),
    shortName: (row.short_name as string | null) ?? null,
    longName: (row.long_name as string | null) ?? null,
    hwModel: (row.hw_model as string | null) ?? null,
    role: (row.role as string | null) ?? null,
    lat: typeof row.lat === "number" ? row.lat : null,
    lon: typeof row.lon === "number" ? row.lon : null,
    batteryLevel: typeof row.battery_level === "number" ? row.battery_level : null,
    voltage: typeof row.voltage === "number" ? row.voltage : null,
    channelUtilization: typeof row.channel_utilization === "number" ? row.channel_utilization : null,
    airUtilTx: typeof row.air_util_tx === "number" ? row.air_util_tx : null,
    snr: typeof row.snr === "number" ? row.snr : null,
    rssi: typeof row.rssi === "number" ? row.rssi : null,
    channel: (row.channel as string | null) ?? null,
    lastPayloadType: (row.last_payload_type as string | null) ?? null,
    lastSeen: String(row.last_seen ?? new Date(0).toISOString()),
    updatedAt: String(row.updated_at ?? new Date(0).toISOString()),
  };
}

export function normalizeMeshtasticPacket(row: Record<string, unknown>): MeshtasticPacket {
  return {
    id: String(row.id ?? ""),
    nodeId: (row.node_id as string | null) ?? null,
    fromNode: (row.from_node as string | null) ?? null,
    toNode: (row.to_node as string | null) ?? null,
    portnum: (row.portnum as string | null) ?? null,
    payloadText: (row.payload_text as string | null) ?? null,
    payloadJson: (row.payload_json as Record<string, unknown> | null) ?? null,
    hopLimit: typeof row.hop_limit === "number" ? row.hop_limit : null,
    snr: typeof row.snr === "number" ? row.snr : null,
    rssi: typeof row.rssi === "number" ? row.rssi : null,
    channel: (row.channel as string | null) ?? null,
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
  };
}

export function formatLastSeen(isoValue: string) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function isNodeOnline(lastSeenIso: string, thresholdMinutes = 30) {
  const value = new Date(lastSeenIso).getTime();
  if (!Number.isFinite(value)) {
    return false;
  }

  return Date.now() - value <= thresholdMinutes * 60 * 1000;
}
