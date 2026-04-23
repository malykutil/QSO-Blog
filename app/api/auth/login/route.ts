import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { clearAttempts, getRetryAfterSeconds, registerFailedAttempt } from "@/src/lib/login-rate-limit";
import { isSupabaseConfigured } from "@/src/lib/supabase";

const LOGIN_ERROR_MESSAGE = "Přihlášení se nezdařilo. Zkontroluj přihlašovací údaje a zkus to znovu.";
const RATE_LIMIT_MESSAGE = "Příliš mnoho pokusů o přihlášení. Zkus to prosím za chvíli znovu.";

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
  if (origin && origin !== request.nextUrl.origin) {
    return buildResponse({ error: "Neplatný požadavek." }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return buildResponse({ error: "Neplatný formát požadavku." }, 400);
  }

  const email = normalizeEmail((payload as { email?: unknown })?.email);
  const password = normalizePassword((payload as { password?: unknown })?.password);

  if (!isValidEmail(email) || !isValidPassword(password)) {
    return buildResponse({ error: LOGIN_ERROR_MESSAGE }, 400);
  }

  const ip = readClientIp(request);
  const ipKey = `login-ip:${ip}`;
  const identityKey = `login-ip-email:${ip}:${email}`;
  const existingCooldown = Math.max(getRetryAfterSeconds(ipKey), getRetryAfterSeconds(identityKey));

  if (existingCooldown > 0) {
    return buildResponse({ error: RATE_LIMIT_MESSAGE }, 429, withRateLimitHeaders(existingCooldown));
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
    const retryAfterSeconds = Math.max(registerFailedAttempt(ipKey), registerFailedAttempt(identityKey));

    if (retryAfterSeconds > 0) {
      return buildResponse({ error: RATE_LIMIT_MESSAGE }, 429, withRateLimitHeaders(retryAfterSeconds));
    }

    return buildResponse({ error: LOGIN_ERROR_MESSAGE }, 401);
  }

  clearAttempts(ipKey);
  clearAttempts(identityKey);

  return buildResponse({ ok: true }, 200);
}
