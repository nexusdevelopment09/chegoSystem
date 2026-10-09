-- Cities, neighborhoods, customer data and login support tables.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

create table cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  state char(2) not null,
  slug text not null unique,
  -- Prefix and counter of the short order codes: JG-0001, JG-0002...
  order_code_prefix text not null unique,
  next_order_number integer not null default 1,
  active boolean not null default true,
  maintenance_mode boolean not null default false,
  created_at timestamptz not null default now()
);

create table neighborhoods (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references cities (id) on delete cascade,
  name text not null,
  is_rural boolean not null default false,
  active boolean not null default true,
  unique (city_id, name)
);

alter table profiles
  add column birth_date date,
  add column referral_code text unique,
  add column blocked_reason text,
  add column city_id uuid references cities (id),
  add column promo_notifications boolean not null default true;

create table addresses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  label text,
  street text not null,
  number text not null default 'S/N',
  neighborhood_id uuid not null references neighborhoods (id),
  reference text,
  complement text,
  lat numeric(9, 6),
  lng numeric(9, 6),
  is_default boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index addresses_profile_id_idx on addresses (profile_id) where deleted_at is null;

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  icon text not null default '',
  color text not null default '#E8611A',
  sort_order integer not null default 0,
  active boolean not null default true
);

-- One-time codes for phone login. Only a hash of the code is stored.
create table login_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index login_codes_phone_idx on login_codes (phone, created_at desc);

-- Fixed-window counters for rate limiting (login, checkout, coupons...).
create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (key, window_start)
);
