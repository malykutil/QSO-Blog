create extension if not exists pgcrypto;

create table if not exists public.meshtastic_nodes (
  id uuid primary key default gen_random_uuid(),
  node_id text not null unique,
  short_name text,
  long_name text,
  hw_model text,
  role text,
  lat double precision,
  lon double precision,
  battery_level smallint check (battery_level between 0 and 100),
  voltage double precision,
  channel_utilization double precision,
  air_util_tx double precision,
  snr double precision,
  rssi double precision,
  channel text,
  last_payload_type text,
  metadata jsonb not null default '{}'::jsonb,
  last_seen timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.meshtastic_packets (
  id uuid primary key default gen_random_uuid(),
  node_id text references public.meshtastic_nodes(node_id) on delete set null,
  from_node text,
  to_node text,
  portnum text,
  payload_text text,
  payload_json jsonb,
  hop_limit integer,
  snr double precision,
  rssi double precision,
  channel text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists meshtastic_nodes_last_seen_idx on public.meshtastic_nodes (last_seen desc);
create index if not exists meshtastic_nodes_position_idx on public.meshtastic_nodes (lat, lon);
create index if not exists meshtastic_packets_created_at_idx on public.meshtastic_packets (created_at desc);
create index if not exists meshtastic_packets_node_id_idx on public.meshtastic_packets (node_id);
create index if not exists meshtastic_packets_portnum_idx on public.meshtastic_packets (portnum);

create or replace function public.set_meshtastic_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_meshtastic_nodes_updated_at on public.meshtastic_nodes;
create trigger trg_meshtastic_nodes_updated_at
before update on public.meshtastic_nodes
for each row
execute function public.set_meshtastic_updated_at();

create table if not exists public.app_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.meshtastic_nodes enable row level security;
alter table public.meshtastic_packets enable row level security;

drop policy if exists "meshtastic_nodes_public_read" on public.meshtastic_nodes;
create policy "meshtastic_nodes_public_read"
on public.meshtastic_nodes
for select
to anon, authenticated
using (true);

drop policy if exists "meshtastic_packets_public_read" on public.meshtastic_packets;
create policy "meshtastic_packets_public_read"
on public.meshtastic_packets
for select
to anon, authenticated
using (true);

drop policy if exists "meshtastic_nodes_owner_manage" on public.meshtastic_nodes;
create policy "meshtastic_nodes_owner_manage"
on public.meshtastic_nodes
for all
to authenticated
using (exists (select 1 from public.app_owners o where o.user_id = auth.uid()))
with check (exists (select 1 from public.app_owners o where o.user_id = auth.uid()));

drop policy if exists "meshtastic_packets_owner_manage" on public.meshtastic_packets;
create policy "meshtastic_packets_owner_manage"
on public.meshtastic_packets
for all
to authenticated
using (exists (select 1 from public.app_owners o where o.user_id = auth.uid()))
with check (exists (select 1 from public.app_owners o where o.user_id = auth.uid()));
