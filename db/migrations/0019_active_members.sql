-- Membro desativado da equipe perde o acesso também nas regras do banco (RLS), não só no
-- painel. O vínculo continua guardado, com o histórico do que a pessoa fez.
create or replace function is_store_member(target_store uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from store_members where store_id = target_store and profile_id = current_user_id() and active);
$$;

create or replace function is_store_staff(target_store uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from store_members
    where store_id = target_store and profile_id = current_user_id() and role in ('owner', 'attendant') and active);
$$;

create or replace function is_store_owner(target_store uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from store_members
    where store_id = target_store and profile_id = current_user_id() and role = 'owner' and active);
$$;

-- O dono nunca é desativado.
alter table store_members add constraint store_members_owner_active check (role <> 'owner' or active);
