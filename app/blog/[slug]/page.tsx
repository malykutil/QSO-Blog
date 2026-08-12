import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/app/components/app-shell";
import { BlogImage } from "@/app/components/blog-image";
import { BlogViewCounter } from "@/app/components/blog-view-counter";
import { findFallbackBlogPost, formatBlogDate, normalizeBlogPost } from "@/src/lib/blog-data";
import { getSupabasePublicServerClient } from "@/src/lib/supabase";

export const dynamic = "force-dynamic";

async function getBlogPost(slug: string) {
  const supabase = getSupabasePublicServerClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("blog_posts")
      .select("id, created_at, created_by, title, slug, category, excerpt, content, cover_image_url, gallery_image_urls, view_count, is_published, published_at")
      .eq("slug", slug)
      .eq("is_published", true)
      .maybeSingle();

    if (!error && data) {
      return normalizeBlogPost(data);
    }
  }

  return findFallbackBlogPost(slug);
}

export async function generateMetadata(props: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const post = await getBlogPost(slug);

  if (!post) {
    return {
      title: "Článek nenalezen",
    };
  }

  return {
    title: `${post.title} | OK2MKJ`,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      images: post.coverImageUrl ? [{ url: post.coverImageUrl }] : [{ url: "/og-image.svg" }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
      images: post.coverImageUrl ? [post.coverImageUrl] : ["/og-image.svg"],
    },
  };
}

export default async function BlogPostPage(props: PageProps<"/blog/[slug]">) {
  const { slug } = await props.params;
  const post = await getBlogPost(slug);

  if (!post) {
    notFound();
  }

  const paragraphs = post.content.split(/\n\s*\n/).filter(Boolean);

  return (
    <AppShell>
      <div className="flex w-full flex-col gap-6">
        <section className="relative overflow-hidden rounded-[2.6rem] border border-slate-900/8 bg-[linear-gradient(135deg,_#0b1421_0%,_#14304b_45%,_#1f5f8f_100%)] px-6 py-8 text-white shadow-[0_24px_80px_rgba(13,27,50,0.18)] md:px-8 md:py-10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_24%,_rgba(255,164,93,0.22),_transparent_18%),radial-gradient(circle_at_left_bottom,_rgba(93,183,255,0.16),_transparent_28%)]" />
          <div className="relative max-w-4xl">
            <p className="text-xs uppercase tracking-[0.45em] text-sky-100/70">{post.category}</p>
            <h1 className="mt-5 font-display text-5xl leading-tight md:text-7xl">{post.title}</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-sky-50/80">{post.excerpt}</p>
            <p className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm uppercase tracking-[0.28em] text-sky-100/70">
              <span>{formatBlogDate(post.publishedAt)}</span>
              <span aria-hidden="true">·</span>
              <BlogViewCounter slug={post.slug} initialCount={post.viewCount} />
            </p>
          </div>
        </section>

        {post.coverImageUrl ? (
          <section className="overflow-hidden rounded-[2.2rem] border border-slate-900/8 bg-white">
            <div className="relative aspect-[16/8] overflow-hidden">
              <BlogImage src={post.coverImageUrl} alt={post.title} sizes="(max-width: 1200px) 100vw, 960px" priority />
            </div>
          </section>
        ) : null}

        <section>
          <article className="glass-panel mx-auto w-full max-w-[42rem] rounded-[2.2rem] p-6 md:p-8">
            <div className="space-y-6 text-base leading-8 text-slate-700">
              {paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>

            {post.galleryImageUrls.length ? (
              <div className="mt-8 space-y-4">
                <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Fotogalerie</p>
                <div className="grid gap-4 md:grid-cols-2">
                  {post.galleryImageUrls.map((imageUrl, index) => (
                    <div key={imageUrl} className="overflow-hidden rounded-[1.6rem] border border-slate-900/8 bg-white">
                      <div className="relative aspect-[4/3] overflow-hidden">
                        <BlogImage src={imageUrl} alt={`${post.title} ${index + 1}`} sizes="(max-width: 768px) 100vw, 50vw" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        </section>
      </div>
    </AppShell>
  );
}
