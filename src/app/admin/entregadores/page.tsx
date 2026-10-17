import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DocumentField } from "@/components/forms/DocumentField";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button, buttonClass } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { Stat } from "@/components/ui/Stats";
import { requireRole } from "@/lib/auth/session";
import { sql } from "@/lib/db";
import { formatDocument, type DocumentType } from "@/lib/documents";
import { formatCents, formatPhone } from "@/lib/format";
import { COURIER_KIND_LABELS, COURIER_STATUS_LABELS, VEHICLE_LABELS, type Vehicle } from "@/lib/labels";
import { approveCourier, createPlatformCourier, payCourier, setCourierBlocked, setCourierKind } from "./actions";
import { ResetPasswordForm } from "../ResetPasswordForm";

export const metadata: Metadata = { title: "Entregadores" };

const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
const small = "min-h-11 px-4 text-sm";

type Status = keyof typeof COURIER_STATUS_LABELS;
type Kind = keyof typeof COURIER_KIND_LABELS;
type SearchParams = Promise<{ situacao?: string; tipo?: string }>;

export default function AdminCouriersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <Couriers searchParams={searchParams} />
    </Suspense>
  );
}

async function Couriers({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("admin");
  const params = await searchParams;
  const status = params.situacao && params.situacao in COURIER_STATUS_LABELS ? (params.situacao as Status) : null;
  const kind = params.tipo && params.tipo in COURIER_KIND_LABELS ? (params.tipo as Kind) : null;

  const [couriers, cities, waiting] = await Promise.all([
    sql<{
      id: string; full_name: string; phone: string | null; kind: Kind; status: Status; city: string; vehicle: Vehicle; plate: string | null;
      document_type: DocumentType; document_number: string; available: boolean; blocked_reason: string | null;
      deliveries: number; carrying: number; to_receive: number; received: number;
    }[]>`
      select p.id, p.full_name, p.phone, c.kind, c.status, ci.name as city, c.vehicle, c.plate, c.document_type, c.document_number,
             c.available, c.blocked_reason,
             (select count(*)::int from courier_earnings e where e.courier_id = p.id) as deliveries,
             (select count(*)::int from orders o where o.courier_id = p.id and o.status in ('accepted', 'preparing', 'ready', 'out_for_delivery')) as carrying,
             (select coalesce(sum(e.amount_cents), 0)::int from courier_earnings e where e.courier_id = p.id and e.paid_at is null and e.payer = 'platform') as to_receive,
             (select coalesce(sum(e.amount_cents), 0)::int from courier_earnings e where e.courier_id = p.id and e.paid_at is not null and e.payer = 'platform') as received
      from couriers c join profiles p on p.id = c.profile_id join cities ci on ci.id = c.city_id
      where p.deleted_at is null
        ${status ? sql`and c.status = ${status}::courier_status` : sql``}
        ${kind ? sql`and c.kind = ${kind}::courier_kind` : sql``}
      order by (c.status = 'pending') desc, p.full_name`,
    sql<{ id: string; name: string }[]>`select id, name from cities where active order by name`,
    sql<{ total: number }[]>`
      select count(*)::int as total from orders
      where delivery_provider = 'platform' and fulfillment = 'delivery' and courier_id is null and status in ('accepted', 'preparing', 'ready')`,
  ]);

  const filter = (changes: Record<string, string | null>) => {
    const query = new URLSearchParams();
    const next = { situacao: status, tipo: kind, ...changes };
    for (const [key, value] of Object.entries(next)) if (value) query.set(key, value);
    const text = query.toString();
    return text ? `/admin/entregadores?${text}` : "/admin/entregadores";
  };
  const chip = (active: boolean) => buttonClass(active ? "primary" : "secondary", small);
  const owed = couriers.reduce((total, courier) => total + courier.to_receive, 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl">Entregadores</h1>
      <p className="text-coffee-soft">
        A rede de entregas do Chegô tem os <strong>entregadores do próprio Chegô</strong> e os <strong>parceiros</strong>, que se cadastram em{" "}
        <Link href="/quero-entregar" className="font-bold text-brand-dark underline">Quero entregar</Link>. Eles atendem as lojas que escolheram “Entregadores do Chegô”.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Disponíveis agora" value={couriers.filter((courier) => courier.status === "active" && courier.available).length} />
        <Stat label="Esperando aprovação" value={couriers.filter((courier) => courier.status === "pending").length} href={filter({ situacao: "pending" })} />
        <Stat label="Entregas sem entregador" value={waiting[0].total} href="/admin/ao-vivo" />
        <Stat label="A repassar" value={formatCents(owed)} hint="Ganhos de entregas concluídas ainda não repassados" />
      </div>

      <nav aria-label="Filtros" className="flex flex-wrap gap-2">
        <Link href={filter({ situacao: null })} aria-current={!status ? "true" : undefined} className={chip(!status)}>Todas as situações</Link>
        {(Object.keys(COURIER_STATUS_LABELS) as Status[]).map((value) => (
          <Link key={value} href={filter({ situacao: value })} aria-current={status === value ? "true" : undefined} className={chip(status === value)}>{COURIER_STATUS_LABELS[value]}</Link>
        ))}
        <span className="mx-1 hidden w-px self-stretch bg-peach sm:block" aria-hidden="true" />
        {(Object.keys(COURIER_KIND_LABELS) as Kind[]).map((value) => (
          <Link key={value} href={filter({ tipo: kind === value ? null : value })} aria-current={kind === value ? "true" : undefined} className={chip(kind === value)}>{COURIER_KIND_LABELS[value]}</Link>
        ))}
      </nav>

      {couriers.length === 0 && <p className={`${card} text-center text-coffee-soft`}>Nenhum entregador com esse filtro.</p>}
      <ul className="grid gap-3 lg:grid-cols-2">
        {couriers.map((courier) => (
          <li key={courier.id} data-testid="admin-courier" className={card}>
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-xl">{courier.full_name}</h2>
                <p className="text-sm text-coffee-soft">
                  {courier.phone ? formatPhone(courier.phone) : "Sem telefone"} · {courier.city} · {VEHICLE_LABELS[courier.vehicle]}{courier.plate && ` ${courier.plate}`}
                </p>
                <p className="text-sm text-coffee-soft">{courier.document_type.toUpperCase()} {formatDocument(courier.document_type, courier.document_number)}</p>
              </div>
              <div className="flex flex-wrap gap-1 text-xs font-bold">
                <span className="rounded-full bg-cream px-2 py-1">{COURIER_KIND_LABELS[courier.kind]}</span>
                <span className={`rounded-full px-2 py-1 ${courier.status === "active" ? "bg-success text-white" : courier.status === "blocked" ? "bg-danger text-white" : "bg-peach text-brand-darker"}`}>
                  {COURIER_STATUS_LABELS[courier.status]}
                </span>
                {courier.status === "active" && <span className="rounded-full bg-cream px-2 py-1">{courier.available ? "Disponível" : "Parado"}</span>}
              </div>
            </header>

            <p className="text-sm">
              {courier.deliveries} entrega{courier.deliveries === 1 ? "" : "s"} concluída{courier.deliveries === 1 ? "" : "s"} · {courier.carrying} em andamento ·{" "}
              a receber <strong>{formatCents(courier.to_receive)}</strong> · já repassado {formatCents(courier.received)}
            </p>
            {courier.blocked_reason && <p className="text-sm font-semibold text-danger">Motivo do bloqueio: {courier.blocked_reason}</p>}
            <ResetPasswordForm profileId={courier.id} />

            <div className="flex flex-wrap items-start gap-2">
              {courier.status === "pending" && (
                <form action={approveCourier}>
                  <input type="hidden" name="id" value={courier.id} />
                  <Button type="submit" className={small} aria-label={`Aprovar ${courier.full_name}`}>Aprovar</Button>
                </form>
              )}
              <form action={setCourierKind}>
                <input type="hidden" name="id" value={courier.id} />
                <input type="hidden" name="kind" value={courier.kind === "platform" ? "partner" : "platform"} />
                <Button type="submit" variant="secondary" className={small} aria-label={`Tornar ${courier.full_name} ${courier.kind === "platform" ? "parceiro" : "entregador do Chegô"}`}>
                  Tornar {courier.kind === "platform" ? "parceiro" : "do Chegô"}
                </Button>
              </form>
              {courier.to_receive > 0 && (
                <ActionForm action={payCourier}>
                  <input type="hidden" name="id" value={courier.id} />
                  <SubmitButton variant="secondary" className={small}>Marcar repasse de {formatCents(courier.to_receive)}</SubmitButton>
                </ActionForm>
              )}
            </div>

            {courier.status === "blocked" ? (
              <ActionForm action={setCourierBlocked}>
                <input type="hidden" name="id" value={courier.id} />
                <SubmitButton variant="secondary" className={small}>Desbloquear</SubmitButton>
              </ActionForm>
            ) : (
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-danger underline">Bloquear entregador</summary>
                <ActionForm action={setCourierBlocked} className="mt-1 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={courier.id} />
                  <input type="hidden" name="block" value="1" />
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">
                    Motivo
                    <input name="reason" required maxLength={300} className={inputClass} />
                  </label>
                  <SubmitButton variant="secondary" className={small}>Bloquear</SubmitButton>
                </ActionForm>
              </details>
            )}
          </li>
        ))}
      </ul>

      <ActionForm action={createPlatformCourier} resetOnSuccess className={`${card} max-w-2xl`}>
        <h2 className="text-xl">Cadastrar entregador do Chegô</h2>
        <p className="text-sm text-coffee-soft">Para quem trabalha direto para a plataforma. Já entra aprovado e usa o telefone para entrar.</p>
        <Field label="Nome completo" name="fullName" required maxLength={80} />
        <Field label="Telefone com DDD" name="phone" type="tel" required placeholder="(82) 90000-0000" />
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Cidade
          <select name="cityId" required defaultValue={cities.length === 1 ? cities[0].id : ""} className={inputClass}>
            <option value="" disabled>Escolha</option>
            {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
          </select>
        </label>
        <DocumentField />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Como faz as entregas
            <select name="vehicle" defaultValue="motorcycle" className={inputClass}>
              {Object.entries(VEHICLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <Field label="Placa (moto ou carro)" name="plate" maxLength={8} className="uppercase" />
        </div>
        <SubmitButton className="self-start">Cadastrar entregador</SubmitButton>
      </ActionForm>
    </div>
  );
}
