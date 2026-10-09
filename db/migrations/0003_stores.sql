-- Stores, their team, opening hours, delivery areas and monthly subscription.

create type store_status as enum ('pending', 'active', 'paused', 'suspended');
create type store_member_role as enum ('owner', 'attendant', 'courier');
create type store_manual_state as enum ('auto', 'open', 'closed');
create type pizza_pricing_rule as enum ('highest', 'average');
create type invoice_status as enum ('open', 'paid', 'overdue', 'cancelled');

create table subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Everything here is public: it is what customers see on the store page.
create table stores (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities (id),
  category_id uuid not null references categories (id),
  owner_id uuid not null references profiles (id),
  name text not null,
  slug text not null unique,
  description text not null default '',
  street text not null default '',
  number text not null default 'S/N',
  neighborhood_id uuid references neighborhoods (id),
  reference text,
  lat numeric(9, 6),
  lng numeric(9, 6),
  logo_url text,
  cover_url text,
  status store_status not null default 'pending',
  -- "Open/close now" button; 'auto' follows store_hours.
  manual_state store_manual_state not null default 'auto',
  paused_until timestamptz,
  pause_message text,
  -- "Movimento alto": extra minutes shown to customers (0, 15, 30 or 45).
  busy_extra_minutes integer not null default 0 check (busy_extra_minutes in (0, 15, 30, 45)),
  prep_time_minutes integer not null default 30 check (prep_time_minutes >= 0),
  min_order_cents integer not null default 0 check (min_order_cents >= 0),
  offers_delivery boolean not null default true,
  offers_pickup boolean not null default true,
  delivery_radius_km numeric(5, 2),
  accepts_scheduled boolean not null default false,
  schedule_min_lead_minutes integer not null default 60,
  schedule_max_days integer not null default 7,
  -- Lunch-box rule: same-day orders until this time, delivered in the window.
  same_day_cutoff time,
  delivery_window_start time,
  delivery_window_end time,
  pizza_pricing pizza_pricing_rule not null default 'highest',
  featured_until timestamptz,
  auto_print boolean not null default false,
  printer_width_mm integer not null default 80 check (printer_width_mm in (58, 80)),
  rating_avg numeric(3, 2),
  rating_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stores_city_category_idx on stores (city_id, category_id) where status in ('active', 'paused');
create index stores_name_trgm_idx on stores using gin (name gin_trgm_ops);

create trigger stores_set_updated_at
  before update on stores
  for each row execute function set_updated_at();

-- What other stores and customers must never see: only the owner and the admin.
create table store_private (
  store_id uuid primary key references stores (id) on delete cascade,
  internal_phone text,
  document_type text check (document_type in ('cpf', 'cnpj')),
  document_number text,
  commission_rate numeric(5, 4) not null default 0.10 check (commission_rate >= 0 and commission_rate <= 1),
  payment_recipient_id text,
  cash_enabled boolean not null default false,
  status_reason text,
  approved_at timestamptz,
  approved_by uuid references profiles (id),
  updated_at timestamptz not null default now()
);

create trigger store_private_set_updated_at
  before update on store_private
  for each row execute function set_updated_at();

create table store_members (
  store_id uuid not null references stores (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  role store_member_role not null,
  created_at timestamptz not null default now(),
  primary key (store_id, profile_id)
);

create index store_members_profile_id_idx on store_members (profile_id);

-- Several rows per weekday allow two shifts. When closes_at <= opens_at the
-- shift crosses midnight (18:00 -> 00:00, 09:00 -> 02:00).
create table store_hours (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  opens_at time not null,
  closes_at time not null,
  pickup_only boolean not null default false
);

create index store_hours_store_id_idx on store_hours (store_id);

-- Holidays and special closures.
create table store_closures (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (ends_at > starts_at)
);

create index store_closures_store_id_idx on store_closures (store_id, ends_at);

create table store_delivery_areas (
  store_id uuid not null references stores (id) on delete cascade,
  neighborhood_id uuid not null references neighborhoods (id) on delete cascade,
  delivery_fee_cents integer not null check (delivery_fee_cents >= 0),
  min_minutes integer not null default 20,
  max_minutes integer not null default 40,
  primary key (store_id, neighborhood_id)
);

create table store_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references stores (id) on delete cascade,
  plan_id uuid not null references subscription_plans (id),
  -- Founding stores: no invoice is charged until this date.
  free_until date,
  active boolean not null default true,
  started_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  subscription_id uuid not null references store_subscriptions (id),
  period_start date not null,
  period_end date not null,
  amount_cents integer not null check (amount_cents >= 0),
  status invoice_status not null default 'open',
  due_date date not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (store_id, period_start)
);

create index invoices_status_idx on invoices (status, due_date);
