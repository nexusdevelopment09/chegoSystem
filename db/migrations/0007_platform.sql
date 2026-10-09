-- Banners, notifications, support, legal documents, settings and audit.

create type message_channel as enum ('sms', 'whatsapp', 'email', 'push');
create type ticket_reason as enum (
  'delay', 'missing_item', 'wrong_item', 'damaged_item', 'billing', 'other'
);
create type ticket_status as enum ('open', 'in_progress', 'waiting_customer', 'resolved');
create type legal_document_type as enum ('terms', 'merchant_terms', 'privacy');

create table banners (
  id uuid primary key default gen_random_uuid(),
  -- Null = shown in every city.
  city_id uuid references cities (id) on delete cascade,
  title text not null,
  image_url text not null,
  link_url text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  sort_order integer not null default 0,
  active boolean not null default true
);

-- In-app notifications (the bell).
create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  link text,
  order_id uuid references orders (id) on delete cascade,
  promotional boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_profile_idx on notifications (profile_id, created_at desc);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Everything the system "sent". Locally SMS and WhatsApp stop here and are
-- shown on the /dev page.
create table outbound_messages (
  id uuid primary key default gen_random_uuid(),
  channel message_channel not null,
  recipient text not null,
  profile_id uuid references profiles (id) on delete set null,
  subject text,
  body text not null,
  created_at timestamptz not null default now()
);

create index outbound_messages_created_idx on outbound_messages (created_at desc);

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  customer_id uuid not null references profiles (id),
  store_id uuid not null references stores (id),
  reason ticket_reason not null,
  status ticket_status not null default 'open',
  photo_url text,
  -- The admin decides when to bring the store into the conversation.
  store_involved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index support_tickets_status_idx on support_tickets (status, created_at);

create trigger support_tickets_set_updated_at
  before update on support_tickets
  for each row execute function set_updated_at();

create table ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets (id) on delete cascade,
  sender_id uuid not null references profiles (id),
  sender_side message_side not null,
  body varchar(1000) not null,
  attachment_url text,
  created_at timestamptz not null default now()
);

create index ticket_messages_ticket_idx on ticket_messages (ticket_id, created_at);

-- Versioned terms. A new published version must be accepted again.
create table legal_documents (
  id uuid primary key default gen_random_uuid(),
  type legal_document_type not null,
  version integer not null check (version > 0),
  title text not null,
  content text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (type, version)
);

create table legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  document_id uuid not null references legal_documents (id),
  accepted_at timestamptz not null default now(),
  unique (profile_id, document_id)
);

-- Keys such as service_fee_cents, default_commission_rate, pix_expiration_minutes.
create table platform_settings (
  key text primary key,
  value jsonb not null,
  description text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id)
);

create table feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text not null default '',
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  store_id uuid references stores (id) on delete set null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on audit_logs (created_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
