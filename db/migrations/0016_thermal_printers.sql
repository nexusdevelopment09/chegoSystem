-- Impressoras térmicas Bluetooth por loja e a fila de impressão.
--
-- A conexão Bluetooth em si fica só no celular Android (Web Serial do Chrome, impressora
-- já pareada). Aqui ficam as preferências de cada impressora e em qual aparelho ela está
-- (device_id: um identificador aleatório que o próprio aparelho guarda), e a fila de
-- trabalhos, para nunca imprimir o mesmo pedido duas vezes por recarregar a página,
-- reconectar ou receber o aviso repetido.

create type printer_sector as enum ('caixa', 'cozinha', 'expedicao', 'geral');
create type print_kind as enum ('completo', 'cozinha', 'comprovante', 'teste');
create type print_job_status as enum ('pending', 'sending', 'sent', 'failed', 'unknown');

create table store_printers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  sector printer_sector not null default 'geral',
  print_kind print_kind not null default 'completo' check (print_kind <> 'teste'),
  paper_width_mm integer not null default 58 check (paper_width_mm in (58, 80)),
  copies integer not null default 1 check (copies between 1 and 5),
  -- Tabela de caracteres da impressora para os acentos: cp860 (português), cp850 ou sem acentos.
  encoding text not null default 'cp860' check (encoding in ('cp860', 'cp850', 'ascii')),
  auto_print boolean not null default false,
  -- Só os pedidos que chegarem depois de ligar a impressão automática (nunca o histórico).
  auto_since timestamptz,
  is_default boolean not null default false,
  -- Em qual celular a impressora está pareada (o aparelho guarda o próprio id).
  device_id text check (device_id is null or device_id ~ '^[a-f0-9-]{36}$'),
  device_label text check (device_label is null or length(device_label) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index store_printers_store_idx on store_printers (store_id);
-- Uma impressora padrão por loja.
create unique index store_printers_default_idx on store_printers (store_id) where is_default;

create table print_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores (id) on delete cascade,
  printer_id uuid references store_printers (id) on delete set null,
  order_id uuid references orders (id) on delete cascade,
  kind print_kind not null,
  -- Automático: um por impressora, pedido e tipo. Reimpressão manual cria outro, marcado.
  reprint boolean not null default false,
  status print_job_status not null default 'pending',
  attempts integer not null default 0,
  error text,
  device_id text,
  requested_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
create unique index print_jobs_auto_idx on print_jobs (printer_id, order_id, kind) where not reprint and order_id is not null;
create index print_jobs_queue_idx on print_jobs (printer_id, status, created_at);
create index print_jobs_order_idx on print_jobs (order_id);

-- Leitura pela equipe da loja (dono e atendente); gravação só pelo servidor, depois de
-- conferir a loja de quem pediu.
alter table store_printers enable row level security;
alter table print_jobs enable row level security;
grant select on store_printers, print_jobs to app_user;
create policy store_printers_read on store_printers for select to app_user using (is_store_staff(store_id) or is_admin());
create policy print_jobs_read on print_jobs for select to app_user using (is_store_staff(store_id) or is_admin());
