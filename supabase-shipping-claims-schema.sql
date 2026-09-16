-- KSC Shipping Claims & Resolution System
-- Run this once in the new Supabase project's SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.shipping_claim_counters (
  claim_year integer primary key,
  last_number integer not null default 0
);

create or replace function public.next_shipping_claim_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year integer := extract(year from now())::integer;
  next_number integer;
begin
  insert into public.shipping_claim_counters (claim_year, last_number)
  values (current_year, 1)
  on conflict (claim_year)
  do update set last_number = shipping_claim_counters.last_number + 1
  returning last_number into next_number;

  return 'SC-' || current_year::text || '-' || lpad(next_number::text, 4, '0');
end;
$$;

create table if not exists public.shipping_claims (
  id uuid primary key default gen_random_uuid(),
  claim_number text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_by text,
  order_number text not null,
  customer_name text not null,
  date_shipped date,
  date_delivered date,
  claim_types text[] not null default '{}',
  claim_status text not null default 'Open' check (claim_status in ('Open', 'In Progress', 'Pending', 'Resolved', 'Closed')),
  owner text,
  department text,
  fulfilled_by text,
  location text,
  carrier text,
  resolution text,
  resolution_notes text,
  resolution_amount numeric(12,2),
  root_cause text,
  external_claim_required boolean not null default false,
  external_claim_type text,
  external_claim_status text,
  external_claim_reference text,
  external_claim_amount numeric(12,2),
  external_claim_notes text,
  notes text
);

create table if not exists public.shipping_claim_items (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.shipping_claims(id) on delete cascade,
  sku text,
  product_id text,
  product_name text,
  quantity numeric(12,2) not null default 0,
  unit_value numeric(12,2),
  issue_type text,
  customer_received text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.shipping_claims(id) on delete cascade,
  file_name text not null,
  file_url text,
  storage_path text,
  file_type text,
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);

create table if not exists public.claim_history (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.shipping_claims(id) on delete cascade,
  user_id text,
  action text not null,
  old_value text,
  new_value text,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  department text,
  role text not null default 'Employee',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text,
  contact text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

insert into public.carriers (name) values
  ('UPS'), ('USPS'), ('FedEx'), ('T-Force'), ('Faire'), ('Other'), ('Unknown')
on conflict (name) do nothing;

-- Private evidence bucket. The server-side service key handles uploads and signed URLs.
insert into storage.buckets (id, name, public)
values ('claim-evidence', 'claim-evidence', false)
on conflict (id) do nothing;

create index if not exists shipping_claims_created_at_idx on public.shipping_claims(created_at desc);
create index if not exists shipping_claims_status_idx on public.shipping_claims(claim_status);
create index if not exists shipping_claims_order_idx on public.shipping_claims(order_number);
create index if not exists shipping_claims_customer_idx on public.shipping_claims(customer_name);
create index if not exists shipping_claim_items_claim_idx on public.shipping_claim_items(claim_id);
create index if not exists shipping_claim_items_sku_idx on public.shipping_claim_items(sku);
create index if not exists claim_history_claim_idx on public.claim_history(claim_id, created_at desc);

-- This internal app reads/writes through the server-side service key.
-- Never expose SUPABASE_SERVICE_KEY in frontend code.
