create extension if not exists pgcrypto;

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid not null default auth.uid(),
  title text not null,
  slug text not null,
  category text not null default 'Blog',
  excerpt text not null,
  content text not null,
  cover_image_url text,
  gallery_image_urls text[] not null default '{}',
  is_published boolean not null default true,
  published_at timestamptz
);

alter table public.blog_posts
  add column if not exists cover_image_url text,
  add column if not exists gallery_image_urls text[] not null default '{}';

create unique index if not exists blog_posts_slug_key on public.blog_posts (slug);
create index if not exists blog_posts_published_at_idx on public.blog_posts (published_at desc);
create index if not exists blog_posts_created_by_idx on public.blog_posts (created_by);

alter table public.blog_posts enable row level security;

drop policy if exists "public_read_published_blog_posts" on public.blog_posts;
create policy "public_read_published_blog_posts"
on public.blog_posts
for select
to anon, authenticated
using (is_published = true or created_by = auth.uid());

drop policy if exists "authenticated_insert_own_blog_posts" on public.blog_posts;
create policy "authenticated_insert_own_blog_posts"
on public.blog_posts
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "authenticated_update_own_blog_posts" on public.blog_posts;
create policy "authenticated_update_own_blog_posts"
on public.blog_posts
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "authenticated_delete_own_blog_posts" on public.blog_posts;
create policy "authenticated_delete_own_blog_posts"
on public.blog_posts
for delete
to authenticated
using (created_by = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'blog-images',
  'blog-images',
  true,
  5242880,
  array['image/png', 'image/jpeg']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public_read_blog_images" on storage.objects;
create policy "public_read_blog_images"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'blog-images');

drop policy if exists "authenticated_insert_blog_images" on storage.objects;
create policy "authenticated_insert_blog_images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'blog-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authenticated_update_blog_images" on storage.objects;
create policy "authenticated_update_blog_images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'blog-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'blog-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authenticated_delete_blog_images" on storage.objects;
create policy "authenticated_delete_blog_images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'blog-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
