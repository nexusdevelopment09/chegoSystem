-- Auditoria imutável, com uma exceção: quando uma conta é excluída (LGPD) ou uma loja some,
-- o banco apaga só a referência (actor_id ou store_id vira null). O evento continua lá,
-- anônimo. Qualquer outra alteração segue proibida.
create or replace function audit_logs_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if (new.actor_id is null or new.actor_id is not distinct from old.actor_id)
       and (new.store_id is null or new.store_id is not distinct from old.store_id)
       and (new.actor_id is distinct from old.actor_id or new.store_id is distinct from old.store_id)
       and new.action = old.action and new.entity_type = old.entity_type
       and new.entity_id is not distinct from old.entity_id and new.details::text = old.details::text
       and new.created_at = old.created_at and new.result = old.result
       and new.reason is not distinct from old.reason and new.module is not distinct from old.module
       and new.actor_role is not distinct from old.actor_role and new.process is not distinct from old.process
       and new.request_id is not distinct from old.request_id then
      return new;
    end if;
    raise exception 'audit_logs: eventos de auditoria não podem ser alterados';
  end if;
  if current_setting('chego.audit_retention', true) is distinct from 'on' then
    raise exception 'audit_logs: eventos só são apagados pela rotina de retenção';
  end if;
  return old;
end;
$$;
