"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { AppShell } from "@/app/components/app-shell";
import { blogPostSelectFields, fallbackBlogPosts, formatBlogDate, normalizeBlogPost, type BlogPost } from "@/src/lib/blog-data";
import { enrichQsoRecords, fallbackQsoRecords, getLargestDx, normalizeQsoRecord, qsoSelectFields, type QsoRecord } from "@/src/lib/qso-data";
import { getHomeLocatorServerSnapshot, readHomeLocator, subscribeHomeLocator } from "@/src/lib/station-settings";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/src/lib/supabase";

type SummaryStat = {
  label: string;
  value: string;
};

function getMostCommonMode(records: QsoRecord[]) {
  const counts = new Map<string, number>();

  for (const record of records) {
    if (!record.mode) {
      continue;
    }

    counts.set(record.mode, (counts.get(record.mode) ?? 0) + 1);
  }

  let bestMode = "--";
  let bestCount = -1;

  for (const [mode, count] of counts) {
    if (count > bestCount) {
      bestMode = mode;
      bestCount = count;
    }
  }

  return bestMode;
}

function getSummaryStats(records: QsoRecord[], homeLocator: string): SummaryStat[] {
  const uniqueBands = new Set(records.map((record) => record.band).filter(Boolean));
  const enrichedRecords = enrichQsoRecords(records, homeLocator);
  const largestDx = getLargestDx(enrichedRecords);

  return [
    { label: "Celkem QSO", value: String(records.length) },
    { label: "Aktivní pásma", value: String(uniqueBands.size) },
    { label: "Největší DX", value: largestDx?.distanceKm ? `${largestDx.distanceKm} km` : "--" },
    { label: "Nejčastější mód", value: getMostCommonMode(records) },
  ];
}

export default function Home() {
  const [records, setRecords] = useState<QsoRecord[]>(fallbackQsoRecords);
  const [posts, setPosts] = useState<BlogPost[]>(fallbackBlogPosts);
  const homeLocator = useSyncExternalStore(subscribeHomeLocator, readHomeLocator, getHomeLocatorServerSnapshot);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    if (!supabase || !isSupabaseConfigured()) {
      return;
    }

    let mounted = true;

    const loadHomepageData = async () => {
      const [qsoResponse, blogResponse] = await Promise.all([
        supabase.from("qso_logs").select(qsoSelectFields).order("date", { ascending: false }),
        supabase.from("blog_posts").select(blogPostSelectFields).eq("is_published", true).order("published_at", { ascending: false }),
      ]);

      if (!mounted) {
        return;
      }

      if (!qsoResponse.error && qsoResponse.data?.length) {
        setRecords(qsoResponse.data.map((row) => normalizeQsoRecord(row)));
      }

      if (!blogResponse.error && blogResponse.data?.length) {
        setPosts(blogResponse.data.map((row) => normalizeBlogPost(row)));
      }
    };

    void loadHomepageData();

    const intervalId = window.setInterval(() => {
      void loadHomepageData();
    }, 15000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const summaryStats = useMemo(() => getSummaryStats(records, homeLocator), [homeLocator, records]);
  const recentPosts = posts.slice(0, 3);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="relative overflow-hidden rounded-[2.6rem] border border-slate-900/8 bg-[linear-gradient(135deg,_#09111d_0%,_#112338_40%,_#17456e_100%)] px-6 py-8 text-white shadow-[0_24px_80px_rgba(13,27,50,0.18)] md:px-8 md:py-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,_rgba(255,166,77,0.25),_transparent_20%),radial-gradient(circle_at_left_bottom,_rgba(82,180,255,0.16),_transparent_28%)]" />
          <div className="relative grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="max-w-4xl">
              <p className="text-xs uppercase tracking-[0.45em] text-sky-100/70">Signál a zápisky</p>
              <h1 className="mt-5 max-w-3xl font-display text-6xl leading-[0.92] md:text-7xl">OK2MKJ</h1>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/mapa"
                  className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-50"
                >
                  Otevřít mapu spojení
                </Link>
                <Link
                  href="/blog"
                  className="rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Blog
                </Link>
              </div>

              <div className="mt-8 max-w-3xl space-y-4 text-base leading-8 text-sky-50/82">
                <p>
                  Na webu sdílím zápisky z provozu, zkušenosti z konstrukce i aktuální mapu spojení. Všechno na jednom
                  místě, přehledně a bez zbytečné omáčky.
                </p>
              </div>
            </div>

            <article className="glass-panel rounded-[2rem] p-6 md:p-7">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Stanice v číslech</p>
              <h2 className="mt-4 font-display text-4xl leading-tight text-slate-950">Přehled aktuální aktivity</h2>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {summaryStats.map((item) => (
                  <div key={item.label} className="rounded-[1.4rem] border border-slate-900/8 bg-white/80 p-4">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">{item.label}</p>
                    <p className={`mt-2 text-2xl font-semibold ${item.label === "Největší DX" ? "text-red-700" : "text-slate-950"}`}>
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/o-mne"
                  className="rounded-full border border-slate-900/10 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                >
                  Více o mně
                </Link>
              </div>
            </article>
          </div>
        </section>

        <section id="blog" className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
          <div className="glass-panel rounded-[2.2rem] p-6 md:p-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Poslední články</p>
                <h3 className="mt-3 font-display text-5xl leading-none text-slate-950">Blog</h3>
              </div>
              <span className="rounded-full border border-slate-900/10 px-4 py-2 text-xs uppercase tracking-[0.25em] text-slate-500">
                veřejné
              </span>
            </div>

            <div className="mt-8 grid gap-4">
              {recentPosts.map((post, index) => (
                <article
                  key={post.slug}
                  className={`rounded-[1.85rem] border px-6 py-6 transition hover:-translate-y-0.5 ${
                    index === 0
                      ? "border-sky-900/10 bg-[linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(235,245,255,0.88))]"
                      : "border-slate-900/8 bg-white/80"
                  }`}
                >
                  <p className="text-sm text-slate-500">
                    {post.category} / {formatBlogDate(post.publishedAt)}
                  </p>
                  <h4 className="mt-3 text-2xl font-semibold text-slate-950">{post.title}</h4>
                  <p className="mt-3 leading-7 text-slate-700">{post.excerpt}</p>
                  <Link
                    href={`/blog/${post.slug}`}
                    className="mt-5 inline-flex rounded-full border border-slate-900/10 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                  >
                    Číst článek
                  </Link>
                </article>
              ))}
            </div>
          </div>

          <aside className="space-y-6">
            <div className="overflow-hidden rounded-[2.2rem] border border-slate-900/8 bg-slate-950 text-white shadow-[0_24px_80px_rgba(13,27,50,0.16)]">
              <div className="border-b border-white/10 px-6 py-5">
                <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Aktivita</p>
                <h3 className="mt-3 font-display text-4xl">Poslední QSO</h3>
              </div>
              <div className="space-y-4 px-6 py-6">
                {records.slice(0, 3).map((record, index) => (
                  <div key={`${record.callsign}-${record.date}-${index}`} className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-lg font-semibold">{record.callsign}</p>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-300">
                        {record.band}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{record.mode} / {record.date} / {record.locator || "bez lokátoru"}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {record.note || `${record.operator || "Stanice"} / ${record.rstSent || "--"} / ${record.rstRcvd || "--"}`}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel rounded-[2.2rem] p-6">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Ze stanice</p>
              <h3 className="mt-3 font-display text-4xl leading-none text-slate-950">Blog, mapa a provoz na jednom místě.</h3>
              <p className="mt-4 leading-7 text-slate-700">
                Najdeš tu čerstvé články, přehled spojení i průběžně aktualizovanou mapu. Web je postavený jako živý deník
                stanice OK2MKJ.
              </p>
            </div>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
