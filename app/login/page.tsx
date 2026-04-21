"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "@/app/components/app-shell";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/src/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const router = useRouter();

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();

    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      setErrorMessage("Přihlášení je momentálně nedostupné.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMessage(`Přihlášení se nezdařilo: ${error.message}`);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  };

  return (
    <AppShell contentClassName="flex items-center">
      <div className="mx-auto grid w-full max-w-6xl gap-6 xl:grid-cols-[1.08fr_minmax(0,30rem)]">
        <section className="relative overflow-hidden rounded-[2.5rem] border border-slate-900/8 bg-[linear-gradient(135deg,_#08111c_0%,_#10253a_42%,_#17466f_100%)] p-8 text-white shadow-[0_24px_80px_rgba(13,27,50,0.18)] md:p-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_22%,_rgba(255,164,93,0.2),_transparent_18%),radial-gradient(circle_at_left_bottom,_rgba(93,183,255,0.16),_transparent_28%)]" />
          <div className="relative">
            <p className="text-sm uppercase tracking-[0.35em] text-sky-100/70">Přístup</p>
            <h1 className="mt-4 max-w-3xl font-display text-6xl leading-[0.94] md:text-7xl">Přihlášení do logbooku</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-sky-50/80">
              Po přihlášení se otevře soukromá část se správou QSO databáze, importem ADIF a editací článků.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                ["QSO databáze", "Přehled spojení, filtry, vzdálenosti a největší DX."],
                ["ADIF import", "Rychlé nahrání a kontrola nových spojení."],
                ["Blog", "Možnost přidávat články i obrázky přímo z webu."],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[1.4rem] border border-white/10 bg-white/8 p-4 backdrop-blur">
                  <p className="text-sm text-sky-100/70">{label}</p>
                  <p className="mt-2 text-base font-medium text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[2.2rem] p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Přihlášení</p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-950">Vstup do správy</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">Zadej přihlašovací údaje a pokračuj do soukromé části webu.</p>

          {!isSupabaseConfigured() ? (
            <div className="mt-6 rounded-[1.25rem] border border-amber-300/30 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
              Přihlášení je momentálně nedostupné.
            </div>
          ) : null}

          <form onSubmit={handleLogin} className="mt-8 space-y-4">
            <div>
              <label className="mb-2 block text-sm text-slate-700">Email</label>
              <input
                type="email"
                placeholder="ok2mkj@example.cz"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-[1.25rem] border border-slate-900/10 bg-white/85 px-4 py-3 text-slate-950 outline-none transition focus:border-sky-500/40"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-700">Heslo</label>
              <input
                type="password"
                placeholder="********"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-[1.25rem] border border-slate-900/10 bg-white/85 px-4 py-3 text-slate-950 outline-none transition focus:border-sky-500/40"
                required
              />
            </div>

            {errorMessage ? (
              <div className="rounded-[1.25rem] border border-red-300/30 bg-red-50 px-4 py-3 text-sm text-red-800">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading || !isSupabaseConfigured()}
              className="w-full rounded-[1.25rem] bg-slate-950 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Přihlašuji..." : "Přihlásit se"}
            </button>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
