-- Pagamento direto à loja e taxa do Chegô por pedido.
--
-- A partir daqui o cliente paga os produtos e a entrega direto à loja (Pix da loja,
-- dinheiro ou cartão na entrega). O app não recebe esse dinheiro. O Chegô cobra da
-- loja uma taxa fixa por pedido concluído, acumulada por expediente e paga depois
-- por Pix. Os pedidos antigos, pagos pelo app, continuam como estão
-- (payment_collection = 'app').

-- ------------------------------------------------------------ pedidos

create type payment_collection as enum ('app', 'store');

alter table orders
  add column payment_collection payment_collection not null default 'app',
  -- Pagamento em dinheiro: para quanto o cliente precisa de troco (null = sem troco).
  add column cash_change_for_cents integer check (cash_change_for_cents is null or cash_change_for_cents > 0);

-- Formas de pagamento que cada loja aceita e a chave Pix que o cliente vê depois que
-- a loja aceita o pedido.
alter table stores
  add column accepts_pix boolean not null default true,
  add column accepts_card boolean not null default true,
  add column accepts_cash boolean not null default true;

alter table store_private
  add column pix_key text check (pix_key is null or length(pix_key) between 3 and 140);

-- ------------------------------------------------------ taxas do Chegô

-- Cada linha é um lançamento da conta da loja com o Chegô, em centavos.
-- Positivo: a loja deve. Negativo: crédito da loja.
create type fee_entry_kind as enum (
  'order_fee',          -- taxa de um pedido concluído
  'order_fee_reversal', -- estorno da taxa (pedido reembolsado depois de concluído)
  'coupon_credit',      -- desconto de cupom pago pelo Chegô: o Chegô deve à loja
  'coupon_credit_reversal',
  'adjustment',         -- ajuste do admin, sempre com motivo
  'carryover'           -- saldo levado de um fechamento para o próximo
);

create type closing_status as enum ('awaiting_payment', 'paid', 'overdue', 'in_review');

-- Um fechamento por loja e por dia de expediente. Depois de fechado, só muda de
-- situação: os valores ficam como estavam para consulta e auditoria.
create table store_closings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id),
  business_date date not null,
  status closing_status not null,
  order_count integer not null check (order_count >= 0),
  fees_cents integer not null,
  credits_cents integer not null,
  adjustments_cents integer not null,
  -- O que a loja tem a pagar neste fechamento (nunca negativo: crédito vira carryover).
  total_due_cents integer not null check (total_due_cents >= 0),
  fee_unit_cents integer not null,
  due_date date not null,
  closed_at timestamptz not null,
  closed_by uuid references profiles (id),
  paid_at timestamptz,
  review_reason text,
  unique (store_id, business_date)
);

create index store_closings_status_idx on store_closings (status, due_date);

create table fee_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id),
  order_id uuid references orders (id),
  kind fee_entry_kind not null,
  amount_cents integer not null check (amount_cents <> 0),
  -- Dia de expediente a que o lançamento pertence (pode atravessar a meia-noite).
  business_date date not null,
  closing_id uuid references store_closings (id),
  reverses_id uuid references fee_entries (id),
  carried_from_closing_id uuid references store_closings (id),
  reason text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  check (kind <> 'adjustment' or (reason is not null and created_by is not null))
);

-- Um pedido gera no máximo um lançamento de cada tipo: reprocessar nunca duplica.
create unique index fee_entries_order_kind_idx on fee_entries (order_id, kind) where order_id is not null;
create index fee_entries_open_idx on fee_entries (store_id, business_date) where closing_id is null;
create index fee_entries_closing_idx on fee_entries (closing_id);

create type fee_charge_status as enum ('pending', 'paid', 'expired', 'cancelled', 'in_review');

-- Cobranças Pix de um fechamento. Só uma pode estar pendente por vez.
create table fee_charges (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references store_closings (id),
  store_id uuid not null references stores (id),
  provider text not null,
  provider_charge_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  status fee_charge_status not null default 'pending',
  pix_copy_paste text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (provider, provider_charge_id)
);

create unique index fee_charges_one_pending_idx on fee_charges (closing_id) where status = 'pending';

-- Pagamentos confirmados pelo provedor. A mesma transação nunca entra duas vezes.
create table fee_payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references fee_charges (id),
  provider text not null,
  provider_transaction_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  -- false quando o valor não bateu com a cobrança: fica para conferência do admin.
  applied boolean not null,
  received_at timestamptz not null,
  raw_payload jsonb,
  unique (provider, provider_transaction_id)
);

-- ------------------------------------------- entregador pago pela loja

create type courier_payer as enum ('platform', 'store');
create type courier_earning_status as enum ('pending', 'paid_by_store', 'confirmed', 'disputed');

alter table courier_earnings
  add column payer courier_payer not null default 'platform',
  add column store_id uuid references stores (id),
  add column status courier_earning_status not null default 'pending',
  add column store_marked_paid_at timestamptz,
  add column confirmed_at timestamptz,
  add column dispute_reason text,
  add constraint courier_earnings_store_payer_check check (payer <> 'store' or store_id is not null);

create index courier_earnings_store_idx on courier_earnings (store_id, status) where payer = 'store';

-- ------------------------------------------------- regras de acesso (RLS)

alter table store_closings enable row level security;
alter table fee_entries enable row level security;
alter table fee_charges enable row level security;
alter table fee_payments enable row level security;
grant select on store_closings, fee_entries, fee_charges, fee_payments to app_user;

-- Só o dono da loja (e o admin) vê a conta da loja com o Chegô. Fechar, cobrar e
-- dar baixa só acontece no servidor, pela conexão dona do banco.
create policy store_closings_read on store_closings for select to app_user
  using (is_admin() or is_store_owner(store_id));
create policy fee_entries_read on fee_entries for select to app_user
  using (is_admin() or is_store_owner(store_id));
create policy fee_charges_read on fee_charges for select to app_user
  using (is_admin() or is_store_owner(store_id));
create policy fee_payments_read on fee_payments for select to app_user
  using (is_admin() or exists (select 1 from fee_charges c where c.id = charge_id and is_store_owner(c.store_id)));

-- ------------------------------------------------------ configurações

insert into platform_settings (key, value, description) values
  ('order_fee_cents', '50', 'Taxa do Chegô por pedido concluído, em centavos'),
  ('business_day_cutoff_hour', '5', 'Hora em que um dia de expediente termina (pedidos antes disso contam para o dia anterior)'),
  ('fee_due_days', '3', 'Dias depois do fechamento para pagar as taxas'),
  ('fee_pix_expiration_hours', '24', 'Horas até o Pix das taxas expirar')
on conflict (key) do nothing;
