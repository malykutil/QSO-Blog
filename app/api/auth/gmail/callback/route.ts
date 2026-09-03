import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/qsl?gmail=error", request.url));
  const redirectUri = new URL("/api/auth/gmail/callback", request.url).toString();
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
  try {
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const profile = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
    const response = NextResponse.redirect(new URL(`/qsl?gmail=connected&email=${encodeURIComponent(profile.data.email || "")}`, request.url));
    if (tokens.refresh_token) response.cookies.set("gmail_refresh_token", tokens.refresh_token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    if (tokens.access_token) response.cookies.set("gmail_access_token", tokens.access_token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 3600 });
    response.cookies.set("gmail_email", profile.data.email || "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch (error) {
    console.error("Gmail OAuth callback failed", error);
    return NextResponse.redirect(new URL("/qsl?gmail=error", request.url));
  }
}
