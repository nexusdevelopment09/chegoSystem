-- Payments, refunds, webhook idempotency and the financial ledger.

create type payment_status as enum (
  'pending', 'approved', 'declined', 'expired', 'refunded', 'partially_refunded'
);
create type ledger_account as enum ('store', 'platform');
create type ledger_direction as enum ('credit', 'debit');

-- A payment belongs to an order or to a subscription invoice.
create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders (id) on delete cascade,
  invoice_id uuid references invoices (id) on delete cascade,
  provider text not null,
  provider_payment_id text not null,
  method payment_method not null,
  status payment_status not null default 'pending',
  amount_cents integer not null check (amount_cents > 0),
  pix_copy_paste text,
  expires_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id),
  check ((order_id is null) <> (invoice_id is null))
);

create index payments_order_idx on payments (order_id);
create index payments_status_idx on payments (status, expires_at);

create trigger payments_set_updated_at
  before update on payments
  for each row execute function set_updated_at();

create table refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  payment_id uuid not null references payments (id),
  amount_cents integer not null check (amount_cents > 0),
  -- How the refund is taken back from each side.
  store_share_cents integer not null check (store_share_cents >= 0),
  platform_share_cents integer not null check (platform_share_cents >= 0),
  reason text not null,
  -- Null when the system refunded (auto-reject, removed item).
  requested_by uuid references profiles (id),
  provider_refund_id text,
  created_at timestamptz not null default now(),
  check (store_share_cents + platform_share_cents = amount_cents)
);

create index refunds_order_idx on refunds (order_id);

-- The unique key is what makes a repeated webhook harmless.
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

-- Every money movement, one line per side. Never updated or deleted.
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account ledger_account not null,
  -- Required when account = 'store'.
  store_id uuid references stores (id),
  direction ledger_direction not null,
  amount_cents integer not null check (amount_cents > 0),
  reason text not null,
  order_id uuid references orders (id),
  refund_id uuid references refunds (id),
  invoice_id uuid references invoices (id),
  created_at timestamptz not null default now(),
  check (account <> 'store' or store_id is not null)
);

create index ledger_entries_store_idx on ledger_entries (store_id, created_at desc);
create index ledger_entries_order_idx on ledger_entries (order_id);
