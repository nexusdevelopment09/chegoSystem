-- Profiles hold the global role. The role is only ever read from here on the
-- server, never from anything the browser sends.

create type user_role as enum ('customer', 'merchant', 'admin');

create table profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null default '',
  phone text unique,
  email text unique,
  password_hash text,
  role user_role not null default 'customer',
  accepted_terms_at timestamptz,
  -- Cash on delivery is off in the MVP; kept per customer for the future.
  cash_enabled boolean not null default false,
  blocked_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Login sessions. Only a hash of the cookie token is stored.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index sessions_profile_id_idx on sessions (profile_id);

create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();
