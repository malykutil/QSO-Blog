"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ThemeToggle } from "@/app/components/theme-toggle";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/src/lib/supabase";

type NavigationItem = {
  href: string;
  label: string;
  hint: string;
  accent?: "sky" | "amber" | "emerald";
  tradingAdminOnly?: boolean;
};

const publicNavigation: NavigationItem[] = [
  { href: "/blog", label: "Blog", hint: "Zápisky ze stanice a provozu" },
  { href: "/mapa", label: "Mapa spojení", hint: "Přehled QSO na mapě" },
  { href: "/qsl-galerie", label: "QSL galerie", hint: "Přehled QSL karet z databáze" },
  { href: "/podminky", label: "Podmínky", hint: "HamSolar a PSK Reporter" },
  { href: "/o-mne", label: "O mně", hint: "Něco málo o stanici a webu" },
  { href: "/sdr", label: "WebSDR", hint: "Živý přijímač RTL-SDR V4", accent: "sky" },
  { href: "/solar", label: "OK2KZB", hint: "Solární přehled a ovládání relé", accent: "amber" },
];

const privateNavigation: NavigationItem[] = [
  { href: "/solar", label: "Solární přehled", hint: "Proudy, teploty a relé", accent: "amber" },
  { href: "/mapa", label: "Mapa", hint: "Veřejná i soukromá vrstva spojení", accent: "sky" },
  { href: "/dashboard#import", label: "Import", hint: "Nahrání a kontrola ADIF", accent: "amber" },
  { href: "/dashboard#databaze", label: "Databáze", hint: "Filtry, DX a přehled QSO", accent: "emerald" },
  { href: "/qsl", label: "QSL správa", hint: "Schválení a odesílání lístků", accent: "emerald" },
  {
    href: "/trading",
    label: "AI Trading",
    hint: "PAPER agenti, pozice a výkonnost",
    accent: "emerald",
    tradingAdminOnly: true,
  },
  { href: "/bezpecnost", label: "Bezpečnost", hint: "Přístupy a události na webu", accent: "amber" },
  { href: "/settings", label: "Nastavení", hint: "Domácí lokátor a další volby", accent: "sky" },
];

function isActive(pathname: string, href: string, hash: string) {
  const route = href.split("#")[0];
  const hrefHash = href.includes("#") ? href.slice(href.indexOf("#")) : "";

  if (hrefHash) {
    return (pathname === route || pathname.startsWith(`${route}/`)) && hash === hrefHash;
  }

  return pathname === route || pathname.startsWith(`${route}/`);
}

function getPrivateItemClasses(item: NavigationItem, active: boolean) {
  if (item.accent === "sky") {
    return active
      ? "border-sky-900/12 bg-sky-950 text-sky-50"
      : "border-sky-900/10 bg-sky-50/90 text-sky-950 hover:bg-white";
  }

  if (item.accent === "amber") {
    return active
      ? "border-amber-900/12 bg-amber-950 text-amber-50"
      : "border-amber-900/10 bg-amber-50/90 text-amber-950 hover:bg-white";
  }

  return active
    ? "border-emerald-900/12 bg-emerald-950 text-emerald-50"
    : "border-emerald-900/10 bg-emerald-50/90 text-emerald-950 hover:bg-white";
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isSolarControl, setIsSolarControl] = useState(false);
  const [isTradingAdmin, setIsTradingAdmin] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(isSupabaseConfigured());
  const [currentHash, setCurrentHash] = useState("");

  useEffect(() => {
    let mounted = true;

    const loadAuthStatus = async () => {
      if (!isSupabaseConfigured()) {
        if (mounted) {
          setIsLoggedIn(false);
          setIsCheckingAuth(false);
        }
        return;
      }

      try {
        const response = await fetch("/api/auth/status", {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await response.json().catch(() => null)) as {
          authenticated?: boolean;
          solarControl?: boolean;
          tradingAdmin?: boolean;
        } | null;

        if (!mounted) {
          return;
        }

        setIsLoggedIn(Boolean(payload?.authenticated));
        setIsSolarControl(Boolean(payload?.solarControl));
        setIsTradingAdmin(Boolean(payload?.tradingAdmin));
      } catch {
        if (!mounted) {
          return;
        }

        setIsLoggedIn(false);
        setIsSolarControl(false);
        setIsTradingAdmin(false);
      }

      if (!mounted) {
        return;
      }

      setIsCheckingAuth(false);
    };

    void loadAuthStatus();

    return () => {
      mounted = false;
    };
  }, [pathname]);

  useEffect(() => {
    const updateHash = () => {
      setCurrentHash(window.location.hash);
    };

    updateHash();
    window.addEventListener("hashchange", updateHash);

    return () => {
      window.removeEventListener("hashchange", updateHash);
    };
  }, [pathname]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      router.push("/blog");
      router.refresh();
      return;
    }

    await supabase.auth.signOut();
    setIsLoggedIn(false);
    router.push("/blog");
    router.refresh();
  };

  return (
    <aside className="relative border-b border-slate-900/8 bg-[linear-gradient(180deg,_rgba(255,255,255,0.88),_rgba(247,250,253,0.82))] backdrop-blur-xl lg:min-h-screen lg:border-b-0 lg:border-r">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(53,124,205,0.10),_transparent_32%)]" />
      <div className="relative flex h-full flex-col justify-between gap-10 px-5 py-6 lg:px-7 lg:py-8">
        <div className="space-y-8">
          <div className="space-y-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-slate-900/8 bg-white/85 px-3 py-2 text-[11px] uppercase tracking-[0.32em] text-slate-500 transition hover:bg-white"
            >
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              OK2MKJ
            </Link>

            <div>
              <p className="text-xs uppercase tracking-[0.42em] text-slate-500">Radioamatérská stanice</p>
              <Link href="/" className="mt-3 inline-block font-display text-5xl leading-none text-slate-950 transition hover:text-sky-800">
                OK2MKJ
              </Link>
            </div>
          </div>

          <nav className="space-y-3">
            {publicNavigation.map((item) => {
              const active = isActive(pathname, item.href, currentHash);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group block rounded-[1.5rem] border px-4 py-4 transition ${
                    active
                      ? "border-slate-900/12 bg-slate-950 text-white shadow-[0_20px_55px_rgba(15,23,42,0.16)]"
                      : "border-slate-900/8 bg-white/85 text-slate-900 hover:-translate-y-0.5 hover:bg-white"
                  }`}
                >
                  <p className="text-base font-semibold">{item.label}</p>
                  <p className={`mt-1 text-sm ${active ? "text-slate-300" : "text-slate-500"}`}>{item.hint}</p>
                </Link>
              );
            })}

            {isLoggedIn
              ? privateNavigation
                  .filter(
                    (item) =>
                      item.href !== "/solar" &&
                      (!isSolarControl || item.href === "/solar") &&
                      (!item.tradingAdminOnly || isTradingAdmin),
                  )
                  .map((item) => {
                  const active = isActive(pathname, item.href, currentHash);
                  const classes = getPrivateItemClasses(item, active);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`group block rounded-[1.5rem] border px-4 py-4 transition hover:-translate-y-0.5 ${classes}`}
                    >
                      <p className="text-base font-semibold">{item.label}</p>
                      <p className="mt-1 text-sm opacity-80">{item.hint}</p>
                    </Link>
                  );
                  })
              : null}
          </nav>
        </div>

        <div className="space-y-4">
          <ThemeToggle />

          {isCheckingAuth ? (
            <div className="h-[52px] animate-pulse rounded-[1.5rem] bg-slate-900/10" aria-label="Ověřuji přihlášení" />
          ) : isLoggedIn ? (
            <button
              onClick={handleLogout}
              className="block w-full rounded-[1.5rem] bg-slate-950 px-4 py-4 text-center text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Odhlásit se
            </button>
          ) : (
            <Link href="/login" className="block rounded-[1.5rem] bg-slate-950 px-4 py-4 text-center text-sm font-semibold text-white transition hover:bg-slate-800">
              Přihlášení
            </Link>
          )}

          {!isSupabaseConfigured() && !isCheckingAuth ? (
            <p className="rounded-[1.2rem] border border-amber-300/30 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950/80">
              Databázové připojení zatím není nastavené.
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
