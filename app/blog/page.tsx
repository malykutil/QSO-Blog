import { AppShell } from "@/app/components/app-shell";
import { BlogManager } from "@/app/components/blog-manager";
import { blogPostSelectFields, fallbackBlogPosts, normalizeBlogPost } from "@/src/lib/blog-data";
import { getSupabasePublicServerClient } from "@/src/lib/supabase";

export const dynamic = "force-dynamic";

async function getInitialPosts() {
  const supabase = getSupabasePublicServerClient();

  if (!supabase) {
    return fallbackBlogPosts;
  }

  const { data, error } = await supabase
    .from("blog_posts")
    .select(blogPostSelectFields)
    .eq("is_published", true)
    .order("published_at", { ascending: false });

  if (error || !data?.length) {
    return fallbackBlogPosts;
  }

  return data.map((row) => normalizeBlogPost(row));
}

export default async function BlogPage() {
  const initialPosts = await getInitialPosts();

  return (
    <AppShell>
      <BlogManager initialPosts={initialPosts} />
    </AppShell>
  );
}
