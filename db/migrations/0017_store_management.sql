-- Gestão da loja: compra sem conta, equipe com permissões, auditoria protegida, estoque com
-- lotes e validade, ficha técnica, reposição, mesas e balcão. Só acrescenta: nenhum dado
-- existente muda de significado.

-- ------------------------------------------------------------ compra sem conta
-- Pedido de visitante: sem cliente cadastrado; nome, telefone e endereço ficam no pedido.
-- O acompanhamento é por um link secreto (guardado só como hash).
alter table orders alter column customer_id drop not null;
alter table orders add column guest_token_hash text unique;

-- Canal da venda: pelo app, ou registrada na própria loja (mesa ou balcão).
create type sale_channel as enum ('app', 'mesa', 'balcao');
alter table orders add column channel sale_channel not null default 'app';
alter table orders add constraint orders_customer_or_guest
  check (customer_id is not null or guest_token_hash is not null or channel <> 'app');
create index orders_store_channel_idx on orders (store_id, channel, paid_at desc);

-- Cupom usado por visitante: conta pelo telefone.
alter table coupon_redemptions alter column customer_id drop not null;
alter table coupon_redemptions add column customer_phone text;

-- ------------------------------------------------------------ equipe e permissões
-- permissions null = as permissões padrão do papel (src/lib/merchant/permissions.ts).
alter table store_members
  add column permissions text[],
  add column active boolean not null default true,
  add column deactivated_at timestamptz,
  add column invited_by uuid references profiles (id);

-- Convite de uso único, com prazo. Só o hash do código fica no banco.
create table store_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  token_hash text not null unique,
  full_name text not null check (length(full_name) between 2 and 80),
  phone text,
  role store_member_role not null check (role <> 'owner'),
  permissions text[],
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references profiles (id),
  revoked_at timestamptz,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);
create index store_invites_store_idx on store_invites (store_id, created_at desc);

-- ------------------------------------------------------------ auditoria protegida
alter table audit_logs
  add column actor_role text,
  add column module text,
  add column result text not null default 'ok' check (result in ('ok', 'negado', 'erro')),
  add column reason text,
  add column process text,
  add column request_id text;
create index audit_logs_store_idx on audit_logs (store_id, created_at desc);
create index audit_logs_actor_idx on audit_logs (actor_id, created_at desc);

-- Ninguém altera um evento de auditoria. Apagar só pela rotina de retenção (que se identifica).
create function audit_logs_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'audit_logs: eventos de auditoria não podem ser alterados';
  end if;
  if current_setting('chego.audit_retention', true) is distinct from 'on' then
    raise exception 'audit_logs: eventos só são apagados pela rotina de retenção';
  end if;
  return old;
end;
$$;
create trigger audit_logs_no_update before update or delete on audit_logs
  for each row execute function audit_logs_immutable();

-- ------------------------------------------------------------ estoque
create type stock_unit as enum ('un', 'kg', 'g', 'l', 'ml', 'pacote', 'caixa');
create type stock_item_status as enum ('ativo', 'inativo', 'indisponivel');
create type stock_movement_kind as enum ('compra', 'venda', 'producao', 'perda', 'vencido', 'ajuste', 'devolucao', 'transferencia');

-- Produto vendido ou insumo. Quando ligado a um produto do cardápio (product_id), o saldo
-- do item é o estoque desse produto e os dois andam juntos.
create table stock_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  category text check (category is null or length(category) <= 60),
  sku text check (sku is null or length(sku) <= 40),
  unit stock_unit not null default 'un',
  quantity numeric(14, 3) not null default 0,
  min_quantity numeric(14, 3) not null default 0 check (min_quantity >= 0),
  ideal_quantity numeric(14, 3) check (ideal_quantity is null or ideal_quantity >= 0),
  unit_cost_cents integer check (unit_cost_cents is null or unit_cost_cents >= 0),
  supplier text check (supplier is null or length(supplier) <= 120),
  lead_time_days integer check (lead_time_days is null or lead_time_days between 0 and 365),
  storage_location text check (storage_location is null or length(storage_location) <= 60),
  perishable boolean not null default false,
  status stock_item_status not null default 'ativo',
  product_id uuid unique references products (id) on delete set null,
  last_purchase_at timestamptz,
  last_movement_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index stock_items_sku_idx on stock_items (store_id, lower(sku)) where sku is not null;
create index stock_items_store_idx on stock_items (store_id, status);

create table stock_lots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  item_id uuid not null references stock_items (id) on delete cascade,
  received_quantity numeric(14, 3) not null check (received_quantity > 0),
  remaining_quantity numeric(14, 3) not null check (remaining_quantity >= 0),
  received_at date not null,
  manufactured_at date,
  expires_at date,
  supplier text,
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  discarded_at timestamptz,
  created_at timestamptz not null default now()
);
create index stock_lots_expiry_idx on stock_lots (store_id, expires_at) where remaining_quantity > 0 and discarded_at is null;

-- Histórico: nada muda o saldo sem uma movimentação. quantity tem sinal (+ entra, - sai).
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  item_id uuid not null references stock_items (id) on delete cascade,
  lot_id uuid references stock_lots (id) on delete set null,
  kind stock_movement_kind not null,
  quantity numeric(14, 3) not null check (quantity <> 0),
  balance_after numeric(14, 3) not null,
  reason text check (reason is null or length(reason) <= 300),
  order_id uuid references orders (id) on delete set null,
  bill_item_id uuid,
  created_by uuid references profiles (id),
  -- Processo automático que gerou a movimentação (ex.: "pedido", "fechamento de mesa").
  process text,
  created_at timestamptz not null default now(),
  check (kind not in ('perda', 'vencido', 'ajuste') or reason is not null)
);
create index stock_movements_item_idx on stock_movements (item_id, created_at desc);
create index stock_movements_store_idx on stock_movements (store_id, created_at desc);
-- Um pedido baixa (ou devolve, ou consome) cada item uma vez só, por mais que o evento se repita.
create unique index stock_movements_order_idx on stock_movements (item_id, order_id, kind) where order_id is not null;
create unique index stock_movements_bill_item_idx on stock_movements (item_id, bill_item_id, kind) where bill_item_id is not null;

-- Ficha técnica: quanto de cada insumo vai em uma unidade do produto (ou em uma opção dele,
-- como o sabor da pizza naquele tamanho).
create table recipe_lines (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  option_id uuid references options (id) on delete cascade,
  item_id uuid not null references stock_items (id) on delete cascade,
  quantity numeric(14, 4) not null check (quantity > 0)
);
create unique index recipe_lines_unique_idx on recipe_lines (product_id, coalesce(option_id, '00000000-0000-0000-0000-000000000000'::uuid), item_id);

create table store_stock_settings (
  store_id uuid primary key references stores (id) on delete cascade,
  expiry_warning_days integer[] not null default '{30,15,7,3}',
  -- Insumo pode ficar negativo quando o consumo estimado passa do saldo? (padrão: não)
  allow_negative boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Alertas abertos e resolvidos (um aberto por item, tipo e lote).
create type stock_alert_kind as enum ('baixo', 'vencendo', 'vencido', 'conferir');
create table stock_alerts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  item_id uuid not null references stock_items (id) on delete cascade,
  lot_id uuid references stock_lots (id) on delete cascade,
  kind stock_alert_kind not null,
  detail text,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index stock_alerts_open_idx on stock_alerts (item_id, kind, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)) where resolved_at is null;

-- Lista de compras: a sugestão vira lista, a pessoa revisa e aprova; nada é comprado sozinho.
create type purchase_list_status as enum ('rascunho', 'aprovada', 'recebida', 'cancelada');
create table purchase_lists (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  status purchase_list_status not null default 'rascunho',
  created_by uuid not null references profiles (id),
  approved_by uuid references profiles (id),
  approved_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now()
);
create table purchase_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references purchase_lists (id) on delete cascade,
  item_id uuid not null references stock_items (id) on delete cascade,
  suggested_quantity numeric(14, 3) not null,
  quantity numeric(14, 3) not null check (quantity >= 0),
  unit_cost_cents integer,
  reason text,
  unique (list_id, item_id)
);

-- ------------------------------------------------------------ mesas e balcão
create table store_tables (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  label text not null check (length(label) between 1 and 30),
  active boolean not null default true,
  sort_order integer not null default 0,
  unique (store_id, label)
);

create type bill_status as enum ('aberta', 'fechada', 'cancelada');
-- Conta de mesa (table_id) ou venda de balcão (sem mesa). Ao fechar, vira um pedido do canal
-- "mesa" ou "balcao" (order_id): é ele que entra nos relatórios e na taxa, uma vez só.
create table table_bills (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  table_id uuid references store_tables (id),
  label text not null,
  status bill_status not null default 'aberta',
  customer_name text,
  opened_by uuid not null references profiles (id),
  opened_at timestamptz not null default now(),
  closed_by uuid references profiles (id),
  closed_at timestamptz,
  cancel_reason text,
  order_id uuid unique references orders (id)
);
-- Uma conta aberta por mesa.
create unique index table_bills_open_idx on table_bills (table_id) where status = 'aberta' and table_id is not null;
create index table_bills_store_idx on table_bills (store_id, status, opened_at desc);

create table table_bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references table_bills (id) on delete cascade,
  product_id uuid references products (id) on delete set null,
  name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity between 1 and 999),
  notes text,
  added_by uuid not null references profiles (id),
  added_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references profiles (id),
  cancel_reason text
);
create index table_bill_items_bill_idx on table_bill_items (bill_id);
alter table stock_movements add constraint stock_movements_bill_item_fk foreign key (bill_item_id) references table_bill_items (id) on delete set null;

create table table_bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references table_bills (id) on delete cascade,
  method payment_method not null,
  amount_cents integer not null check (amount_cents > 0),
  received_by uuid not null references profiles (id),
  received_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references profiles (id),
  cancel_reason text
);
create index table_bill_payments_bill_idx on table_bill_payments (bill_id);

-- ------------------------------------------------------------ acesso
-- Leitura pela equipe da loja (dono e atendente); gravação só pelo servidor, depois de
-- conferir a loja e a permissão de quem pediu.
alter table store_invites enable row level security;
alter table stock_items enable row level security;
alter table stock_lots enable row level security;
alter table stock_movements enable row level security;
alter table recipe_lines enable row level security;
alter table store_stock_settings enable row level security;
alter table stock_alerts enable row level security;
alter table purchase_lists enable row level security;
alter table purchase_list_items enable row level security;
alter table store_tables enable row level security;
alter table table_bills enable row level security;
alter table table_bill_items enable row level security;
alter table table_bill_payments enable row level security;

grant select on store_invites, stock_items, stock_lots, stock_movements, recipe_lines, store_stock_settings, stock_alerts,
  purchase_lists, purchase_list_items, store_tables, table_bills, table_bill_items, table_bill_payments to app_user;

create policy store_invites_read on store_invites for select to app_user using (is_store_owner(store_id) or is_admin());
create policy stock_items_read on stock_items for select to app_user using (is_store_staff(store_id) or is_admin());
create policy stock_lots_read on stock_lots for select to app_user using (is_store_staff(store_id) or is_admin());
create policy stock_movements_read on stock_movements for select to app_user using (is_store_staff(store_id) or is_admin());
create policy recipe_lines_read on recipe_lines for select to app_user using (is_store_staff(store_id) or is_admin());
create policy store_stock_settings_read on store_stock_settings for select to app_user using (is_store_staff(store_id) or is_admin());
create policy stock_alerts_read on stock_alerts for select to app_user using (is_store_staff(store_id) or is_admin());
create policy purchase_lists_read on purchase_lists for select to app_user using (is_store_staff(store_id) or is_admin());
create policy purchase_list_items_read on purchase_list_items for select to app_user
  using (exists (select 1 from purchase_lists l where l.id = list_id and (is_store_staff(l.store_id) or is_admin())));
create policy store_tables_read on store_tables for select to app_user using (is_store_staff(store_id) or is_admin());
create policy table_bills_read on table_bills for select to app_user using (is_store_staff(store_id) or is_admin());
create policy table_bill_items_read on table_bill_items for select to app_user
  using (exists (select 1 from table_bills b where b.id = bill_id and (is_store_staff(b.store_id) or is_admin())));
create policy table_bill_payments_read on table_bill_payments for select to app_user
  using (exists (select 1 from table_bills b where b.id = bill_id and (is_store_staff(b.store_id) or is_admin())));
