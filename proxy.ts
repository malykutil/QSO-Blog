import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { isSupabaseConfigured } from "@/src/lib/supabase";

const privatePaths = ["/dashboard", "/settings", "/bezpecnost"];
const accessLogExcludedEmails = new Set(["malykutil06@gmail.com"]);

function isPrivatePath(pathname: string) {
  return privatePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isSecurityPath(pathname: string) {
  return pathname === "/bezpecnost" || pathname.startsWith("/bezpecnost/");
}

function isSafeNextPath(pathnameWithQuery: string) {
  return pathnameWithQuery.startsWith("/") && !pathnameWithQuery.startsWith("//");
}

function isPrefetchRequest(request: NextRequest) {
  return request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch";
}

function readClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  const realIp = request.headers.get("x-real-ip");
  return realIp?.trim() || null;
}

function readCountryCode(request: NextRequest) {
  const countryCodeHeader =
    request.headers.get("x-vercel-ip-country") ?? request.headers.get("cf-ipcountry") ?? request.headers.get("x-country-code");

  if (!countryCodeHeader) {
    return null;
  }

  const countryCode = countryCodeHeader.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return null;
  }

  return countryCode;
}

function readCountryName(countryCode: string | null) {
  if (!countryCode) {
    return null;
  }

  try {
    if (typeof Intl.DisplayNames !== "function") {
      return countryCode;
    }

    const displayNames = new Intl.DisplayNames(["cs-CZ", "en"], { type: "region" });
    return displayNames.of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

function shouldSkipAccessLog(email: string | null | undefined) {
  if (!email) {
    return false;
  }

  return accessLogExcludedEmails.has(email.trim().toLowerCase());
}

async function logAccess(payload: {
  path: string;
  method: string;
  visitorType: "anon" | "authenticated";
  userId: string | null;
  userEmail: string | null;
  ipAddress: string | null;
  countryCode: string | null;
  countryName: string | null;
  userAgent: string | null;
  referer: string | null;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    await supabase.from("security_access_logs").insert({
      visited_at: new Date().toISOString(),
      path: payload.path,
      method: payload.method,
      visitor_type: payload.visitorType,
      user_id: payload.userId,
      user_email: payload.userEmail,
      ip_address: payload.ipAddress,
      country_code: payload.countryCode,
      country_name: payload.countryName,
      user_agent: payload.userAgent,
      referer: payload.referer,
    });
  } catch {
    // Logging must never break routing.
  }
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isSupabaseConfigured() || isPrefetchRequest(request)) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  const needsAuth = isPrivatePath(pathname);
  const isLoginPath = pathname === "/login";
  let response = NextResponse.next({ request });

  let user: { id?: string; email?: string } | null = null;
  let supabase: ReturnType<typeof createServerClient> | null = null;

  try {
    supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });

    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    user = authUser;
  } catch {
    if (needsAuth) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
  }

  if (!shouldSkipAccessLog(user?.email)) {
    const countryCode = readCountryCode(request);

    event.waitUntil(
      logAccess({
        path: `${pathname}${search}`,
        method: request.method,
        visitorType: user ? "authenticated" : "anon",
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
        ipAddress: readClientIp(request),
        countryCode,
        countryName: readCountryName(countryCode),
        userAgent: request.headers.get("user-agent"),
        referer: request.headers.get("referer"),
      }),
    );
  }

  if (needsAuth && !user) {
    const nextPath = `${pathname}${search}`;
    const loginUrl = new URL("/login", request.url);

    if (isSafeNextPath(nextPath)) {
      loginUrl.searchParams.set("next", nextPath);
    }

    const redirect = NextResponse.redirect(loginUrl);
    redirect.headers.set("Cache-Control", "no-store, max-age=0");
    return redirect;
  }

  if (isSecurityPath(pathname) && user && supabase) {
    try {
      const { data: ownerRow, error: ownerError } = await supabase
        .from("app_owners")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (ownerError || !ownerRow) {
        const redirect = NextResponse.redirect(new URL("/dashboard", request.url));
        redirect.headers.set("Cache-Control", "no-store, max-age=0");
        return redirect;
      }
    } catch {
      const redirect = NextResponse.redirect(new URL("/dashboard", request.url));
      redirect.headers.set("Cache-Control", "no-store, max-age=0");
      return redirect;
    }
  }

  if (isLoginPath && user) {
    const dashboardUrl = new URL("/dashboard", request.url);
    const redirect = NextResponse.redirect(dashboardUrl);
    redirect.headers.set("Cache-Control", "no-store, max-age=0");
    return redirect;
  }

  if (needsAuth) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
