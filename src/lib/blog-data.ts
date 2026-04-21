import { featuredPosts } from "@/src/lib/site-data";

export type BlogPost = {
  id?: string;
  createdAt?: string | null;
  createdBy?: string | null;
  title: string;
  slug: string;
  category: string;
  excerpt: string;
  content: string;
  coverImageUrl?: string | null;
  galleryImageUrls: string[];
  isPublished: boolean;
  publishedAt?: string | null;
};

type BlogPostRow = {
  id?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  title?: string | null;
  slug?: string | null;
  category?: string | null;
  excerpt?: string | null;
  content?: string | null;
  cover_image_url?: string | null;
  gallery_image_urls?: string[] | null;
  is_published?: boolean | null;
  published_at?: string | null;
};

export const blogPostSelectFields =
  "id, created_at, created_by, title, slug, category, excerpt, content, cover_image_url, gallery_image_urls, is_published, published_at";

export const fallbackBlogPosts: BlogPost[] = featuredPosts.map((post) => ({
  title: post.title,
  slug: post.slug,
  category: post.category,
  excerpt: post.excerpt,
  content: post.content,
  coverImageUrl: null,
  galleryImageUrls: [],
  publishedAt: post.publishedAt,
  isPublished: true,
}));

export function slugifyBlogTitle(title: string) {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function formatBlogDate(value?: string | null) {
  if (!value) {
    return "Bez data";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Bez data";
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Prague",
  }).format(date);
}

function normalizeGalleryImages(value?: string[] | null) {
  return (value ?? []).map((item) => item.trim()).filter(Boolean);
}

export function parseImageUrls(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeBlogPost(row: BlogPostRow): BlogPost {
  return {
    id: row.id ?? undefined,
    createdAt: row.created_at ?? null,
    createdBy: row.created_by ?? null,
    title: row.title?.trim() || "Bez názvu",
    slug: row.slug?.trim() || slugifyBlogTitle(row.title?.trim() || "clanek"),
    category: row.category?.trim() || "Blog",
    excerpt: row.excerpt?.trim() || "",
    content: row.content?.trim() || "",
    coverImageUrl: row.cover_image_url?.trim() || null,
    galleryImageUrls: normalizeGalleryImages(row.gallery_image_urls),
    isPublished: row.is_published ?? true,
    publishedAt: row.published_at ?? row.created_at ?? null,
  };
}

export function findFallbackBlogPost(slug: string) {
  return fallbackBlogPosts.find((post) => post.slug === slug) ?? null;
}
