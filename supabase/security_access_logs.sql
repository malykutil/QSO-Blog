create extension if not exists pgcrypto;

create table if not exists public.app_owners (
  user_id uuid primary key,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.app_owners enable row level security;

drop policy if exists "authenticated_select_own_owner_row" on public.app_owners;
create policy "authenticated_select_own_owner_row"
on public.app_owners
for select
to authenticated
using (user_id = auth.uid());

create table if not exists public.security_access_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  visited_at timestamptz not null default timezone('utc', now()),
  path text not null,
  method text not null,
  visitor_type text not null check (visitor_type in ('anon', 'authenticated')),
  user_id uuid,
  user_email text,
  ip_address text,
  user_agent text,
  referer text
);

create index if not exists security_access_logs_visited_at_idx
  on public.security_access_logs (visited_at desc);

create index if not exists security_access_logs_path_idx
  on public.security_access_logs (path);

create index if not exists security_access_logs_method_idx
  on public.security_access_logs (method);

create index if not exists security_access_logs_visitor_type_idx
  on public.security_access_logs (visitor_type);

create index if not exists security_access_logs_user_id_idx
  on public.security_access_logs (user_id);

alter table public.security_access_logs enable row level security;

drop policy if exists "public_insert_access_logs" on public.security_access_logs;
create policy "public_insert_access_logs"
on public.security_access_logs
for insert
to anon, authenticated
with check (true);

drop policy if exists "authenticated_read_access_logs" on public.security_access_logs;
create policy "authenticated_read_access_logs"
on public.security_access_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.app_owners owners
    where owners.user_id = auth.uid()
  )
);

drop policy if exists "authenticated_update_access_logs" on public.security_access_logs;
create policy "authenticated_update_access_logs"
on public.security_access_logs
for update
to authenticated
using (
  exists (
    select 1
    from public.app_owners owners
    where owners.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.app_owners owners
    where owners.user_id = auth.uid()
  )
);
