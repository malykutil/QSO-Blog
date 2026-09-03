import { NextRequest, NextResponse } from "next/server";

import { SDR_CONTROLLER_URL, SDR_RECEIVER_URL, type SdrStatus } from "@/src/lib/sdr";
import { fetchSdrController } from "@/src/lib/sdr-controller";

export const dynamic = "force-dynamic";

async function readControllerStatus(): Promise<Omit<SdrStatus, "available" | "canControl">> {
  const response = await fetchSdrController(`${SDR_CONTROLLER_URL}/status`);
  if (!response.ok) throw new Error(`RPi vrátilo HTTP ${response.status}.`);
  const payload = await response.json() as Partial<SdrStatus>;
  return {
    active: Boolean(payload.active),
    ready: Boolean(payload.ready),
    deviceConnected: Boolean(payload.deviceConnected),
    idleTimeoutSeconds: Number(payload.idleTimeoutSeconds) || 180,
    secondsRemaining: Number(payload.secondsRemaining) || 0,
    receiverUrl: typeof payload.receiverUrl === "string" ? payload.receiverUrl : SDR_RECEIVER_URL,
  };
}

export async function GET() {
  try {
    return NextResponse.json(
      { ...(await readControllerStatus()), available: true, canControl: true },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("SDR controller status request failed", error);
    return NextResponse.json({
      active: false,
      ready: false,
      available: false,
      canControl: true,
      deviceConnected: false,
      idleTimeoutSeconds: 180,
      secondsRemaining: 0,
      receiverUrl: SDR_RECEIVER_URL,
      error: error instanceof Error ? error.message : "RPi není dostupné.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}

export async function POST(request: NextRequest) {
  let payload: { action?: unknown };
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Neplatný JSON." }, { status: 400 }); }
  const action = payload.action;
  if (action !== "start" && action !== "stop" && action !== "heartbeat") {
    return NextResponse.json({ error: "Neplatná akce WebSDR." }, { status: 400 });
  }
  const token = process.env.SOLAR_RPI_TOKEN;
  if (!token) return NextResponse.json({ error: "Na serveru chybí řídicí token RPi." }, { status: 503 });
  try {
    const response = await fetchSdrController(`${SDR_CONTROLLER_URL}/${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      timeoutMs: 35_000,
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) return NextResponse.json({ error: typeof result.error === "string" ? result.error : `RPi vrátilo HTTP ${response.status}.` }, { status: response.status });
    return NextResponse.json({ ...result, available: true, canControl: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "RPi není dostupné." }, { status: 503 });
  }
}
