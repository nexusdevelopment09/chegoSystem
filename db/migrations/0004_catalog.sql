-- Menu: sections, products and reusable option groups with per-product prices.

create type product_type as enum ('standard', 'variant', 'service');
create type option_price_mode as enum ('sum', 'highest', 'average', 'free_up_to');

create table product_sections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0
);

create index product_sections_store_id_idx on product_sections (store_id, sort_order);

create table products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  section_id uuid references product_sections (id) on delete set null,
  name text not null,
  description text not null default '',
  price_cents integer not null check (price_cents >= 0),
  image_url text,
  available boolean not null default true,
  featured boolean not null default false,
  sort_order integer not null default 0,
  -- Made-to-order items (e.g. 24h for a hundred snacks) force a scheduled order.
  min_lead_minutes integer not null default 0 check (min_lead_minutes >= 0),
  max_per_order integer check (max_per_order > 0),
  track_stock boolean not null default false,
  stock_qty integer check (stock_qty >= 0),
  requires_age_check boolean not null default false,
  product_type product_type not null default 'standard',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_store_section_idx on products (store_id, section_id, sort_order) where deleted_at is null;
create index products_name_trgm_idx on products using gin (name gin_trgm_ops) where deleted_at is null;

create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();

-- No rows = always available. Rows restrict the product to those windows
-- (breakfast until 10:00, dish of the day only on Mondays...).
create table product_availability (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null default '00:00',
  ends_at time not null default '23:59:59'
);

create index product_availability_product_id_idx on product_availability (product_id);

-- A group ("Sabores", "Bordas") belongs to the store and can be linked to
-- many products.
create table option_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index option_groups_store_id_idx on option_groups (store_id);

create table options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references option_groups (id) on delete cascade,
  name text not null,
  description text not null default '',
  -- Sub-heading inside the group: "Tradicionais", "Especiais", "Doces".
  category_label text,
  -- Used when the product has no specific price for this option.
  default_price_cents integer not null default 0 check (default_price_cents >= 0),
  available boolean not null default true,
  sort_order integer not null default 0
);

create index options_group_id_idx on options (group_id, sort_order);

-- Links a group to a product, with the rules for that product.
create table product_option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  group_id uuid not null references option_groups (id) on delete cascade,
  required boolean not null default false,
  min_choices integer not null default 0 check (min_choices >= 0),
  max_choices integer not null default 1 check (max_choices >= 1),
  -- Same option more than once (2x coxinha).
  allow_repeat boolean not null default false,
  price_mode option_price_mode not null default 'sum',
  -- For 'free_up_to': how many choices cost nothing.
  free_quantity integer not null default 0 check (free_quantity >= 0),
  sort_order integer not null default 0,
  unique (product_id, group_id),
  check (max_choices >= min_choices)
);

-- Price of an option on a specific product (Calabresa on Média vs Grande).
create table product_option_prices (
  product_id uuid not null references products (id) on delete cascade,
  option_id uuid not null references options (id) on delete cascade,
  price_cents integer not null check (price_cents >= 0),
  primary key (product_id, option_id)
);
