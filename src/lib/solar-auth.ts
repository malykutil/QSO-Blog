import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SOLAR_CONTROL_COOKIE = "solar-control-session";
export const SOLAR_CONTROL_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function getSolarControlConfig() {
  const username = process.env.SOLAR_CONTROL_USERNAME?.trim();
  const password = process.env.SOLAR_CONTROL_PASSWORD;
  const sessionSecret = process.env.SOLAR_CONTROL_SESSION_SECRET;

  if (!username || !password || !sessionSecret || password.length < 20 || sessionSecret.length < 32) {
    return null;
  }

  return { username, password, sessionSecret };
}

function secureEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function signSessionPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function isSolarControlConfigured() {
  return Boolean(getSolarControlConfig());
}

export function isSolarControlCredentials(username: string, password: string) {
  const config = getSolarControlConfig();
  if (!config) return false;
  return secureEqual(username.trim().toUpperCase(), config.username.toUpperCase()) && secureEqual(password, config.password);
}

export function createSolarControlSession() {
  const config = getSolarControlConfig();
  if (!config) throw new Error("Solar control authentication is not securely configured");
  const expiresAt = Date.now() + SOLAR_CONTROL_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v1.${expiresAt}.${randomBytes(18).toString("base64url")}`;
  return `${payload}.${signSessionPayload(payload, config.sessionSecret)}`;
}

export function verifySolarControlSession(token: string | undefined) {
  const config = getSolarControlConfig();
  if (!config || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + SOLAR_CONTROL_SESSION_MAX_AGE_SECONDS * 1000) {
    return false;
  }
  const payload = parts.slice(0, 3).join(".");
  return secureEqual(parts[3], signSessionPayload(payload, config.sessionSecret));
}

export async function hasSolarControlSession() {
  const cookieStore = await cookies();
  return verifySolarControlSession(cookieStore.get(SOLAR_CONTROL_COOKIE)?.value);
}

