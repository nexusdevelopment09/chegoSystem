import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { Stat } from "@/components/ui/Stats";
import { APPROVAL_CHECKLIST } from "@/lib/admin/checklist";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/session";
import { now } from "@/lib/clock";
import { sql } from "@/lib/db";
import { formatCents, formatDateTime, formatPhone } from "@/lib/format";
import { STORE_ROLE_LABELS, STORE_STATUS_LABELS } from "@/lib/labels";
import { getTeam } from "@/lib/merchant/context";
import { storeReport } from "@/lib/merchant/reports";
import { STATUS_LABELS, type OrderStatus } from "@/lib/orders/status";
import { DAY_MS } from "@/lib/time";
import { approveStore, setStoreStatus, updateStoreTerms } from "../../actions";
import { ResetPasswordForm } from "../../ResetPasswordForm";

export const metadata: Metadata = { title: "Loja" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
const check = "size-5 shrink-0 accent-brand-dark";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ ver?: string }> };

export default function AdminStorePage(props: Props) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <StoreDetail {...props} />
    </Suspense>
  );
}

async function StoreDetail({ params, searchParams }: Props) {
  const profile = await requireRole("admin");
  const [{ id }, { ver }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  const at = await now();

  const [store] = await sql<{
    id: string; name: string; slug: string; status: keyof typeof STORE_STATUS_LABELS; description: string; city: string; category: string;
    owner_name: string; owner_phone: string | null; internal_phone: string | null; document_type: string | null; document_number: string | null;
    commission_rate: string; payment_recipient_id: string | null; cash_enabled: boolean; status_reason: string | null;
    featured_until: Date | null; plan_id: string | null; free_until: string | null; created_at: Date;
    products: number; with_photo: number; hours: number; areas: number; offers_delivery: boolean;
  }[]>`
    select s.id, s.name, s.slug, s.status, s.description, c.name as city, cat.name as category,
           o.full_name as owner_name, o.phone as owner_phone, sp.internal_phone, sp.document_type, sp.document_number,
           sp.commission_rate, sp.payment_recipient_id, sp.cash_enabled, sp.status_reason, s.featured_until,
           sub.plan_id, sub.free_until::text, s.created_at, s.offers_delivery,
           (select count(*)::int from products p where p.store_id = s.id and p.deleted_at is null) as products,
           (select count(*)::int from products p where p.store_id = s.id and p.deleted_at is null and p.image_url is not null) as with_photo,
           (select count(*)::int from store_hours h where h.store_id = s.id) as hours,
           (select count(*)::int from store_delivery_areas a where a.store_id = s.id) as areas
    from stores s
    join cities c on c.id = s.city_id
    join categories cat on cat.id = s.category_id
    join profiles o on o.id = s.owner_id
    join store_private sp on sp.store_id = s.id
    left join store_subscriptions sub on sub.store_id = s.id
    where s.id = ${id}`;
  if (!store) notFound();

  const plans = await sql<{ id: string; name: string; monthly_price_cents: number }[]>`
    select id, name, monthly_price_cents from subscription_plans where active order by monthly_price_cents`;

  const team = await getTeam(store.id);

  // "Ver como esta loja": uma visão somente leitura do que a loja vê. Abrir fica registrado.
  const viewing = ver === "1";
  const view = viewing
    ? await (async () => {
        await audit({ actorId: profile.id, action: "store.view_as", entityType: "store", entityId: store.id, storeId: store.id });
        const [report, team, orders] = await Promise.all([
          storeReport(store.id, { from: new Date(at.getTime() - 30 * DAY_MS), to: at }),
          getTeam(store.id),
          sql<{ id: string; code: string; status: OrderStatus; total_cents: number; created_at: Date }[]>`
            select id, code, status, total_cents, created_at from orders
            where store_id = ${store.id} and paid_at is not null order by created_at desc limit 15`,
        ]);
        return { report, team, orders };
      })()
    : null;

  // O que o sistema consegue conferir sozinho, para ajudar o admin com a lista.
  const facts: Record<string, string> = {
    data: `${store.category} em ${store.city}. Dono: ${store.owner_name}.`,
    documents: store.document_number ? `${(store.document_type ?? "").toUpperCase()} ${store.document_number}` : "Nenhum documento informado.",
    menu: `${store.products} produtos, ${store.with_photo} com foto.`,
    hours: store.hours > 0 ? `${store.hours} turnos cadastrados.` : "Nenhum horário cadastrado.",
    areas: store.areas > 0 ? `${store.areas} bairros atendidos.` : store.offers_delivery ? "Nenhuma área cadastrada." : "Só retirada.",
    recipient: store.payment_recipient_id ?? "Será criado ao aprovar (ambiente de testes).",
  };
  const inputDate = (value: Date | null) => (value ? new Date(value.getTime() - 3 * 60 * 60 * 1000 - 1).toISOString().slice(0, 10) : "");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/admin/lojas" className="font-semibold text-brand-dark underline">← Lojas</Link>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-3xl">{store.name}</h1>
          <p className="text-coffee-soft">{store.category} · {store.city} · cadastrada em {formatDateTime(store.created_at)}</p>
        </div>
        <span data-testid="admin-store-status" className="rounded-full bg-peach px-4 py-2 font-bold">{STORE_STATUS_LABELS[store.status]}</span>
      </header>
      {store.status_reason && <p className="rounded-2xl bg-peach px-4 py-3"><strong>Motivo:</strong> {store.status_reason}</p>}

      <section className={card}>
        <h2 className="text-xl">Dados internos</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-coffee-soft">Dono</dt><dd className="font-semibold">{store.owner_name}{store.owner_phone && ` · ${formatPhone(store.owner_phone)}`}</dd></div>
          <div><dt className="text-coffee-soft">Telefone interno (só o admin vê)</dt><dd className="font-semibold">{store.internal_phone ? formatPhone(store.internal_phone) : "—"}</dd></div>
          <div><dt className="text-coffee-soft">Documento</dt><dd className="font-semibold">{facts.documents}</dd></div>
          <div><dt className="text-coffee-soft">Recebedor no gateway</dt><dd className="font-semibold break-all">{store.payment_recipient_id ?? "—"}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {store.status !== "pending" && <Link href={`/loja/${store.slug}`} className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>Página pública</Link>}
          <Link href={viewing ? `/admin/lojas/${store.id}` : `/admin/lojas/${store.id}?ver=1`} className={buttonClass("secondary", "min-h-11 px-4 text-sm")}>
            {viewing ? "Fechar a visão da loja" : "Ver como esta loja"}
          </Link>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-xl">Equipe e senhas</h2>
        <p className="-mt-2 text-sm text-coffee-soft">Para quem da loja esqueceu a senha: gera uma provisória e desconecta a pessoa de todos os aparelhos.</p>
        <ul className="text-sm">
          {team.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-cream py-1">
              <span>{member.name || "Sem nome"} · {STORE_ROLE_LABELS[member.role]}{member.phone && ` · ${formatPhone(member.phone)}`}</span>
              <ResetPasswordForm profileId={member.id} />
            </li>
          ))}
        </ul>
      </section>

      {view && (
        <section className={`${card} border-2 border-dashed border-brand`} data-testid="view-as-store">
          <h2 className="text-xl">Visão da loja (somente leitura)</h2>
          <p className="text-sm text-coffee-soft">Você está vendo os números que a loja vê. Nada pode ser alterado por aqui, e esta consulta ficou registrada.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Pedidos (30 dias)" value={view.report.orders} />
            <Stat label="Vendas" value={formatCents(view.report.grossCents)} />
            <Stat label="Ticket médio" value={formatCents(view.report.ticketCents)} />
            <Stat label="A receber" value={formatCents(view.report.netCents)} />
          </div>
          <h3 className="text-lg">Equipe</h3>
          <ul className="text-sm">
            {view.team.map((member) => <li key={member.id}>{member.name || "Sem nome"} · {STORE_ROLE_LABELS[member.role]}</li>)}
          </ul>
          <h3 className="text-lg">Últimos pedidos</h3>
          <ul className="text-sm">
            {view.orders.map((order) => (
              <li key={order.id} className="flex justify-between gap-2 border-b border-cream py-1">
                <Link href={`/admin/pedidos/${order.id}`} className="font-semibold text-brand-dark underline">{order.code}</Link>
                <span>{STATUS_LABELS[order.status]} · {formatCents(order.total_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {store.status === "pending" && (
        <ActionForm action={approveStore} className={card}>
          <h2 className="text-xl">Aprovar loja</h2>
          <input type="hidden" name="id" value={store.id} />
          {APPROVAL_CHECKLIST.map(([key, label]) => (
            <label key={key} className="flex min-h-11 items-start gap-3">
              <input type="checkbox" name={`check-${key}`} className={`${check} mt-1`} />
              <span>{label}<span className="block text-sm text-coffee-soft">{facts[key]}</span></span>
            </label>
          ))}
          <SubmitButton className="self-start">Aprovar e colocar no ar</SubmitButton>
        </ActionForm>
      )}

      {store.status !== "pending" && (
        <>
          <ActionForm action={updateStoreTerms} className={card}>
            <h2 className="text-xl">Comissão, plano e destaque</h2>
            <input type="hidden" name="id" value={store.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Comissão (%)" name="commission" inputMode="decimal" required defaultValue={(Number(store.commission_rate) * 100).toFixed(1).replace(".", ",")}
                hint="Vale para os pedidos novos. Os antigos não mudam." />
              <label className="flex flex-col gap-1.5 text-sm font-semibold">
                Plano de mensalidade
                <select name="planId" required defaultValue={store.plan_id ?? plans[0]?.id} className={inputClass}>
                  {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {formatCents(plan.monthly_price_cents)}/mês</option>)}
                </select>
              </label>
              <Field label="Mensalidade grátis até" name="freeUntil" type="date" defaultValue={store.free_until ?? ""} hint="Para lojas fundadoras." />
              <Field label="Destaque pago até" name="featuredUntil" type="date" defaultValue={inputDate(store.featured_until)} hint="A loja aparece na seção “Destaques”, identificada." />
            </div>
            <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="cashEnabled" defaultChecked={store.cash_enabled} className={check} /> Pode receber em dinheiro na entrega (quando o recurso existir)</label>
            <SubmitButton className="self-start">Salvar condições</SubmitButton>
          </ActionForm>

          <ActionForm action={setStoreStatus} className={card}>
            <h2 className="text-xl">Situação</h2>
            <input type="hidden" name="id" value={store.id} />
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Nova situação
              <select name="status" defaultValue={store.status} className={inputClass}>
                <option value="active">Ativa</option>
                <option value="paused">Pausada</option>
                <option value="suspended">Suspensa (some para os clientes)</option>
              </select>
            </label>
            <Field label="Motivo" name="reason" maxLength={300} hint="Obrigatório para suspender. O dono é avisado." />
            <SubmitButton variant="secondary" className="self-start">Alterar situação</SubmitButton>
          </ActionForm>
        </>
      )}
    </div>
  );
}
