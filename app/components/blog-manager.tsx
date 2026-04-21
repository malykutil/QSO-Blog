"use client";

import Link from "next/link";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";

import { BlogImage } from "@/app/components/blog-image";
import { uploadBlogImageFile, validateBlogImageFile } from "@/src/lib/blog-media";
import {
  blogPostSelectFields,
  fallbackBlogPosts,
  formatBlogDate,
  normalizeBlogPost,
  parseImageUrls,
  slugifyBlogTitle,
  type BlogPost,
} from "@/src/lib/blog-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/src/lib/supabase";

type BlogManagerProps = {
  initialPosts: BlogPost[];
};

type BlogFormState = {
  title: string;
  slug: string;
  category: string;
  excerpt: string;
  content: string;
  coverImageUrl: string;
  galleryImageUrls: string;
  isPublished: boolean;
};

const initialFormState: BlogFormState = {
  title: "",
  slug: "",
  category: "Provoz",
  excerpt: "",
  content: "",
  coverImageUrl: "",
  galleryImageUrls: "",
  isPublished: true,
};

function BlogCard({ post, highlighted = false }: { post: BlogPost; highlighted?: boolean }) {
  return (
    <article
      className={`overflow-hidden rounded-[1.85rem] border ${
        highlighted
          ? "border-sky-900/10 bg-[linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(235,245,255,0.88))]"
          : "border-slate-900/8 bg-white/80"
      }`}
    >
      {post.coverImageUrl ? (
        <div className="relative aspect-[16/9] overflow-hidden border-b border-slate-900/8">
          <BlogImage src={post.coverImageUrl} alt={post.title} sizes="(max-width: 1024px) 100vw, 50vw" priority={highlighted} />
        </div>
      ) : null}
      <div className="px-6 py-6">
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
      </div>
    </article>
  );
}

function SelectedFiles({ files }: { files: File[] }) {
  if (!files.length) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2 rounded-[1.1rem] border border-slate-900/8 bg-slate-100/80 p-3 text-sm text-slate-700">
      {files.map((file) => (
        <p key={`${file.name}-${file.size}`}>{file.name}</p>
      ))}
    </div>
  );
}

function postToForm(post: BlogPost): BlogFormState {
  return {
    title: post.title,
    slug: post.slug,
    category: post.category,
    excerpt: post.excerpt,
    content: post.content,
    coverImageUrl: post.coverImageUrl || "",
    galleryImageUrls: post.galleryImageUrls.join("\n"),
    isPublished: post.isPublished,
  };
}

export function BlogManager({ initialPosts }: BlogManagerProps) {
  const [posts, setPosts] = useState<BlogPost[]>(initialPosts.length ? initialPosts : fallbackBlogPosts);
  const [myPosts, setMyPosts] = useState<BlogPost[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState<BlogFormState>(initialFormState);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [galleryImageFiles, setGalleryImageFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());

  useEffect(() => {
    startTransition(() => {
      setPosts(initialPosts.length ? initialPosts : fallbackBlogPosts);
    });
  }, [initialPosts]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    if (!supabase || !isSupabaseConfigured()) {
      return;
    }

    let mounted = true;

    const loadPublicPosts = async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select(blogPostSelectFields)
        .eq("is_published", true)
        .order("published_at", { ascending: false });

      if (!mounted || error) {
        return;
      }

      startTransition(() => {
        setPosts(data?.length ? data.map((row) => normalizeBlogPost(row)) : fallbackBlogPosts);
      });
    };

    const loadMyPosts = async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select(blogPostSelectFields)
        .order("created_at", { ascending: false });

      if (!mounted || error) {
        return;
      }

      startTransition(() => {
        setMyPosts((data ?? []).map((row) => normalizeBlogPost(row)));
      });
    };

    const syncSession = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) {
        return;
      }

      const loggedIn = Boolean(user);
      setIsLoggedIn(loggedIn);

      await loadPublicPosts();
      if (loggedIn) {
        await loadMyPosts();
      } else {
        setMyPosts([]);
      }
    };

    void syncSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const loggedIn = Boolean(session?.user);
      setIsLoggedIn(loggedIn);

      void loadPublicPosts();
      if (loggedIn) {
        void loadMyPosts();
      } else {
        setMyPosts([]);
      }
    });

    const intervalId = window.setInterval(() => {
      void loadPublicPosts();
      if (isLoggedIn) {
        void loadMyPosts();
      }
    }, 15000);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      window.clearInterval(intervalId);
    };
  }, [isLoggedIn]);

  const handleChange = <K extends keyof BlogFormState>(field: K, value: BlogFormState[K]) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const resetEditor = () => {
    setForm(initialFormState);
    setEditingPostId(null);
    setCoverImageFile(null);
    setGalleryImageFiles([]);
    setFileInputKey((current) => current + 1);
  };

  const handleCoverFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    if (!file) {
      setCoverImageFile(null);
      return;
    }

    const validationError = validateBlogImageFile(file);
    if (validationError) {
      setStatus(validationError);
      setCoverImageFile(null);
      return;
    }

    setStatus(null);
    setCoverImageFile(file);
  };

  const handleGalleryFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const validationError = files.map((file) => validateBlogImageFile(file)).find(Boolean);

    if (validationError) {
      setStatus(validationError);
      setGalleryImageFiles([]);
      return;
    }

    setStatus(null);
    setGalleryImageFiles(files);
  };

  const refreshPosts = async () => {
    const supabase = getSupabaseBrowserClient();

    if (!supabase) {
      return;
    }

    const { data: publicRows } = await supabase
      .from("blog_posts")
      .select(blogPostSelectFields)
      .eq("is_published", true)
      .order("published_at", { ascending: false });
    const { data: ownerRows } = await supabase
      .from("blog_posts")
      .select(blogPostSelectFields)
      .order("created_at", { ascending: false });

    startTransition(() => {
      setPosts(publicRows?.length ? publicRows.map((row) => normalizeBlogPost(row)) : fallbackBlogPosts);
      setMyPosts((ownerRows ?? []).map((row) => normalizeBlogPost(row)));
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const supabase = getSupabaseBrowserClient();

    if (!supabase || !isSupabaseConfigured()) {
      setStatus("Blog editor bude fungovat po doplnění platných údajů Supabase.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setStatus("Nejdřív se přihlas a potom můžeš spravovat články.");
      return;
    }

    const resolvedSlug = slugifyBlogTitle(form.slug.trim() || form.title.trim());
    const galleryImageUrls = parseImageUrls(form.galleryImageUrls);

    if (!form.title.trim() || !form.excerpt.trim() || !form.content.trim() || !resolvedSlug) {
      setStatus("Vyplň název, stručný perex a celý text článku.");
      return;
    }

    setSaving(true);
    setStatus(coverImageFile || galleryImageFiles.length ? "Nahrávám obrázky a ukládám článek..." : null);

    try {
      let resolvedCoverImageUrl = form.coverImageUrl.trim() || null;

      if (coverImageFile) {
        resolvedCoverImageUrl = await uploadBlogImageFile({
          supabase,
          userId: user.id,
          file: coverImageFile,
          folder: `blog/${resolvedSlug}/cover`,
        });
      }

      const uploadedGalleryUrls = galleryImageFiles.length
        ? await Promise.all(
            galleryImageFiles.map((file, index) =>
              uploadBlogImageFile({
                supabase,
                userId: user.id,
                file,
                folder: `blog/${resolvedSlug}/gallery-${index + 1}`,
              }),
            ),
          )
        : [];

      const payload = {
        title: form.title.trim(),
        slug: resolvedSlug,
        category: form.category.trim() || "Blog",
        excerpt: form.excerpt.trim(),
        content: form.content.trim(),
        cover_image_url: resolvedCoverImageUrl,
        gallery_image_urls: [...galleryImageUrls, ...uploadedGalleryUrls],
        is_published: form.isPublished,
        published_at: form.isPublished
          ? (editingPostId ? myPosts.find((post) => post.id === editingPostId)?.publishedAt : null) ?? new Date().toISOString()
          : null,
      };

      const result = editingPostId
        ? await supabase.from("blog_posts").update(payload).eq("id", editingPostId).select("id").single()
        : await supabase.from("blog_posts").insert({ created_by: user.id, ...payload }).select("id").single();

      if (result.error) {
        setStatus(
          result.error.code === "23505"
            ? "Článek s touto adresou už existuje. Změň název nebo vlastní slug."
            : `Uložení článku se nezdařilo: ${result.error.message}`,
        );
        setSaving(false);
        return;
      }

      await refreshPosts();
      resetEditor();
      setSaving(false);
      setStatus(editingPostId ? "Článek byl upraven." : form.isPublished ? "Článek je uložený a veřejně dostupný." : "Článek je uložený jako koncept.");
    } catch (error) {
      setSaving(false);
      setStatus(error instanceof Error ? `Nahrání obrázků se nezdařilo: ${error.message}` : "Nahrání obrázků se nezdařilo.");
    }
  };

  const handleEditPost = (post: BlogPost) => {
    setEditingPostId(post.id ?? null);
    setForm(postToForm(post));
    setCoverImageFile(null);
    setGalleryImageFiles([]);
    setStatus(`Upravuješ článek „${post.title}“.`);
  };

  const handleDeletePost = async (post: BlogPost) => {
    if (!post.id) {
      return;
    }

    const shouldDelete = window.confirm(`Opravdu chceš smazat článek „${post.title}“?`);
    if (!shouldDelete) {
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setStatus("Mazání článku je momentálně nedostupné.");
      return;
    }

    setDeletingPostId(post.id);
    setStatus(null);

    const { error } = await supabase.from("blog_posts").delete().eq("id", post.id);

    setDeletingPostId(null);

    if (error) {
      setStatus(`Mazání článku se nezdařilo: ${error.message}`);
      return;
    }

    if (editingPostId === post.id) {
      resetEditor();
    }

    await refreshPosts();
    setStatus("Článek byl smazán.");
  };

  const filteredPosts = useMemo(() => {
    if (!deferredSearchQuery) {
      return posts;
    }

    return posts.filter((post) =>
      [post.title, post.excerpt, post.content, post.category].some((value) => value.toLowerCase().includes(deferredSearchQuery)),
    );
  }, [deferredSearchQuery, posts]);

  const featuredPost = filteredPosts[0] ?? posts[0] ?? fallbackBlogPosts[0];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <section className="relative overflow-hidden rounded-[2.6rem] border border-slate-900/8 bg-[linear-gradient(135deg,_#0b1421_0%,_#14304b_45%,_#1f5f8f_100%)] px-6 py-8 text-white shadow-[0_24px_80px_rgba(13,27,50,0.18)] md:px-8 md:py-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_24%,_rgba(255,164,93,0.22),_transparent_18%),radial-gradient(circle_at_left_bottom,_rgba(93,183,255,0.16),_transparent_28%)]" />
        <div className="relative grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="max-w-4xl">
            <p className="text-xs uppercase tracking-[0.45em] text-sky-100/70">OK2MKJ blog</p>
            <h1 className="mt-5 max-w-3xl font-display text-6xl leading-[0.92] md:text-7xl">Stanice, provoz a zápisky z pásem.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-sky-50/80">
              Blog sbírá zkušenosti z provozu, stavby antén i drobné technické poznámky přímo ze stanice. Všechny články
              jsou psané z praxe a průběžně doplňované o nové výsledky.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/mapa"
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-50"
              >
                Otevřít mapu spojení
              </Link>
              <Link
                href="/"
                className="rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Zpět na úvod
              </Link>
            </div>

            <div className="mt-8 max-w-2xl">
              <label className="block text-xs uppercase tracking-[0.35em] text-sky-100/70">Hledání v blogu</label>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Hledat podle názvu, perexu, obsahu nebo kategorie"
                className="mt-3 w-full rounded-[1.4rem] border border-white/12 bg-white/8 px-4 py-3 text-base text-white outline-none placeholder:text-sky-100/45"
              />
            </div>
          </div>

          <article className="glass-panel overflow-hidden rounded-[2rem] p-6 md:p-7">
            {featuredPost.coverImageUrl ? (
              <div className="-mx-6 -mt-6 mb-6 relative aspect-[16/9] overflow-hidden border-b border-slate-900/8 md:-mx-7 md:-mt-7">
                <BlogImage src={featuredPost.coverImageUrl} alt={featuredPost.title} sizes="(max-width: 1024px) 100vw, 40vw" priority />
              </div>
            ) : null}
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Vybraný článek</p>
            <p className="mt-6 text-sm text-slate-500">
              {featuredPost.category} / {formatBlogDate(featuredPost.publishedAt)}
            </p>
            <h2 className="mt-3 font-display text-4xl leading-tight text-slate-950">{featuredPost.title}</h2>
            <p className="mt-4 text-base leading-8 text-slate-700">{featuredPost.excerpt}</p>
            <Link
              href={`/blog/${featuredPost.slug}`}
              className="mt-6 inline-flex rounded-full border border-slate-900/10 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
            >
              Otevřít článek
            </Link>
          </article>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="glass-panel rounded-[2.2rem] p-6 md:p-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Všechny články</p>
              <h3 className="mt-3 font-display text-5xl leading-none text-slate-950">Přehled článků</h3>
            </div>
            <span className="rounded-full border border-slate-900/10 px-4 py-2 text-xs uppercase tracking-[0.25em] text-slate-500">
              {filteredPosts.length} výsledků
            </span>
          </div>

          <div className="mt-8 grid gap-4">
            {filteredPosts.map((post, index) => (
              <BlogCard key={post.slug} post={post} highlighted={index === 0} />
            ))}
            {!filteredPosts.length ? (
              <div className="rounded-[1.85rem] border border-slate-900/8 bg-white/80 px-6 py-8">
                <p className="text-lg font-semibold text-slate-950">Žádný článek neodpovídá hledání.</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">Zkus jiný výraz nebo vymaž filtr nahoře v hlavičce blogu.</p>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="glass-panel rounded-[2.2rem] p-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Editor blogu</p>
                <h3 className="mt-3 font-display text-4xl leading-none text-slate-950">
                  {editingPostId ? "Upravit článek" : isLoggedIn ? "Přidat nový článek" : "Přihlášení"}
                </h3>
              </div>
              <span className="rounded-full border border-slate-900/10 px-4 py-2 text-xs uppercase tracking-[0.25em] text-slate-500">
                {editingPostId ? "editace" : isLoggedIn ? "aktivní" : "uzamčeno"}
              </span>
            </div>

            {isLoggedIn ? (
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Název článku</label>
                  <input
                    value={form.title}
                    onChange={(event) => handleChange("title", event.target.value)}
                    className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
                    placeholder="Např. První portable test nové antény"
                    required
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Kategorie</label>
                    <input
                      value={form.category}
                      onChange={(event) => handleChange("category", event.target.value)}
                      className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
                      placeholder="Provoz"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Slug adresy</label>
                    <input
                      value={form.slug}
                      onChange={(event) => handleChange("slug", event.target.value)}
                      className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
                      placeholder="Nepovinné, doplní se z názvu"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Hlavní obrázek článku</label>
                  <input
                    key={`cover-${fileInputKey}`}
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={handleCoverFileChange}
                    className="w-full rounded-[1.2rem] border border-dashed border-slate-900/20 bg-white px-4 py-3 text-sm outline-none file:mr-4 file:rounded-full file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">Podporované formáty: PNG a JPG, maximálně 5 MB.</p>
                  <SelectedFiles files={coverImageFile ? [coverImageFile] : []} />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Nebo vlož URL hlavního obrázku</label>
                  <input
                    value={form.coverImageUrl}
                    onChange={(event) => handleChange("coverImageUrl", event.target.value)}
                    className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
                    placeholder="https://..."
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Galerie obrázků</label>
                  <input
                    key={`gallery-${fileInputKey}`}
                    type="file"
                    accept="image/png,image/jpeg"
                    multiple
                    onChange={handleGalleryFileChange}
                    className="w-full rounded-[1.2rem] border border-dashed border-slate-900/20 bg-white px-4 py-3 text-sm outline-none file:mr-4 file:rounded-full file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">Můžeš nahrát víc PNG a JPG najednou.</p>
                  <SelectedFiles files={galleryImageFiles} />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Další obrázky přes URL</label>
                  <textarea
                    value={form.galleryImageUrls}
                    onChange={(event) => handleChange("galleryImageUrls", event.target.value)}
                    rows={4}
                    className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
                    placeholder={"Jedna URL na řádek\nhttps://...\nhttps://..."}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Stručný perex</label>
                  <textarea
                    value={form.excerpt}
                    onChange={(event) => handleChange("excerpt", event.target.value)}
                    rows={3}
                    className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
                    placeholder="Krátké shrnutí, které se zobrazí ve výpisu článků."
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Text článku</label>
                  <textarea
                    value={form.content}
                    onChange={(event) => handleChange("content", event.target.value)}
                    rows={12}
                    className="w-full rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 outline-none"
                    placeholder="Sem vlož celý text článku. Prázdný řádek vytvoří nový odstavec."
                    required
                  />
                </div>

                <label className="flex items-center gap-3 rounded-[1.2rem] border border-slate-900/10 bg-white px-4 py-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.isPublished}
                    onChange={(event) => handleChange("isPublished", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Zveřejnit článek hned po uložení
                </label>

                {status ? (
                  <div className="rounded-[1.2rem] border border-slate-900/10 bg-slate-100 px-4 py-3 text-sm text-slate-700">
                    {status}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 rounded-[1.2rem] bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? "Ukládám článek..." : editingPostId ? "Uložit změny" : "Uložit článek"}
                  </button>

                  {editingPostId ? (
                    <button
                      type="button"
                      onClick={resetEditor}
                      className="rounded-[1.2rem] border border-slate-900/10 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      Zrušit
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <div className="mt-6 space-y-4 text-sm leading-7 text-slate-700">
                <p>Výběr článků se průběžně rozšiřuje o nové zkušenosti z provozu, stavby antén i výsledky z pásma.</p>
                <Link
                  href="/mapa"
                  className="inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Otevřít mapu spojení
                </Link>
              </div>
            )}
          </div>

          {isLoggedIn ? (
            <div className="glass-panel rounded-[2.2rem] p-6">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Moje příspěvky</p>
              <div className="mt-5 space-y-3">
                {myPosts.length ? (
                  myPosts.map((post) => (
                    <div key={post.slug} className="rounded-[1.3rem] border border-slate-900/8 bg-white/80 px-4 py-4">
                      <p className="font-semibold text-slate-950">{post.title}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {post.category} / {post.isPublished ? "veřejné" : "koncept"}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleEditPost(post)}
                          className="rounded-full border border-slate-900/10 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-slate-100"
                        >
                          Upravit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeletePost(post)}
                          disabled={deletingPostId === post.id}
                          className="rounded-full border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {deletingPostId === post.id ? "Mažu..." : "Smazat"}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-[1.3rem] border border-slate-900/8 bg-white/80 px-4 py-4 text-sm text-slate-600">
                    Zatím tu není žádný uložený článek.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {isLoggedIn ? (
            <div className="rounded-[2.2rem] border border-slate-900/8 bg-slate-950 p-6 text-white">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Galerie článků</p>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Ke každému článku můžeš přidat hlavní obrázek i galerii ve formátu PNG nebo JPG.
              </p>
            </div>
          ) : null}
        </aside>
      </section>
    </div>
  );
}
