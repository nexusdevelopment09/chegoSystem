-- Rede de entregadores do Chegô.
--
-- Até aqui cada loja entregava com o próprio entregador. Agora a loja escolhe:
--   'store'    = a loja entrega (como antes) e fica com a taxa de entrega;
--   'platform' = um entregador da rede do Chegô entrega, e a taxa de entrega
--                passa pela plataforma, que paga o entregador.
-- A rede tem dois tipos de entregador: os do próprio Chegô ('platform') e os
-- parceiros autônomos ('partner'), que se cadastram e são aprovados pelo admin.

create type courier_kind as enum ('platform', 'partner');
create type courier_status as enum ('pending', 'active', 'blocked');
create type delivery_provider as enum ('store', 'platform');

create table couriers (
  profile_id uuid primary key references profiles (id) on delete cascade,
  kind courier_kind not null default 'partner',
  status courier_status not null default 'pending',
  city_id uuid not null references cities (id),
  document_type text not null check (document_type in ('cpf', 'cnpj')),
  document_number text not null,
  vehicle text not null check (vehicle in ('motorcycle', 'bicycle', 'car', 'on_foot')),
  plate text,
  -- "Estou disponível": só quem está disponível recebe as entregas novas.
  available boolean not null default false,
  approved_at timestamptz,
  blocked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index couriers_city_idx on couriers (city_id, status) where available;

create trigger couriers_set_updated_at
  before update on couriers
  for each row execute function set_updated_at();

alter table stores add column delivery_provider delivery_provider not null default 'store';

-- Copiado da loja no momento do pedido, como a comissão: mudar a loja depois
-- não altera quem entrega nem para quem vai a taxa dos pedidos já feitos.
alter table orders
  add column delivery_provider delivery_provider not null default 'store',
  -- Quanto o entregador da rede ganha por esta entrega.
  add column courier_fee_cents integer not null default 0 check (courier_fee_cents >= 0),
  add column courier_assigned_at timestamptz;

-- Entregas da rede que ainda não têm entregador.
create index orders_delivery_offers_idx on orders (city_id, status)
  where delivery_provider = 'platform' and courier_id is null;

-- Um ganho por entrega concluída. O admin marca quando o repasse foi feito.
create table courier_earnings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders (id),
  courier_id uuid not null references profiles (id),
  amount_cents integer not null check (amount_cents >= 0),
  paid_at timestamptz,
  paid_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create index courier_earnings_courier_idx on courier_earnings (courier_id, created_at desc);

alter table ledger_entries
  add column courier_id uuid references profiles (id),
  add constraint ledger_entries_courier_check check (account <> 'courier' or courier_id is not null);

-- ------------------------------------------------- regras de acesso (RLS)

alter table couriers enable row level security;
alter table courier_earnings enable row level security;
grant select on couriers, courier_earnings to app_user;

-- O entregador vê o próprio cadastro e os próprios ganhos; o admin vê tudo.
-- Aprovar, bloquear e pagar só acontece no servidor, pela conexão dona do banco.
create policy couriers_read on couriers for select to app_user
  using (profile_id = current_user_id() or is_admin());

create policy courier_earnings_read on courier_earnings for select to app_user
  using (courier_id = current_user_id() or is_admin());

drop policy ledger_entries_read on ledger_entries;
create policy ledger_entries_read on ledger_entries for select to app_user
  using (
    is_admin()
    or (account = 'store' and is_store_owner(store_id))
    or (account = 'courier' and courier_id = current_user_id())
  );

-- O cliente e a loja veem só o primeiro nome de quem está entregando; o resto do
-- cadastro do entregador continua privado. "security definer" porque as regras
-- de acesso não deixam um usuário ler o perfil de outro.
create function courier_first_name(target_courier uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select split_part(full_name, ' ', 1) from profiles where id = target_courier;
$$;
