"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "@/app/components/app-shell";
import { maidenheadToLatLon } from "@/src/lib/qso-data";
import { getSupabaseBrowserClient } from "@/src/lib/supabase";
import { isValidLocator, readHomeLocator, saveHomeLocator } from "@/src/lib/station-settings";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [locator, setLocator] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const checkUser = async () => {
      const supabase = getSupabaseBrowserClient();

      if (!supabase) {
        router.replace("/login");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      setLocator(readHomeLocator());
      setLoading(false);
    };

    checkUser();
  }, [router]);

  if (loading) {
    return (
      <AppShell contentClassName="flex items-center justify-center">
        <p className="text-stone-600">Načítám nastavení...</p>
      </AppShell>
    );
  }

  const normalizedLocator = locator.trim().toUpperCase();
  const coordinates = isValidLocator(normalizedLocator)
    ? maidenheadToLatLon(normalizedLocator)
    : { lat: null, lon: null };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();

    if (!isValidLocator(normalizedLocator)) {
      setStatus("Domácí lokátor musí být ve formátu např. JO70VA nebo JO70.");
      return;
    }

    saveHomeLocator(normalizedLocator);
    setStatus(`Domácí lokátor ${normalizedLocator} byl uložen. Mapa teď umí počítat vzdálenost a největší DX.`);
  };

  return (
    <AppShell contentClassName="flex items-center">
      <div className="mx-auto grid w-full max-w-6xl gap-6 xl:grid-cols-[1.05fr_minmax(0,28rem)]">
        <section className="glass-panel rounded-[2rem] p-8 md:p-10">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Nastavení</p>
          <h1 className="mt-4 font-display text-5xl leading-tight text-slate-950">
            Nastavení stanice a domácího lokátoru
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-700">
            Domácí lokátor se použije v obou mapách pro výpočet vzdálenosti v kilometrech a pro hledání největšího DX.
          </p>

          <form onSubmit={handleSave} className="mt-8 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Domácí lokátor</label>
              <input
                value={locator}
                onChange={(event) => setLocator(event.target.value)}
                placeholder="např. JO70VA"
                className="w-full rounded-[1.3rem] border border-slate-900/10 bg-white/80 px-4 py-3 outline-none transition focus:border-sky-500/35"
              />
            </div>

            <button
              type="submit"
              className="rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Uložit lokátor
            </button>
          </form>

          {status ? (
            <p className="mt-5 rounded-[1.2rem] bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-700">
              {status}
            </p>
          ) : null}
        </section>

        <aside className="space-y-6">
          <div className="glass-panel rounded-[2rem] p-6">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Aktuální stav</p>
            <div className="mt-4 space-y-4 text-sm leading-6 text-slate-700">
              <div className="rounded-[1.2rem] bg-white px-4 py-4">
                Uložený lokátor: <strong>{normalizedLocator || "nenastaven"}</strong>
              </div>
              <div className="rounded-[1.2rem] bg-white px-4 py-4">
                Souřadnice:{" "}
                <strong>
                  {coordinates.lat !== null && coordinates.lon !== null
                    ? `${coordinates.lat.toFixed(3)}, ${coordinates.lon.toFixed(3)}`
                    : "čekám na validní lokátor"}
                </strong>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-900/8 bg-slate-950 p-6 text-white">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Použití v mapě</p>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Po uložení bude veřejná i soukromá mapa ukazovat vzdálenost ke každému bodu, největší DX a maximální dosah podle aktuálních filtrů.
            </p>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
