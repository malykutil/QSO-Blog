import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || new URL("/api/auth/gmail/callback", request.url).toString();
  if (!clientId || !clientSecret) return NextResponse.json({ error: "Google OAuth není nakonfigurovaný." }, { status: 503 });
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const url = client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.send"] });
  return NextResponse.redirect(url);
}
