import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { hasPermission } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatDateTime, formatPhone } from "@/lib/format";
import { getMerchantContext } from "@/lib/merchant/context";
import { DEFAULTS, effectivePermissions, permissionGroups, type MemberRole, type Permission } from "@/lib/merchant/permissions";
import { renameMember, revokeInvite, revokeMemberSessions, setMemberActive, updatePermissions } from "./actions";
import { InviteForm } from "./InviteForm";

export const metadata: Metadata = { title: "Funcionários e Permissões" };

const ROLE = { owner: "Dono", attendant: "Funcionário", courier: "Entregador" } as const;
const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";


export default function TeamPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Team />
    </Suspense>
  );
}

async function Team() {
  const { profile, membership, store } = await getMerchantContext("equipe.gerenciar");
  const [members, invites] = await Promise.all([
    sql<{ id: string; full_name: string; phone: string | null; role: MemberRole; permissions: string[] | null; active: boolean; deactivated_at: Date | null; created_at: Date; last_seen: Date | null }[]>`
      select p.id, p.full_name, p.phone, m.role, m.permissions, m.active, m.deactivated_at, m.created_at,
             (select max(s.created_at) from sessions s where s.profile_id = p.id) as last_seen
      from store_members m join profiles p on p.id = m.profile_id
      where m.store_id = ${store.id} and m.role <> 'courier'
      order by m.active desc, m.role, p.full_name`,
    sql<{ id: string; full_name: string; phone: string | null; role: MemberRole; expires_at: Date; used_at: Date | null; revoked_at: Date | null; created_at: Date }[]>`
      select id, full_name, phone, role, expires_at, used_at, revoked_at, created_at from store_invites
      where store_id = ${store.id} and role = 'attendant' order by created_at desc limit 20`,
  ]);
  const canPerms = hasPermission(membership, "equipe.permissoes");
  const groups = permissionGroups();
  const pending = invites.filter((invite) => !invite.used_at && !invite.revoked_at && invite.expires_at > new Date());

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header>
        <h1 className="text-3xl">Funcionários e Permissões</h1>
        <p className="text-coffee-soft">
          Quem trabalha na loja e o que cada um pode fazer. O sistema confere as permissões em cada ação, não só nos botões.
          Desativar tira o acesso na hora e guarda tudo o que a pessoa fez. Entregadores ficam em Entregadores.
        </p>
      </header>

      <section className={card}>
        <h2 className="text-xl">Convidar funcionário</h2>
        <p className="-mt-2 text-sm text-coffee-soft">A pessoa abre o link, cria a senha (ou entra com a conta que já tem) e passa a fazer parte da equipe.</p>
        <InviteForm groups={groups} allowed={membership.permissions} roles={["attendant"]} />
      </section>

      {pending.length > 0 && (
        <section className={card}>
          <h2 className="text-xl">Convites pendentes</h2>
          <ul className="divide-y divide-cream text-sm" data-testid="pending-invites">
            {pending.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><strong>{invite.full_name}</strong>{invite.phone && ` · ${formatPhone(invite.phone)}`} · vale até {formatDateTime(invite.expires_at)}</span>
                <form action={revokeInvite}><input type="hidden" name="id" value={invite.id} /><Button type="submit" variant="secondary" className="min-h-11 px-3 text-xs">Cancelar convite</Button></form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {members.map((member) => {
        const permissions = effectivePermissions(member.role, member.permissions);
        const self = member.id === profile.id;
        return (
          <section key={member.id} className={`${card} ${member.active ? "" : "opacity-75"}`} data-testid="team-card" aria-label={member.full_name || "Sem nome"}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-xl">{member.full_name || "Ainda não entrou"} {self && <span className="text-sm font-normal text-coffee-soft">(você)</span>}</h2>
                <p className="text-sm text-coffee-soft">
                  {ROLE[member.role]}{member.phone && ` · ${formatPhone(member.phone)}`} · {member.active ? "Ativo" : `Desativado em ${formatDateTime(member.deactivated_at!)}`}
                  {member.last_seen && ` · último acesso ${formatDateTime(member.last_seen)}`}
                </p>
                <p className="text-xs text-coffee-soft">{member.role === "owner" ? "Todas as permissões" : `${permissions.length} permissões${member.permissions === null ? " (padrão)" : ""}`}</p>
              </div>
              {member.role !== "owner" && !self && (
                <div className="flex flex-wrap gap-2">
                  <form action={setMemberActive}>
                    <input type="hidden" name="profileId" value={member.id} />
                    <input type="hidden" name="active" value={member.active ? "0" : "1"} />
                    <Button type="submit" variant="secondary" className="min-h-11 px-3 text-xs">{member.active ? "Desativar acesso" : "Reativar"}</Button>
                  </form>
                  <form action={revokeMemberSessions}>
                    <input type="hidden" name="profileId" value={member.id} />
                    <Button type="submit" variant="secondary" className="min-h-11 px-3 text-xs">Encerrar sessões</Button>
                  </form>
                </div>
              )}
            </div>
            {member.role !== "owner" && !self && (
              <>
                <details>
                  <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-brand-dark">Editar nome</summary>
                  <ActionForm action={renameMember} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="profileId" value={member.id} />
                    <Field label="Nome" name="name" defaultValue={member.full_name} maxLength={80} required />
                    <SubmitButton variant="secondary" className="min-h-11 px-4 text-sm">Salvar</SubmitButton>
                  </ActionForm>
                </details>
                {canPerms && (
                  <details>
                    <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-brand-dark">Permissões</summary>
                    <ActionForm action={updatePermissions} className="flex flex-col gap-3">
                      <input type="hidden" name="profileId" value={member.id} />
                      <div className="grid gap-2 sm:grid-cols-2">
                        {groups.map((group) => (
                          <fieldset key={group.group} className="rounded-2xl bg-cream p-3">
                            <legend className="text-xs font-bold uppercase text-coffee-soft">{group.group}</legend>
                            {group.items.map((item) => (
                              <label key={item.key} className="flex min-h-11 items-center gap-2 text-sm">
                                <input type="checkbox" name="permissions" value={item.key} defaultChecked={permissions.includes(item.key as Permission)}
                                  disabled={!membership.permissions.includes(item.key as Permission)} className="size-5 accent-brand-dark" />
                                {item.label}
                              </label>
                            ))}
                          </fieldset>
                        ))}
                      </div>
                      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="defaults" className="size-5 accent-brand-dark" /> Voltar para as permissões padrão de {ROLE[member.role].toLowerCase()} ({DEFAULTS[member.role].length})</label>
                      <SubmitButton className="self-start">Salvar permissões</SubmitButton>
                    </ActionForm>
                  </details>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
