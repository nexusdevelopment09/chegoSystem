-- Carts, coupons, orders and everything attached to an order.

create type order_status as enum (
  'awaiting_payment', 'paid', 'accepted', 'preparing', 'ready',
  'out_for_delivery', 'delivered', 'picked_up',
  'expired', 'rejected', 'cancelled', 'refunded', 'partially_refunded'
);
create type fulfillment_type as enum ('delivery', 'pickup');
create type payment_method as enum ('pix', 'card', 'cash');
create type discount_payer as enum ('platform', 'store');
create type coupon_type as enum ('fixed', 'percent', 'free_delivery');
create type missing_item_policy as enum ('call', 'substitute', 'remove');
create type message_side as enum ('customer', 'store', 'admin');

create table carts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references profiles (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  notes text,
  updated_at timestamptz not null default now()
);

create table cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  notes varchar(140),
  -- [{ "groupId": "...", "optionId": "...", "quantity": 1 }]
  selections jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index cart_items_cart_id_idx on cart_items (cart_id);

create table coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code)),
  description text not null default '',
  type coupon_type not null,
  value_cents integer check (value_cents > 0),
  percent numeric(5, 2) check (percent > 0 and percent <= 100),
  max_discount_cents integer check (max_discount_cents > 0),
  paid_by discount_payer not null,
  -- Set when the store itself created the coupon (always paid by the store).
  created_by_store_id uuid references stores (id) on delete cascade,
  -- Personal coupon (referral reward): only this customer can use it.
  owner_profile_id uuid references profiles (id) on delete cascade,
  starts_at timestamptz,
  expires_at timestamptz,
  max_uses integer check (max_uses > 0),
  uses_count integer not null default 0,
  max_uses_per_customer integer not null default 1 check (max_uses_per_customer > 0),
  min_order_cents integer not null default 0 check (min_order_cents >= 0),
  first_order_only boolean not null default false,
  -- Empty array = no restriction.
  store_ids uuid[] not null default '{}',
  category_ids uuid[] not null default '{}',
  city_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (
    (type = 'fixed' and value_cents is not null)
    or (type = 'percent' and percent is not null)
    or type = 'free_delivery'
  ),
  check (created_by_store_id is null or paid_by = 'store')
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  city_id uuid not null references cities (id),
  customer_id uuid not null references profiles (id),
  store_id uuid not null references stores (id),
  status order_status not null default 'awaiting_payment',
  fulfillment fulfillment_type not null,
  -- Copies taken at checkout, so later edits never change old orders.
  customer_name text not null,
  customer_phone text,
  address_snapshot jsonb,
  neighborhood_id uuid references neighborhoods (id),
  scheduled_for timestamptz,
  estimated_at timestamptz,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  discount_paid_by discount_payer,
  coupon_id uuid references coupons (id),
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0),
  service_fee_cents integer not null default 0 check (service_fee_cents >= 0),
  commission_rate numeric(5, 4) not null,
  commission_cents integer not null check (commission_cents >= 0),
  store_amount_cents integer not null,
  platform_amount_cents integer not null,
  total_cents integer not null check (total_cents >= 0),
  refunded_cents integer not null default 0 check (refunded_cents >= 0),
  payment_method payment_method not null,
  age_confirmed boolean not null default false,
  requires_age_check boolean not null default false,
  missing_item_policy missing_item_policy,
  notes text,
  -- 4 digits the courier types to mark the order as delivered.
  delivery_code char(4),
  courier_id uuid references profiles (id),
  payment_expires_at timestamptz,
  paid_at timestamptz,
  accepted_at timestamptz,
  ready_at timestamptz,
  dispatched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (store_amount_cents + platform_amount_cents = total_cents),
  check (discount_cents = 0 or discount_paid_by is not null)
);

create index orders_store_status_idx on orders (store_id, status, created_at desc);
create index orders_customer_idx on orders (customer_id, created_at desc);
create index orders_courier_idx on orders (courier_id) where courier_id is not null;
create index orders_status_idx on orders (status, created_at);

create trigger orders_set_updated_at
  before update on orders
  for each row execute function set_updated_at();

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid references products (id) on delete set null,
  name text not null,
  -- Unit price already including the chosen options.
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity > 0),
  line_total_cents integer not null check (line_total_cents >= 0),
  notes varchar(140),
  requires_age_check boolean not null default false,
  -- Set when the store removes an out-of-stock item (partial refund).
  removed_at timestamptz,
  removed_reason text
);

create index order_items_order_id_idx on order_items (order_id);

create table order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items (id) on delete cascade,
  option_id uuid references options (id) on delete set null,
  group_name text not null,
  option_name text not null,
  price_mode option_price_mode not null,
  quantity integer not null default 1 check (quantity > 0),
  -- Listed price of the option on that product when the order was placed.
  price_cents integer not null default 0 check (price_cents >= 0),
  sort_order integer not null default 0
);

create index order_item_options_item_idx on order_item_options (order_item_id);

create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  status order_status not null,
  -- Null when the system did it (webhook, scheduled task).
  changed_by uuid references profiles (id),
  reason text,
  created_at timestamptz not null default now()
);

create index order_status_history_order_idx on order_status_history (order_id, created_at);

create table order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  sender_id uuid not null references profiles (id),
  sender_side message_side not null,
  body varchar(500) not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index order_messages_order_idx on order_messages (order_id, created_at);

-- Messages refused by the moderation (phone numbers, links, "zap"...).
create table blocked_message_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  sender_id uuid not null references profiles (id),
  body text not null,
  matched_rule text not null,
  created_at timestamptz not null default now()
);

create table coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupons (id),
  order_id uuid not null unique references orders (id) on delete cascade,
  customer_id uuid not null references profiles (id),
  discount_cents integer not null check (discount_cents >= 0),
  created_at timestamptz not null default now()
);

create index coupon_redemptions_coupon_customer_idx on coupon_redemptions (coupon_id, customer_id);

-- "Indique e ganhe": one row per invited customer.
create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references profiles (id) on delete cascade,
  referred_id uuid not null unique references profiles (id) on delete cascade,
  referred_coupon_id uuid references coupons (id),
  referrer_coupon_id uuid references coupons (id),
  first_order_id uuid references orders (id),
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  check (referrer_id <> referred_id)
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  customer_id uuid not null references profiles (id),
  rating smallint not null check (rating between 1 and 5),
  comment varchar(500),
  reply varchar(500),
  replied_at timestamptz,
  reported_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid references profiles (id),
  hidden_reason text,
  created_at timestamptz not null default now()
);

create index reviews_store_idx on reviews (store_id, created_at desc);

create table favorites (
  profile_id uuid not null references profiles (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, store_id)
);
