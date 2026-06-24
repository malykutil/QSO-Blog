"use client";

import "leaflet/dist/leaflet.css";

import { useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer } from "react-leaflet";

import { maidenheadToLatLon, type EnrichedQsoRecord } from "@/src/lib/qso-data";

function getRouteCenter(record: EnrichedQsoRecord, homeLocator: string) {
  const home = maidenheadToLatLon(homeLocator);
  const target = { lat: record.lat, lon: record.lon };

  if (home.lat !== null && home.lon !== null && target.lat !== null && target.lon !== null) {
    return {
      lat: (home.lat + target.lat) / 2,
      lon: (home.lon + target.lon) / 2,
    };
  }

  if (target.lat !== null && target.lon !== null) {
    return target;
  }

  if (home.lat !== null && home.lon !== null) {
    return home;
  }

  return { lat: 50.08, lon: 14.43 };
}

export function QslRouteMap({ record, homeLocator }: { record: EnrichedQsoRecord; homeLocator: string }) {
  const home = useMemo(() => maidenheadToLatLon(homeLocator), [homeLocator]);
  const center = useMemo(() => getRouteCenter(record, homeLocator), [homeLocator, record]);
  const mapCenter: [number, number] = [center.lat ?? 50.08, center.lon ?? 14.43];

  if (home.lat === null || home.lon === null || record.lat === null || record.lon === null) {
    return (
      <div className="rounded-[1.6rem] border border-slate-900/10 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        K této kartě chybí souřadnice pro zobrazení mapy.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[1.6rem] border border-slate-900/10">
      <MapContainer center={mapCenter} zoom={4} scrollWheelZoom={false} className="h-[22rem] w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <Polyline
          positions={[
            [home.lat, home.lon],
            [record.lat, record.lon],
          ]}
          pathOptions={{
            color: "#dc2626",
            weight: 3,
            opacity: 0.85,
          }}
        />

        <CircleMarker
          center={[home.lat, home.lon]}
          radius={8}
          pathOptions={{
            color: "#0f172a",
            fillColor: "#0f172a",
            fillOpacity: 0.95,
          }}
        >
          <Popup>
            <div className="space-y-1 text-sm">
              <p className="font-semibold">Domácí stanice</p>
              <p>{homeLocator || "nenastaveno"}</p>
            </div>
          </Popup>
        </CircleMarker>

        <CircleMarker
          center={[record.lat, record.lon]}
          radius={9}
          pathOptions={{
            color: "#b91c1c",
            fillColor: "#ef4444",
            fillOpacity: 0.95,
          }}
        >
          <Popup>
            <div className="space-y-1 text-sm">
              <p className="font-semibold">{record.callsign}</p>
              <p>
                {record.band || "--"} / {record.mode || "--"}
              </p>
              <p>{record.locator || "Bez lokátoru"}</p>
              {record.distanceKm !== null ? <p>Vzdálenost: {record.distanceKm} km</p> : null}
            </div>
          </Popup>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}
