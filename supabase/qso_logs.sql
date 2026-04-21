create extension if not exists pgcrypto;

create table if not exists public.qso_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  created_by uuid not null default auth.uid(),
  callsign text not null,
  band text not null,
  mode text not null,
  date date not null,
  time_on time,
  operator text,
  rst_sent text,
  rst_rcvd text,
  locator text,
  lat double precision,
  lon double precision,
  note text,
  is_public boolean not null default false,
  constraint qso_logs_callsign_check check (char_length(trim(callsign)) > 0),
  constraint qso_logs_band_check check (char_length(trim(band)) > 0),
  constraint qso_logs_mode_check check (char_length(trim(mode)) > 0)
);

create index if not exists qso_logs_created_by_idx on public.qso_logs (created_by);
create index if not exists qso_logs_date_idx on public.qso_logs (date desc);
create index if not exists qso_logs_band_idx on public.qso_logs (band);
create index if not exists qso_logs_mode_idx on public.qso_logs (mode);
create index if not exists qso_logs_public_idx on public.qso_logs (is_public, date desc);
create unique index if not exists qso_logs_owner_unique_qso_idx
on public.qso_logs (
  created_by,
  upper(callsign),
  lower(band),
  upper(mode),
  date,
  coalesce(time_on, '00:00:00'::time),
  upper(coalesce(operator, '')),
  upper(coalesce(locator, ''))
);

alter table public.qso_logs enable row level security;

drop policy if exists "public_read_approved_qso" on public.qso_logs;
drop policy if exists "public_read_all_qso" on public.qso_logs;
create policy "public_read_all_qso"
on public.qso_logs
for select
to anon, authenticated
using (true);

drop policy if exists "authenticated_read_own_qso" on public.qso_logs;
create policy "authenticated_read_own_qso"
on public.qso_logs
for select
to authenticated
using (created_by = auth.uid());

drop policy if exists "authenticated_insert_own_qso" on public.qso_logs;
create policy "authenticated_insert_own_qso"
on public.qso_logs
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "authenticated_update_own_qso" on public.qso_logs;
create policy "authenticated_update_own_qso"
on public.qso_logs
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "authenticated_delete_own_qso" on public.qso_logs;
create policy "authenticated_delete_own_qso"
on public.qso_logs
for delete
to authenticated
using (created_by = auth.uid());
