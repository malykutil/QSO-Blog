import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { clearAttempts, getRetryAfterSeconds, registerFailedAttempt } from "@/src/lib/login-rate-limit";
import { isSupabaseConfigured } from "@/src/lib/supabase";
import {
  createSolarControlSession,
  isSolarControlCredentials,
  SOLAR_CONTROL_COOKIE,
  SOLAR_CONTROL_SESSION_MAX_AGE_SECONDS,
} from "@/src/lib/solar-auth";

const LOGIN_ERROR_MESSAGE = "Přihlášení se nezdařilo. Zkontroluj přihlašovací údaje a zkus to znovu.";
const RATE_LIMIT_MESSAGE = "Příliš mnoho pokusů o přihlášení. Zkus to prosím za chvíli znovu.";
const PUBLIC_APP_ORIGINS = new Set(["https://ok2mkj.cz", "https://www.ok2mkj.cz"]);

function buildResponse(body: Record<string, unknown>, status: number, extraHeaders: HeadersInit = {}) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...extraHeaders,
    },
  });
}

function readClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  return realIp?.trim() || "unknown";
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

function normalizePassword(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value;
}

function isValidEmail(email: string) {
  if (!email || email.length > 254) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password: string) {
  return password.length >= 1 && password.length <= 128;
}

function withRateLimitHeaders(retryAfterSeconds: number) {
  return {
    "Retry-After": String(retryAfterSeconds),
  };
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return buildResponse({ error: "Přihlášení je dočasně nedostupné." }, 503);
  }

  const origin = request.headers.get("origin");
  const allowedOrigins = new Set([request.nextUrl.origin, ...PUBLIC_APP_ORIGINS]);

  // Cloudflare Tunnel terminates HTTPS before forwarding the request to this
  // local HTTP origin. Accept only the two public HTTPS origins in addition to
  // the request origin so the CSRF check remains effective behind the proxy.
  if (origin && !allowedOrigins.has(origin)) {
    return buildResponse({ error: "Neplatný požadavek." }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return buildResponse({ error: "Neplatný formát požadavku." }, 400);
  }

  const username = typeof (payload as { email?: unknown })?.email === "string" ? (payload as { email: string }).email.trim() : "";
  const password = normalizePassword((payload as { password?: unknown })?.password);

  const ip = readClientIp(request);
  const normalizedIdentity = username.trim().toLowerCase().slice(0, 254) || "unknown";
  const ipKey = `login-ip:${ip}`;
  const identityKey = `login-ip-identity:${ip}:${normalizedIdentity}`;
  const existingCooldown = Math.max(getRetryAfterSeconds(ipKey), getRetryAfterSeconds(identityKey));

  if (existingCooldown > 0) {
    return buildResponse({ error: RATE_LIMIT_MESSAGE }, 429, withRateLimitHeaders(existingCooldown));
  }

  const registerFailure = () => Math.max(registerFailedAttempt(ipKey), registerFailedAttempt(identityKey));

  if (isSolarControlCredentials(username, password)) {
    clearAttempts(ipKey);
    clearAttempts(identityKey);
    const response = buildResponse({ ok: true, solarControl: true }, 200);
    response.cookies.set(SOLAR_CONTROL_COOKIE, createSolarControlSession(), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SOLAR_CONTROL_SESSION_MAX_AGE_SECONDS,
      priority: "high",
    });
    return response;
  }

  const email = normalizeEmail(username);

  if (!isValidEmail(email) || !isValidPassword(password)) {
    const retryAfterSeconds = registerFailure();
    return retryAfterSeconds > 0
      ? buildResponse({ error: RATE_LIMIT_MESSAGE }, 429, withRateLimitHeaders(retryAfterSeconds))
      : buildResponse({ error: LOGIN_ERROR_MESSAGE }, 400);
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const retryAfterSeconds = registerFailure();

    if (retryAfterSeconds > 0) {
      return buildResponse({ error: RATE_LIMIT_MESSAGE }, 429, withRateLimitHeaders(retryAfterSeconds));
    }

    return buildResponse({ error: LOGIN_ERROR_MESSAGE }, 401);
  }

  clearAttempts(ipKey);
  clearAttempts(identityKey);

  return buildResponse({ ok: true }, 200);
}

