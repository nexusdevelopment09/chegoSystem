-- Subcategorias dos segmentos e preço "de" dos produtos.
--
-- Subcategorias: cada segmento (categories) ganha a sua lista (Pizzarias, Hortifrúti,
-- Cervejas...). Uma loja pode estar em várias subcategorias do seu segmento (o admin
-- marca); um produto fica em no máximo uma (a loja escolhe). A lista em si é mantida
-- por db/seed/taxonomy.ts, que só acrescenta o que falta a cada migrate: o admin pode
-- renomear ou desativar sem ter a mudança desfeita.
--
-- Preço "de": compare_at_price_cents é só vitrine ("de R$ 30 por R$ 25"). O preço
-- cobrado continua sendo price_cents; checkout, taxas e totais não mudam.

create table subcategories (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  -- Agrupamento opcional na tela (ex.: "Presentes e ocasiões", no Shopping).
  group_name text,
  sort_order integer not null default 0,
  active boolean not null default true,
  unique (category_id, slug)
);

create table store_subcategories (
  store_id uuid not null references stores (id) on delete cascade,
  subcategory_id uuid not null references subcategories (id) on delete cascade,
  primary key (store_id, subcategory_id)
);
create index store_subcategories_sub_idx on store_subcategories (subcategory_id);

alter table products
  add column subcategory_id uuid references subcategories (id) on delete set null,
  add column compare_at_price_cents integer check (compare_at_price_cents is null or compare_at_price_cents > 0),
  add constraint products_compare_at_check check (compare_at_price_cents is null or compare_at_price_cents > price_cents);
create index products_subcategory_idx on products (subcategory_id) where subcategory_id is not null;
create index products_offer_idx on products (store_id) where compare_at_price_cents is not null;

alter table subcategories enable row level security;
alter table store_subcategories enable row level security;
grant select on subcategories, store_subcategories to app_user;
create policy subcategories_read on subcategories for select to app_user using (true);
create policy store_subcategories_read on store_subcategories for select to app_user using (true);
