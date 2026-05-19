"use client";

import "leaflet/dist/leaflet.css";

import { useMemo } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

import { formatLastSeen, isNodeOnline, type MeshtasticNode } from "@/src/lib/meshtastic";

type MeshtasticMapProps = {
  nodes: MeshtasticNode[];
  activeOnly: boolean;
};

function computeCenter(nodes: MeshtasticNode[]) {
  const withCoordinates = nodes.filter((node) => node.lat !== null && node.lon !== null);
  if (!withCoordinates.length) {
    return { lat: 50.08, lon: 14.43, zoom: 4 };
  }

  const sum = withCoordinates.reduce(
    (acc, node) => ({
      lat: acc.lat + (node.lat ?? 0),
      lon: acc.lon + (node.lon ?? 0),
    }),
    { lat: 0, lon: 0 },
  );

  const avgLat = sum.lat / withCoordinates.length;
  const avgLon = sum.lon / withCoordinates.length;
  const zoom = withCoordinates.length > 80 ? 3 : withCoordinates.length > 20 ? 4 : 5;

  return { lat: avgLat, lon: avgLon, zoom };
}

export function MeshtasticMap({ nodes, activeOnly }: MeshtasticMapProps) {
  const mappableNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (node.lat === null || node.lon === null) {
        return false;
      }
      if (!activeOnly) {
        return true;
      }
      return isNodeOnline(node.lastSeen);
    });
  }, [activeOnly, nodes]);

  const center = useMemo(() => computeCenter(mappableNodes.length ? mappableNodes : nodes), [mappableNodes, nodes]);

  return (
    <div className="overflow-hidden rounded-[1.8rem] border border-slate-900/10">
      <MapContainer center={[center.lat, center.lon]} zoom={center.zoom} minZoom={2} scrollWheelZoom className="h-[36rem] w-full">
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {mappableNodes.map((node) => {
          const online = isNodeOnline(node.lastSeen);
          return (
            <CircleMarker
              key={node.id}
              center={[node.lat ?? 0, node.lon ?? 0]}
              radius={online ? 9 : 6}
              pathOptions={{
                color: online ? "#059669" : "#64748b",
                fillColor: online ? "#34d399" : "#cbd5e1",
                fillOpacity: 0.9,
              }}
            >
              <Popup>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">{node.shortName || node.longName || "Neznámý node"}</p>
                  <p>Naposledy: {formatLastSeen(node.lastSeen)}</p>
                  {node.batteryLevel !== null ? <p>Baterie: {node.batteryLevel}%</p> : null}
                  {node.voltage !== null ? <p>Napětí: {node.voltage.toFixed(2)} V</p> : null}
                  {node.snr !== null ? <p>SNR: {node.snr} dB</p> : null}
                  {node.rssi !== null ? <p>RSSI: {node.rssi} dBm</p> : null}
                  {node.lastPayloadType ? <p>Poslední typ: {node.lastPayloadType}</p> : null}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
