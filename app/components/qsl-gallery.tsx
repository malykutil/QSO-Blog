"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { BlogImage } from "@/app/components/blog-image";
import {
  enrichQsoRecords,
  getQsoKey,
  normalizeQsoRecord,
  qsoSelectFields,
  type EnrichedQsoRecord,
  type QsoRecord,
} from "@/src/lib/qso-data";
import { uploadQslCardImage, validateQslCardImage } from "@/src/lib/qsl-gallery-media";
import { getHomeLocatorServerSnapshot, readHomeLocator, subscribeHomeLocator } from "@/src/lib/station-settings";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/src/lib/supabase";

const QslRouteMap = dynamic(
  () => import("@/app/components/qsl-route-map").then((module) => module.QslRouteMap),
  { ssr: false, loading: () => <div className="h-[24rem] animate-pulse rounded-[1.4rem] bg-slate-800" /> },
);

type QslGalleryCard = {
  id: string;
  createdAt: string;
  imageUrl: string;
  caption: string;
  isPublic: boolean;
  qso: QsoRecord | null;
};

type QslGalleryRow = {
  id?: string;
  created_at?: string;
  image_url?: string;
  caption?: string | null;
  is_public?: boolean;
  qso?: Record<string, unknown> | Record<string, unknown>[] | null;
};

const qslGallerySelectFields = `id,created_at,image_url,caption,is_public,qso:qso_logs(${qsoSelectFields})`;

function normalizeCard(row: QslGalleryRow): QslGalleryCard | null {
  const qsoRow = Array.isArray(row.qso) ? row.qso[0] : row.qso;
  if (!row.id || !row.image_url) {
    return null;
  }

  return {
    id: row.id,
    createdAt: row.created_at ?? "",
    imageUrl: row.image_url,
    caption: row.caption ?? "",
    isPublic: Boolean(row.is_public),
    qso: qsoRow ? normalizeQsoRecord(qsoRow) : null,
  };
}

function formatDate(value: string) {
  if (!value) {
    return "--";
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatQso(record: QsoRecord) {
  const time = record.timeOn ? `, ${record.timeOn.slice(0, 5)} UTC` : "";
  return `${formatDate(record.date)}${time} · ${record.band || "--"} / ${record.mode || "--"}`;
}

function QslImage({ src, alt, className = "object-cover" }: { src: string; alt: string; className?: string }) {
  return <BlogImage src={src} alt={alt} sizes="(max-width: 1024px) 100vw, 50vw" className={className} />;
}

export function QslGallery() {
  const [cards, setCards] = useState<QslGalleryCard[]>([]);
  const [loading, setLoading] = useState(() => isSupabaseConfigured());
  const [status, setStatus] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [callsignQuery, setCallsignQuery] = useState("");
  const [qsoMatches, setQsoMatches] = useState<QsoRecord[]>([]);
  const [selectedQso, setSelectedQso] = useState<QsoRecord | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [uploading, setUploading] = useState(false);
  const homeLocator = useSyncExternalStore(subscribeHomeLocator, readHomeLocator, getHomeLocatorServerSnapshot);

  const loadCards = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setLoading(false);
      setStatus("Databázové připojení není připravené.");
      return;
    }

    const { data, error } = await supabase
      .from("qsl_cards")
      .select(qslGallerySelectFields)
      .eq("is_public", true)
      .order("created_at", { ascending: false });

    if (error) {
      setStatus("Galerii se nepodařilo načíst. Nejprve spusť SQL soubor pro QSL galerii v Supabase.");
      setCards([]);
    } else {
      const nextCards = (data ?? []).map((row) => normalizeCard(row)).filter((card): card is QslGalleryCard => card !== null);
      setCards(nextCards);
      setSelectedCardId((current) => (current && nextCards.some((card) => card.id === current) ? current : nextCards[0]?.id ?? null));
      setStatus(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    let mounted = true;
    const initialize = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (mounted) {
        setUserId(user?.id ?? null);
      }
      await loadCards();
    };
    void initialize();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const query = callsignQuery.trim().toUpperCase();
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !userId || query.length < 2) {
      setQsoMatches([]);
      return;
    }

    let mounted = true;
    const timeout = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from("qso_logs")
        .select(qsoSelectFields)
        .eq("created_by", userId)
        .ilike("callsign", `%${query}%`)
        .order("date", { ascending: false })
        .limit(20);
      if (mounted) {
        setQsoMatches(error ? [] : (data ?? []).map((row) => normalizeQsoRecord(row)));
      }
    }, 250);

    return () => {
      mounted = false;
      window.clearTimeout(timeout);
    };
  }, [callsignQuery, userId]);

  const enrichedCards = useMemo(
    () =>
      cards.map((card) => ({
        ...card,
        qso: card.qso ? enrichQsoRecords([card.qso], homeLocator)[0] ?? null : null,
      })),
    [cards, homeLocator],
  );

  const filteredCards = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return enrichedCards;
    }
    return enrichedCards.filter((card) =>
      [card.qso?.callsign, card.qso?.band, card.qso?.mode, card.qso?.locator, card.caption].join(" ").toLowerCase().includes(query),
    );
  }, [enrichedCards, search]);

  const selectedCard = useMemo(
    () => filteredCards.find((card) => card.id === selectedCardId) ?? filteredCards[0] ?? null,
    [filteredCards, selectedCardId],
  );

  const selectedQsoWithDistance = useMemo<EnrichedQsoRecord | null>(
    () => (selectedQso ? enrichQsoRecords([selectedQso], homeLocator)[0] ?? null : null),
    [homeLocator, selectedQso],
  );

  const addCard = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !userId || !imageFile) {
      setStatus("Vyber obrázek QSL lístku.");
      return;
    }

    setUploading(true);
    let storagePath: string | null = null;
    try {
      const uploaded = await uploadQslCardImage({ supabase, userId, file: imageFile });
      storagePath = uploaded.path;
      const { error } = await supabase.from("qsl_cards").insert({
        created_by: userId,
        qso_id: selectedQso?.id ?? null,
        image_url: uploaded.imageUrl,
        storage_path: uploaded.path,
        caption: caption.trim() || null,
        is_public: isPublic,
      });

      if (error) {
        if (storagePath) {
          await supabase.storage.from("qsl-cards").remove([storagePath]);
        }
        throw new Error(error.code === "23505" ? "K tomuto QSO už je QSL lístek uložený." : error.message);
      }

      setStatus(isPublic ? "QSL lístek byl přidán do veřejné galerie." : "QSL lístek je uložený jako soukromý.");
      setSelectedQso(null);
      setCallsignQuery("");
      setImageFile(null);
      setCaption("");
      setIsAddOpen(false);
      await loadCards();
    } catch (error) {
      setStatus(error instanceof Error ? `QSL se nepodařilo uložit: ${error.message}` : "QSL se nepodařilo uložit.");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <p className="text-slate-600">Načítám QSL galerii…</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="relative overflow-hidden rounded-[2.6rem] border border-slate-900/8 bg-[linear-gradient(135deg,_#0b1220_0%,_#10253d_44%,_#184f7a_100%)] p-7 text-white shadow-[0_24px_80px_rgba(13,27,50,0.16)] md:p-9">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,_rgba(255,165,96,0.22),_transparent_18%),radial-gradient(circle_at_left_bottom,_rgba(93,183,255,0.16),_transparent_26%)]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.45em] text-sky-100/70">QSL galerie</p>
            <h1 className="mt-4 font-display text-5xl leading-[0.94] md:text-6xl">Přijaté QSL lístky</h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-sky-50/82">Archiv přijatých QSL lístků. Kartu můžeš propojit s QSO a mapou, nebo ji uložit samostatně jen jako obrázek.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {userId ? (
              <button type="button" onClick={() => setIsAddOpen((current) => !current)} className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-50">
                {isAddOpen ? "Zavřít přidání" : "Přidat QSL lístek"}
              </button>
            ) : (
              <Link href="/login?next=/qsl-galerie" className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-50">Přihlásit se pro přidání</Link>
            )}
            <Link href="/mapa" className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">Mapa spojení</Link>
          </div>
        </div>
      </section>

      {isAddOpen && userId ? (
        <section className="glass-panel rounded-[2.2rem] p-6 md:p-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(26rem,1.1fr)]">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Přidat přijatý lístek</p>
              <h2 className="mt-2 font-display text-4xl text-slate-950">Propojit s QSO je nepovinné</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Volačku vyplň jen pokud chceš k lístku přidat datum, parametry spojení a mapu. Bez ní uložíš samostatný QSL obrázek.</p>
              <label className="mt-6 block text-sm font-semibold text-slate-800" htmlFor="qsl-gallery-callsign">Volačka</label>
              <input id="qsl-gallery-callsign" value={callsignQuery} onChange={(event) => { setCallsignQuery(event.target.value.toUpperCase()); setSelectedQso(null); }} placeholder="Např. DL1ABC" className="mt-2 w-full rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3.5 text-lg font-semibold uppercase outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100" />
              <div className="mt-4 max-h-[20rem] space-y-3 overflow-y-auto pr-1">
                {callsignQuery.trim().length >= 2 && !qsoMatches.length ? <p className="rounded-[1rem] bg-slate-100 p-4 text-sm text-slate-600">Žádné odpovídající QSO ve tvé databázi.</p> : null}
                {qsoMatches.map((record, index) => {
                  const selected = selectedQso && getQsoKey(record, index) === getQsoKey(selectedQso, index);
                  return <button key={record.id ? String(record.id) : `${record.callsign}-${record.date}-${index}`} type="button" onClick={() => setSelectedQso(record)} className={`w-full rounded-[1.2rem] border p-4 text-left transition ${selected ? "border-red-400 bg-red-50" : "border-slate-900/10 bg-white hover:border-sky-300"}`}><p className="text-lg font-semibold text-slate-950">{record.callsign}</p><p className="mt-1 text-sm text-slate-600">{formatQso(record)}</p><p className="mt-2 text-sm text-slate-500">{record.locator || "Bez lokátoru"}</p></button>;
                })}
              </div>
              <label className="mt-6 block text-sm font-semibold text-slate-800" htmlFor="qsl-gallery-file">Obrázek QSL lístku</label>
              <input id="qsl-gallery-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0] ?? null; const error = file ? validateQslCardImage(file) : null; setImageFile(error ? null : file); if (error) setStatus(error); }} className="mt-2 block w-full rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 text-sm" />
              {imageFile ? <p className="mt-2 text-sm text-emerald-700">Připraveno: {imageFile.name}</p> : null}
              <label className="mt-5 block text-sm font-semibold text-slate-800" htmlFor="qsl-gallery-caption">Popisek (nepovinné)</label>
              <textarea id="qsl-gallery-caption" value={caption} onChange={(event) => setCaption(event.target.value)} rows={3} placeholder="Např. první QSL z Japonska" className="mt-2 w-full resize-y rounded-[1rem] border border-slate-900/10 bg-white px-4 py-3 outline-none" />
              <label className="mt-4 flex items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} /> Zobrazit tento lístek veřejně v galerii</label>
              <button type="button" onClick={() => void addCard()} disabled={uploading || !imageFile} className="mt-6 rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{uploading ? "Nahrávám lístek…" : "Uložit QSL lístek"}</button>
            </div>
            <div className="rounded-[1.6rem] border border-slate-900/10 bg-slate-50 p-4 md:p-5">
              {selectedQsoWithDistance ? <><p className="text-xs uppercase tracking-[0.3em] text-slate-500">Trasa vybraného QSO</p><h3 className="mt-2 font-display text-4xl text-slate-950">{selectedQsoWithDistance.callsign}</h3><p className="mt-2 text-sm text-slate-600">{formatQso(selectedQsoWithDistance)}</p><div className="mt-5"><QslRouteMap record={selectedQsoWithDistance} homeLocator={homeLocator} /></div></> : <div className="flex min-h-[28rem] items-center justify-center rounded-[1.3rem] border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">QSO není vybrané. Lístek můžeš i tak nahrát, jen nebude mít připojenou mapu a údaje o spojení.</div>}
            </div>
          </div>
        </section>
      ) : null}

      <section className="glass-panel rounded-[2rem] p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><p className="text-xs uppercase tracking-[0.35em] text-slate-500">Archiv</p><p className="mt-2 text-2xl font-semibold text-slate-950">{cards.length} {cards.length === 1 ? "lístek" : "lístků"}</p></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hledat volačku, pásmo, mód nebo lokátor" className="w-full rounded-full border border-slate-900/10 bg-white px-5 py-3 outline-none md:max-w-md" /></div>
        {status ? <p className="mt-5 rounded-[1rem] bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-700">{status}</p> : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="grid gap-4 sm:grid-cols-2">
          {filteredCards.map((card) => <button key={card.id} type="button" onClick={() => setSelectedCardId(card.id)} className="overflow-hidden rounded-[1.7rem] border border-slate-900/8 bg-white text-left shadow-[0_18px_48px_rgba(15,23,42,0.10)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(15,23,42,0.16)]"><div className="relative aspect-[3/2] bg-slate-100"><QslImage src={card.imageUrl} alt={`QSL lístek ${card.qso?.callsign ?? "bez propojeného QSO"}`} /></div><div className="p-5"><p className="font-display text-3xl text-slate-950">{card.qso?.callsign ?? "QSL lístek"}</p><p className="mt-2 text-sm text-slate-600">{card.qso ? formatQso(card.qso) : "Samostatně uložená karta"}</p><p className="mt-2 text-sm text-slate-500">{card.qso?.locator || card.caption || "Bez propojeného QSO"}</p></div></button>)}
          {!filteredCards.length ? <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white/70 p-8 text-center text-slate-600 sm:col-span-2">Zatím tu nejsou žádné veřejné QSL lístky. Po přihlášení můžeš přidat první.</div> : null}
        </div>
        <aside className="xl:sticky xl:top-6 self-start">
          {selectedCard ? <div className="overflow-hidden rounded-[2.2rem] bg-slate-950 text-white shadow-[0_24px_80px_rgba(13,27,50,0.16)]"><div className="p-6"><p className="text-xs uppercase tracking-[0.35em] text-slate-400">Detail QSL</p><h2 className="mt-3 font-display text-5xl">{selectedCard.qso?.callsign ?? "QSL lístek"}</h2><p className="mt-3 text-slate-300">{selectedCard.qso ? formatQso(selectedCard.qso) : "Samostatně uložená karta bez propojeného QSO"}</p></div><div className="relative aspect-[3/2] border-y border-white/10 bg-slate-900"><QslImage src={selectedCard.imageUrl} alt={`QSL lístek ${selectedCard.qso?.callsign ?? "bez propojeného QSO"}`} /></div><div className="space-y-5 p-6">{selectedCard.caption ? <p className="text-sm leading-6 text-slate-200">{selectedCard.caption}</p> : null}{selectedCard.qso ? <><div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-[1rem] bg-white/7 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-400">Lokátor</p><p className="mt-1 font-semibold">{selectedCard.qso.locator || "--"}</p></div><div className="rounded-[1rem] bg-white/7 p-3"><p className="text-xs uppercase tracking-[0.2em] text-slate-400">Vzdálenost</p><p className="mt-1 font-semibold">{selectedCard.qso.distanceKm !== null ? `${selectedCard.qso.distanceKm} km` : "--"}</p></div></div><div><p className="mb-3 text-xs uppercase tracking-[0.3em] text-slate-400">Trasa spojení</p><QslRouteMap record={selectedCard.qso} homeLocator={homeLocator} /></div></> : <div className="rounded-[1.2rem] bg-white/7 p-4 text-sm leading-6 text-slate-300">Tento lístek není propojený s QSO, proto k němu není mapa trasy.</div>}</div></div> : <div className="rounded-[2.2rem] bg-slate-950 p-7 text-white"><p className="text-xl">Vyber QSL lístek a otevře se jeho velký náhled.</p></div>}
        </aside>
      </section>
    </div>
  );
}
