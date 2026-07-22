import { cookies } from "next/headers";

export const SOLAR_CONTROL_COOKIE = "solar-control-session";
export const SOLAR_CONTROL_USERNAME = process.env.SOLAR_CONTROL_USERNAME ?? "KZB";
export const SOLAR_CONTROL_PASSWORD = process.env.SOLAR_CONTROL_PASSWORD ?? "OK2KZB";

export function isSolarControlCredentials(username: string, password: string) {
  return username.trim().toUpperCase() === SOLAR_CONTROL_USERNAME.toUpperCase() && password === SOLAR_CONTROL_PASSWORD;
}

export function getSolarControlCookieValue() {
  return `${SOLAR_CONTROL_USERNAME}:${SOLAR_CONTROL_PASSWORD}`;
}

export async function hasSolarControlSession() {
  const cookieStore = await cookies();
  return cookieStore.get(SOLAR_CONTROL_COOKIE)?.value === getSolarControlCookieValue();
}
