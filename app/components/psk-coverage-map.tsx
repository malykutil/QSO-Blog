"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import terminator from "@joergdietrich/leaflet.terminator";

import { maidenheadToLatLon } from "@/src/lib/qso-data";
import { readHomeLocator } from "@/src/lib/station-settings";

export type PskSpot = {
  receiverCallsign: string;
  receiverLocator: string;
  receiverDXCC: string;
  senderCallsign: string;
  senderLocator: string;
  mode: string;
  snr: string;
  frequency: string;
  flowStartSeconds: number;
};

type MapSpot = PskSpot & {
  lat: number;
  lon: number;
};

function formatFrequencyMhz(value: string) {
  const frequency = Number(value);
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return "--";
  }

  return `${(frequency / 1_000_000).toFixed(3)} MHz`;
}

function formatUnixSeconds(value: number) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function DayNightOverlay() {
  const map = useMap();

  useEffect(() => {
    const layer = terminator({
      resolution: 3,
      longitudeRange: 360,
      color: "#0f172a",
      opacity: 0.55,
      weight: 1,
      fillColor: "#0b1224",
      fillOpacity: 0.24,
    });

    layer.addTo(map);

    const interval = window.setInterval(() => {
      layer.setTime(new Date());
    }, 60_000);

    return () => {
      window.clearInterval(interval);
      layer.remove();
    };
  }, [map]);

  return null;
}

export function PskCoverageMap({ spots }: { spots: PskSpot[] }) {
  const mapSpots = useMemo<MapSpot[]>(() => {
    const expanded = spots
      .map((spot) => {
        const coords = maidenheadToLatLon(spot.receiverLocator);
        if (coords.lat === null || coords.lon === null) {
          return null;
        }

        return {
          ...spot,
          lat: coords.lat,
          lon: coords.lon,
        };
      })
      .filter((item): item is MapSpot => item !== null);

    const latestByReceiver = new Map<string, MapSpot>();

    for (const spot of expanded) {
      const key = `${spot.receiverCallsign}|${spot.receiverLocator}|${spot.lat.toFixed(3)}|${spot.lon.toFixed(3)}`;
      const existing = latestByReceiver.get(key);

      if (!existing || spot.flowStartSeconds > existing.flowStartSeconds) {
        latestByReceiver.set(key, spot);
      }
    }

    return Array.from(latestByReceiver.values());
  }, [spots]);

  const homeCoords = useMemo(() => {
    const senderLocator = spots.find((spot) => Boolean(spot.senderLocator))?.senderLocator ?? "";
    const sender = maidenheadToLatLon(senderLocator);

    if (sender.lat !== null && sender.lon !== null) {
      return sender;
    }

    return maidenheadToLatLon(readHomeLocator());
  }, [spots]);

  const worldCenter = useMemo(() => ({ lat: 20, lon: 0 }), []);

  return (
    <div className="overflow-hidden rounded-[1.8rem] border border-slate-900/10">
      <MapContainer center={[worldCenter.lat, worldCenter.lon]} zoom={1} minZoom={1} scrollWheelZoom className="h-[42rem] w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <DayNightOverlay />

        {homeCoords.lat !== null && homeCoords.lon !== null ? (
          <CircleMarker
            center={[homeCoords.lat, homeCoords.lon]}
            radius={8}
            pathOptions={{
              color: "#0f172a",
              fillColor: "#2563eb",
              fillOpacity: 0.95,
              weight: 2,
            }}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-semibold">Tvoje stanice</p>
                <p>Zdrojový bod mapy slyšitelnosti</p>
              </div>
            </Popup>
          </CircleMarker>
        ) : null}

        {homeCoords.lat !== null && homeCoords.lon !== null
          ? mapSpots.slice(0, 220).map((spot, index) => (
              <Polyline
                key={`line-${spot.receiverCallsign}-${spot.flowStartSeconds}-${index}`}
                positions={[
                  [homeCoords.lat ?? 0, homeCoords.lon ?? 0],
                  [spot.lat, spot.lon],
                ]}
                pathOptions={{
                  color: "#60a5fa",
                  weight: 1.5,
                  opacity: 0.55,
                }}
              />
            ))
          : null}

        {mapSpots.map((spot, index) => (
          <CircleMarker
            key={`${spot.receiverCallsign}-${spot.flowStartSeconds}-${index}`}
            center={[spot.lat, spot.lon]}
            radius={6}
            pathOptions={{
              color: "#1d4ed8",
              fillColor: "#60a5fa",
              fillOpacity: 0.9,
            }}
          >
            <Popup>
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{spot.receiverCallsign}</p>
                <p>{spot.receiverDXCC || "Neznámá země"}</p>
                <p>{spot.receiverLocator || "--"}</p>
                <p>
                  {spot.mode || "--"} / SNR {spot.snr || "--"}
                </p>
                <p>{formatFrequencyMhz(spot.frequency)}</p>
                <p>Naposledy slyšet: {formatUnixSeconds(spot.flowStartSeconds)}</p>
              </div>
            </Popup>
            <Tooltip direction="top" offset={[0, -8]} opacity={0.92}>
              {formatUnixSeconds(spot.flowStartSeconds)}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
