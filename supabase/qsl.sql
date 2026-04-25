create extension if not exists pgcrypto;

create table if not exists public.qsl_contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid not null default auth.uid(),
  callsign text not null,
  email text not null,
  source text not null default 'manual',
  is_verified boolean not null default true,
  note text,
  last_used_at timestamptz,
  constraint qsl_contacts_callsign_check check (char_length(trim(callsign)) > 0),
  constraint qsl_contacts_email_check check (position('@' in email) > 1)
);

create unique index if not exists qsl_contacts_owner_callsign_email_idx
on public.qsl_contacts (created_by, upper(callsign), lower(email));

create index if not exists qsl_contacts_created_by_idx on public.qsl_contacts (created_by);
create index if not exists qsl_contacts_callsign_idx on public.qsl_contacts (upper(callsign));

create table if not exists public.qsl_queue (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid not null default auth.uid(),
  qso_id uuid references public.qso_logs(id) on delete set null,
  qso_fingerprint text not null,
  callsign text not null,
  band text,
  mode text,
  qso_date date,
  time_on time,
  rst_sent text,
  rst_rcvd text,
  locator text,
  contact_email text,
  status text not null default 'missing_email',
  approved_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  error_message text,
  constraint qsl_queue_status_check check (status in ('missing_email', 'ready', 'sent', 'failed')),
  constraint qsl_queue_callsign_check check (char_length(trim(callsign)) > 0)
);

create unique index if not exists qsl_queue_owner_fingerprint_idx
on public.qsl_queue (created_by, qso_fingerprint);

create index if not exists qsl_queue_created_by_idx on public.qsl_queue (created_by);
create index if not exists qsl_queue_qso_id_idx on public.qsl_queue (qso_id);
create index if not exists qsl_queue_status_idx on public.qsl_queue (status);
create index if not exists qsl_queue_callsign_idx on public.qsl_queue (upper(callsign));

alter table public.qsl_contacts enable row level security;
alter table public.qsl_queue enable row level security;

drop policy if exists "authenticated_read_own_qsl_contacts" on public.qsl_contacts;
create policy "authenticated_read_own_qsl_contacts"
on public.qsl_contacts
for select
to authenticated
using (created_by = auth.uid());

drop policy if exists "authenticated_insert_own_qsl_contacts" on public.qsl_contacts;
create policy "authenticated_insert_own_qsl_contacts"
on public.qsl_contacts
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "authenticated_update_own_qsl_contacts" on public.qsl_contacts;
create policy "authenticated_update_own_qsl_contacts"
on public.qsl_contacts
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "authenticated_delete_own_qsl_contacts" on public.qsl_contacts;
create policy "authenticated_delete_own_qsl_contacts"
on public.qsl_contacts
for delete
to authenticated
using (created_by = auth.uid());

drop policy if exists "authenticated_read_own_qsl_queue" on public.qsl_queue;
create policy "authenticated_read_own_qsl_queue"
on public.qsl_queue
for select
to authenticated
using (created_by = auth.uid());

drop policy if exists "authenticated_insert_own_qsl_queue" on public.qsl_queue;
create policy "authenticated_insert_own_qsl_queue"
on public.qsl_queue
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "authenticated_update_own_qsl_queue" on public.qsl_queue;
create policy "authenticated_update_own_qsl_queue"
on public.qsl_queue
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "authenticated_delete_own_qsl_queue" on public.qsl_queue;
create policy "authenticated_delete_own_qsl_queue"
on public.qsl_queue
for delete
to authenticated
using (created_by = auth.uid());
