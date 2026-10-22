import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Field, inputClass } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { toLocal } from "@/lib/time";
import { deleteStoreAction, liftSuspensionAction, suspendStoreAction, toggleStoreActive } from "../actions";

export const EVENT_LABELS: Record<string, string> = {
  cadastrada: "Cadastrada", aprovada: "Aprovada", ativada: "Ativada", desativada: "Desativada", suspensa: "Suspensa",
  reativada: "Reativada", excluida: "Excluída pelo Chegô", encerrada_pela_empresa: "Encerrada pela empresa",
};

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
const localInput = (date: Date) => {
  const local = toLocal(date);
  return `${local.date}T${String(Math.floor(local.minutes / 60)).padStart(2, "0")}:${String(local.minutes % 60).padStart(2, "0")}`;
};

/** Situação da conta: ativar, desativar, suspender, reativar e excluir, com o histórico completo. */
export async function AccountPanel({ storeId, storeName, status, superAdmin, at }: {
  storeId: string; storeName: string; status: "pending" | "active" | "paused" | "suspended"; superAdmin: boolean; at: Date;
}) {
  const [[closed], suspensions, events] = await Promise.all([
    sql<{ closed_at: Date | null; closed_reason: string | null; closed_by_kind: string | null; closed_by_name: string | null }[]>`
      select s.closed_at, s.closed_reason, s.closed_by_kind, p.full_name as closed_by_name
      from stores s left join profiles p on p.id = s.closed_by where s.id = ${storeId}`,
    sql<{ id: string; reason: string; description: string | null; starts_at: Date; ends_at: Date | null; applied_at: Date | null; lifted_at: Date | null; lift_reason: string | null; created_by: string | null; lifted_by: string | null }[]>`
      select su.id, su.reason, su.description, su.starts_at, su.ends_at, su.applied_at, su.lifted_at, su.lift_reason,
             c.full_name as created_by, l.full_name as lifted_by
      from store_suspensions su left join profiles c on c.id = su.created_by left join profiles l on l.id = su.lifted_by
      where su.store_id = ${storeId} order by su.created_at desc`,
    sql<{ id: string; kind: string; reason: string | null; actor: string | null; process: string | null; created_at: Date }[]>`
      select e.id, e.kind, e.reason, p.full_name as actor, e.process, e.created_at
      from store_status_events e left join profiles p on p.id = e.actor_id
      where e.store_id = ${storeId} order by e.created_at desc limit 50`,
  ]);
  const open = suspensions.find((item) => !item.lifted_at);
  const isClosed = !!closed?.closed_at;

  return (
    <section className={card} data-testid="account-panel">
      <h2 className="text-xl">Situação da conta</h2>

      {isClosed ? (
        <p role="status" className="rounded-2xl bg-peach px-4 py-3 text-sm">
          <strong>{closed.closed_by_kind === "empresa" ? "Encerrada pela empresa" : "Excluída pelo Chegô"}</strong> em {formatDateTime(closed.closed_at!)}
          {closed.closed_by_name && <> por {closed.closed_by_name}</>}. Motivo: {closed.closed_reason}. Pedidos e valores continuam guardados.
        </p>
      ) : open ? (
        <p role="status" className="rounded-2xl bg-peach px-4 py-3 text-sm" data-testid="open-suspension">
          <strong>{open.applied_at ? "Suspensa" : "Suspensão agendada"}</strong> desde {formatDateTime(open.starts_at)}
          {open.ends_at ? <> até {formatDateTime(open.ends_at)}</> : " por tempo indeterminado"}. Motivo: {open.reason}.
        </p>
      ) : null}

      {!isClosed && status !== "pending" && (
        superAdmin ? (
          <div className="flex flex-wrap gap-2">
            {status === "paused" && !open && (
              <ActionForm action={toggleStoreActive} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={storeId} /><input type="hidden" name="active" value="1" /><input type="hidden" name="reason" value="" />
                <SubmitButton className="min-h-11 px-4 text-sm">Ativar loja</SubmitButton>
              </ActionForm>
            )}
            {status === "active" && !open && (
              <Modal trigger="Desativar loja" title="Desativar loja">
                <p className="text-sm text-coffee-soft">A loja fica pausada: os clientes veem que ela não está recebendo pedidos. Não é uma suspensão.</p>
                <ActionForm action={toggleStoreActive} className="flex flex-col gap-3">
                  <input type="hidden" name="id" value={storeId} /><input type="hidden" name="active" value="0" />
                  <Field label="Motivo" name="reason" required maxLength={300} />
                  <SubmitButton className="self-start">Desativar</SubmitButton>
                </ActionForm>
              </Modal>
            )}
            {!open && (
              <Modal trigger="Suspender conta" title={`Suspender ${storeName}`} testId="suspend-open">
                <ActionForm action={suspendStoreAction} className="flex flex-col gap-3">
                  <input type="hidden" name="id" value={storeId} />
                  <Field label="Motivo da suspensão" name="reason" required maxLength={120} placeholder="Ex.: Reclamações repetidas de pedidos não entregues" />
                  <label className="flex flex-col gap-1.5 text-sm font-semibold">
                    Descrição da ocorrência
                    <textarea name="description" maxLength={2000} rows={3} className={`${inputClass} py-2`} />
                  </label>
                  <Field label="Início" name="startsAt" type="datetime-local" defaultValue={localInput(at)} hint="No futuro, a suspensão fica agendada." />
                  <Field label="Até" name="endsAt" type="datetime-local" hint="Deixe em branco e marque abaixo para tempo indeterminado." />
                  <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" name="indefinite" className="size-5 accent-brand-dark" /> Por tempo indeterminado</label>
                  <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" name="notify" defaultChecked className="size-5 accent-brand-dark" /> Avisar a empresa</label>
                  <p className="text-xs text-coffee-soft">Suspensa, a loja some da vitrine e não recebe pedidos novos. Os pedidos em andamento continuam.</p>
                  <SubmitButton className="self-start">Suspender conta</SubmitButton>
                </ActionForm>
              </Modal>
            )}
            {open && (
              <Modal trigger="Reativar conta" title="Reativar conta" variant="primary">
                <ActionForm action={liftSuspensionAction} className="flex flex-col gap-3">
                  <input type="hidden" name="id" value={storeId} />
                  <Field label="Motivo da reativação" name="reason" required maxLength={300} />
                  <SubmitButton className="self-start">Reativar</SubmitButton>
                </ActionForm>
              </Modal>
            )}
            <Modal trigger="Excluir conta" title="Excluir conta" danger testId="delete-open">
              <p className="text-sm">
                A loja sai do ar e do painel do lojista <strong>para sempre</strong>. Pedidos, taxas e lançamentos continuam guardados, como exige a lei.
                Com pedido em andamento, não dá para excluir.
              </p>
              <ActionForm action={deleteStoreAction} className="flex flex-col gap-3">
                <input type="hidden" name="id" value={storeId} />
                <Field label="Motivo" name="reason" required maxLength={500} />
                <Field label={`Digite o nome da loja para confirmar: ${storeName}`} name="confirmName" required autoComplete="off" />
                <SubmitButton className="self-start">Excluir definitivamente</SubmitButton>
              </ActionForm>
            </Modal>
          </div>
        ) : (
          <p className="text-sm text-coffee-soft">Só o super admin pode ativar, desativar, suspender ou excluir contas.</p>
        )
      )}

      <details>
        <summary className="min-h-11 cursor-pointer content-center font-semibold">Histórico de situação ({events.length})</summary>
        <ol className="mt-2 flex flex-col gap-1 text-sm" data-testid="status-history">
          {events.map((item) => (
            <li key={item.id} className="border-b border-cream py-1">
              <strong>{EVENT_LABELS[item.kind] ?? item.kind}</strong> · {formatDateTime(item.created_at)} · {item.actor ?? item.process ?? "Sistema"}
              {item.reason && <span className="block text-coffee-soft">Motivo: {item.reason}</span>}
            </li>
          ))}
        </ol>
      </details>
      {suspensions.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer content-center font-semibold">Suspensões ({suspensions.length})</summary>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {suspensions.map((item) => (
              <li key={item.id} className="rounded-2xl bg-cream px-3 py-2">
                <strong>{item.reason}</strong> · {formatDateTime(item.starts_at)} → {item.ends_at ? formatDateTime(item.ends_at) : "indeterminado"} · por {item.created_by ?? "—"}
                {item.description && <span className="block text-coffee-soft">{item.description}</span>}
                {item.lifted_at && <span className="block text-coffee-soft">Encerrada em {formatDateTime(item.lifted_at)} por {item.lifted_by ?? "processo automático"}: {item.lift_reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
