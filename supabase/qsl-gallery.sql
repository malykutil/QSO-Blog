create extension if not exists pgcrypto;

create table if not exists public.qsl_cards (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid not null default auth.uid(),
  qso_id uuid not null references public.qso_logs(id) on delete cascade,
  image_url text not null,
  storage_path text not null,
  caption text,
  is_public boolean not null default true,
  constraint qsl_cards_one_per_qso unique (created_by, qso_id)
);

create index if not exists qsl_cards_public_created_at_idx on public.qsl_cards (is_public, created_at desc);
create index if not exists qsl_cards_created_by_idx on public.qsl_cards (created_by);

alter table public.qsl_cards enable row level security;

drop policy if exists "public_read_qsl_cards" on public.qsl_cards;
create policy "public_read_qsl_cards"
on public.qsl_cards
for select
to anon, authenticated
using (is_public = true or created_by = auth.uid());

drop policy if exists "authenticated_insert_own_qsl_cards" on public.qsl_cards;
create policy "authenticated_insert_own_qsl_cards"
on public.qsl_cards
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "authenticated_update_own_qsl_cards" on public.qsl_cards;
create policy "authenticated_update_own_qsl_cards"
on public.qsl_cards
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "authenticated_delete_own_qsl_cards" on public.qsl_cards;
create policy "authenticated_delete_own_qsl_cards"
on public.qsl_cards
for delete
to authenticated
using (created_by = auth.uid());

insert into storage.buckets (id, name, public)
values ('qsl-cards', 'qsl-cards', true)
on conflict (id) do update set public = true;

drop policy if exists "public_read_qsl_card_files" on storage.objects;
create policy "public_read_qsl_card_files"
on storage.objects
for select
to public
using (bucket_id = 'qsl-cards');

drop policy if exists "authenticated_upload_own_qsl_card_files" on storage.objects;
create policy "authenticated_upload_own_qsl_card_files"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'qsl-cards' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "authenticated_update_own_qsl_card_files" on storage.objects;
create policy "authenticated_update_own_qsl_card_files"
on storage.objects
for update
to authenticated
using (bucket_id = 'qsl-cards' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'qsl-cards' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "authenticated_delete_own_qsl_card_files" on storage.objects;
create policy "authenticated_delete_own_qsl_card_files"
on storage.objects
for delete
to authenticated
using (bucket_id = 'qsl-cards' and (storage.foldername(name))[1] = auth.uid()::text);
