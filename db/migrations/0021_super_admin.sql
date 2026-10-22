-- Super admin: papel de administrador global, suspensões com prazo, encerramento (exclusão lógica)
-- de lojas, histórico de situação, campanhas de anúncio, histórico de avaliações e "visto por último"
-- dos entregadores. Nada aqui apaga ou altera pedidos e lançamentos financeiros.

-- -------------------------------------------------------------- super admin
-- Só o super admin faz ações globais críticas (suspender, excluir, anúncios, corrigir nota).
-- Quem já é admin vira super admin, para ninguém perder acesso com a mudança.
alter table profiles add column is_super_admin boolean not null default false;
update profiles set is_super_admin = true where role = 'admin';
alter table profiles add constraint profiles_super_admin_is_admin check (not is_super_admin or role = 'admin');

-- ------------------------------------------------- encerramento de loja
-- Exclusão lógica: a loja some do app e do painel do lojista, mas pedidos, taxas e lançamentos ficam.
alter table stores
  add column closed_at timestamptz,
  add column closed_reason text check (closed_reason is null or length(closed_reason) between 3 and 500),
  add column closed_by_kind text check (closed_by_kind in ('empresa', 'admin')),
  add column closed_by uuid references profiles (id) on delete set null;
alter table stores add constraint stores_closed_consistent
  check ((closed_at is null and closed_by_kind is null) or (closed_at is not null and closed_by_kind is not null and closed_reason is not null));

-- ------------------------------------------------------------ suspensões
create table store_suspensions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  reason text not null check (length(reason) between 3 and 120),
  description text check (description is null or length(description) <= 2000),
  starts_at timestamptz not null,
  -- Nulo = por tempo indeterminado.
  ends_at timestamptz,
  notify_owner boolean not null default true,
  -- Situação da loja antes da suspensão, para voltar a ela ao reativar.
  previous_status store_status not null,
  applied_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references profiles (id) on delete set null,
  lift_reason text,
  check (ends_at is null or ends_at > starts_at),
  check (previous_status <> 'suspended')
);
-- Uma suspensão em aberto por loja.
create unique index store_suspensions_open_idx on store_suspensions (store_id) where lifted_at is null;
create index store_suspensions_due_idx on store_suspensions (starts_at, ends_at) where lifted_at is null;

-- ---------------------------------------------------- histórico de situação
create table store_status_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  kind text not null check (kind in ('cadastrada', 'aprovada', 'ativada', 'desativada', 'suspensa', 'reativada', 'excluida', 'encerrada_pela_empresa')),
  from_status text,
  to_status text,
  reason text,
  actor_id uuid references profiles (id) on delete set null,
  -- Processo automático (fim do prazo da suspensão), quando não foi uma pessoa.
  process text,
  created_at timestamptz not null default now()
);
create index store_status_events_store_idx on store_status_events (store_id, created_at desc);
create index store_status_events_kind_idx on store_status_events (kind, created_at);

-- O histórico começa no cadastro de cada loja que já existe.
insert into store_status_events (store_id, kind, to_status, created_at)
select id, 'cadastrada', status::text, created_at from stores;

-- ------------------------------------------------------- anúncios
create type ad_placement as enum ('inicio', 'topo', 'categoria', 'promocional');
create type ad_status as enum ('ativa', 'pausada', 'encerrada');

create table ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  title text not null check (length(title) between 3 and 80),
  placement ad_placement not null,
  -- Só para 'categoria': em qual segmento a loja aparece em destaque.
  category_id uuid references categories (id),
  -- 1 a 100; maior aparece antes.
  priority integer not null default 50 check (priority between 1 and 100),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status ad_status not null default 'ativa',
  -- O que foi cobrado da loja pela campanha (cobrança feita fora do app).
  price_cents integer not null default 0 check (price_cents >= 0),
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ends_at > starts_at),
  check (placement <> 'categoria' or category_id is not null)
);
create index ad_campaigns_live_idx on ad_campaigns (placement, starts_at, ends_at) where status = 'ativa';
create index ad_campaigns_store_idx on ad_campaigns (store_id, created_at desc);

-- Impressões e cliques por dia (contadores, sem dados de quem viu).
create table ad_daily_stats (
  campaign_id uuid not null references ad_campaigns (id) on delete cascade,
  day date not null,
  impressions integer not null default 0 check (impressions >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  primary key (campaign_id, day)
);

-- Pedido feito depois de clicar no anúncio (mesma loja, até 24 h depois do clique).
alter table orders add column ad_campaign_id uuid references ad_campaigns (id) on delete set null;
create index orders_ad_campaign_idx on orders (ad_campaign_id) where ad_campaign_id is not null;

-- Os destaques pagos que já existiam viram campanhas, para tudo ficar num lugar só.
insert into ad_campaigns (store_id, title, placement, priority, starts_at, ends_at, status, price_cents, notes)
select id, 'Destaque pago', 'inicio', 50, least(now(), featured_until - interval '1 minute'), featured_until, 'ativa', 0, 'Migrado do destaque pago anterior'
from stores where featured_until is not null and featured_until > now();

-- --------------------------------------------------- avaliações
alter table reviews
  add column report_reason text check (report_reason is null or length(report_reason) <= 300),
  add column report_resolved_at timestamptz,
  add column report_resolved_by uuid references profiles (id) on delete set null;

-- Toda mudança feita pela plataforma numa avaliação: ocultar, restaurar, corrigir nota, analisar denúncia.
create table review_events (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references reviews (id) on delete cascade,
  action text not null check (action in ('ocultada', 'restaurada', 'nota_corrigida', 'denuncia_analisada')),
  old_rating integer,
  new_rating integer,
  reason text not null check (length(reason) between 3 and 500),
  actor_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index review_events_review_idx on review_events (review_id, created_at desc);

-- ------------------------------------------------------- entregadores
-- "Visto por último": conexão. Disponível (available) e em entrega (pedido em rota) são coisas separadas.
alter table couriers add column last_seen_at timestamptz;

-- --------------------------------------------------------------- acesso
alter table store_suspensions enable row level security;
alter table store_status_events enable row level security;
alter table ad_campaigns enable row level security;
alter table ad_daily_stats enable row level security;
alter table review_events enable row level security;

grant select on store_suspensions, store_status_events, ad_campaigns, ad_daily_stats, review_events to app_user;

create policy store_suspensions_read on store_suspensions for select to app_user using (is_admin() or is_store_owner(store_id));
create policy store_status_events_read on store_status_events for select to app_user using (is_admin() or is_store_owner(store_id));
create policy ad_campaigns_read on ad_campaigns for select to app_user using (is_admin() or is_store_owner(store_id));
create policy ad_daily_stats_read on ad_daily_stats for select to app_user using (is_admin());
create policy review_events_read on review_events for select to app_user using (is_admin());
