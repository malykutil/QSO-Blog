import { NextResponse } from "next/server";
import { SOLAR_CONTROL_COOKIE } from "@/src/lib/solar-auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SOLAR_CONTROL_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    priority: "high",
  });
  return response;
}

