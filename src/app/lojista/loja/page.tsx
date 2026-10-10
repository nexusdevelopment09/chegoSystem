import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Button } from "@/components/ui/Button";
import { Field, fileInputClass, inputClass } from "@/components/ui/Field";
import { sql } from "@/lib/db";
import { formatDateTime, formatPhone } from "@/lib/format";
import { STORE_ROLE_LABELS } from "@/lib/labels";
import { getMerchantContext, getTeam } from "@/lib/merchant/context";
import { WEEKDAY_NAMES } from "@/lib/time";
import { addClosure, deleteClosure, inviteMember, removeMember, saveAreas, saveHours, saveStore } from "../owner-actions";

export const metadata: Metadata = { title: "Minha loja" };

const check = "size-5 shrink-0 accent-brand-dark";
const card = "flex flex-col gap-3 rounded-card bg-white p-4 ring-1 ring-peach";
const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export default function StoreSettingsPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-card bg-peach" aria-busy="true" />}>
      <StoreSettings />
    </Suspense>
  );
}

async function StoreSettings() {
  const { profile, store, at } = await getMerchantContext(["owner"]);

  const [[details], hours, closures, hoods, team] = await Promise.all([
    sql<{
      description: string; min_order_cents: number; offers_delivery: boolean; offers_pickup: boolean; accepts_scheduled: boolean;
      schedule_min_lead_minutes: number; schedule_max_days: number; same_day_cutoff: string | null;
      delivery_window_start: string | null; delivery_window_end: string | null; pizza_pricing: string;
      delivery_provider: "store" | "platform";
    }[]>`
      select description, min_order_cents, offers_delivery, offers_pickup, accepts_scheduled, schedule_min_lead_minutes,
             schedule_max_days, same_day_cutoff::text, delivery_window_start::text, delivery_window_end::text, pizza_pricing,
             delivery_provider
      from stores where id = ${store.id}`,
    sql<{ weekday: number; opens_at: string; closes_at: string; pickup_only: boolean }[]>`
      select weekday, opens_at::text, closes_at::text, pickup_only from store_hours where store_id = ${store.id} order by weekday, opens_at`,
    sql<{ id: string; starts_at: Date; ends_at: Date; reason: string | null }[]>`
      select id, starts_at, ends_at, reason from store_closures where store_id = ${store.id} and ends_at > ${at} order by starts_at`,
    sql<{ id: string; name: string; is_rural: boolean; fee: number | null; min: number | null; max: number | null }[]>`
      select n.id, n.name, n.is_rural, a.delivery_fee_cents as fee, a.min_minutes as min, a.max_minutes as max
      from neighborhoods n
      join stores s on s.city_id = n.city_id and s.id = ${store.id}
      left join store_delivery_areas a on a.neighborhood_id = n.id and a.store_id = s.id
      where n.active order by n.is_rural, n.name`,
    getTeam(store.id),
  ]);
  const hhmm = (value: string | null) => value?.slice(0, 5) ?? "";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-3xl">Minha loja</h1>

      <ActionForm action={saveStore} className={card}>
        <h2 className="text-xl">Dados e funcionamento</h2>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Descrição curta
          <textarea name="description" maxLength={300} rows={2} defaultValue={details.description} className={`${inputClass} py-3 font-normal`} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">Logo<input type="file" name="logo" accept="image/jpeg,image/png,image/webp" className={fileInputClass} /></label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">Capa<input type="file" name="cover" accept="image/jpeg,image/png,image/webp" className={fileInputClass} /></label>
          <Field label="Tempo de preparo (min)" name="prepMinutes" type="number" min={0} max={600} required defaultValue={store.prepMinutes} />
          <Field label="Pedido mínimo (R$)" name="minOrder" inputMode="decimal" defaultValue={money(details.min_order_cents)} hint="Não conta a taxa de entrega." />
        </div>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="offersDelivery" defaultChecked={details.offers_delivery} className={check} /> Faz entrega</label>
        <fieldset className="flex flex-col gap-2 rounded-2xl bg-cream p-3">
          <legend className="text-sm font-semibold">Quem faz a entrega</legend>
          <label className="flex min-h-11 items-start gap-3">
            <input type="radio" name="deliveryProvider" value="store" defaultChecked={details.delivery_provider === "store"} className={`${check} mt-1`} />
            <span><strong>Meu entregador</strong><span className="block text-sm text-coffee-soft">A loja entrega com a própria equipe e fica com a taxa de entrega.</span></span>
          </label>
          <label className="flex min-h-11 items-start gap-3">
            <input type="radio" name="deliveryProvider" value="platform" defaultChecked={details.delivery_provider === "platform"} className={`${check} mt-1`} />
            <span><strong>Entregadores do Chegô</strong><span className="block text-sm text-coffee-soft">Um entregador da rede do Chegô busca o pedido na loja. A taxa de entrega paga o entregador e não entra no seu extrato.</span></span>
          </label>
          <p className="text-sm text-coffee-soft">A mudança vale para os próximos pedidos. Os que já foram feitos continuam como estavam.</p>
        </fieldset>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="offersPickup" defaultChecked={details.offers_pickup} className={check} /> Aceita retirada no balcão</label>

        <fieldset className="grid gap-3 rounded-2xl bg-cream p-3 sm:grid-cols-2">
          <legend className="text-sm font-semibold">Pedidos agendados</legend>
          <label className="flex min-h-11 items-center gap-3 sm:col-span-2"><input type="checkbox" name="acceptsScheduled" defaultChecked={details.accepts_scheduled} className={check} /> Aceita pedido agendado</label>
          <Field label="Antecedência mínima (min)" name="scheduleLeadMinutes" type="number" min={0} defaultValue={details.schedule_min_lead_minutes} />
          <Field label="Agendar até quantos dias à frente" name="scheduleMaxDays" type="number" min={0} max={60} defaultValue={details.schedule_max_days} />
          <Field label="Pedidos do dia até (ex.: 11:00)" name="cutoff" type="time" defaultValue={hhmm(details.same_day_cutoff)} hint="Deixe em branco se não há horário limite." />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Entregas das" name="windowStart" type="time" defaultValue={hhmm(details.delivery_window_start)} />
            <Field label="às" name="windowEnd" type="time" defaultValue={hhmm(details.delivery_window_end)} />
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Pizza com mais de um sabor
            <select name="pizzaPricing" defaultValue={details.pizza_pricing} className={inputClass}>
              <option value="highest">Cobrar o sabor mais caro</option>
              <option value="average">Cobrar a média dos sabores</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Impressora térmica
            <select name="printerWidth" defaultValue={String(store.printerWidth)} className={inputClass}>
              <option value="80">80 mm</option>
              <option value="58">58 mm</option>
            </select>
          </label>
        </div>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" name="autoPrint" defaultChecked={store.autoPrint} className={check} /> Imprimir sozinho ao aceitar o pedido</label>
        <SubmitButton className="self-start">Salvar dados da loja</SubmitButton>
      </ActionForm>

      <ActionForm action={saveHours} className={card}>
        <h2 className="text-xl">Horários</h2>
        <p className="text-sm text-coffee-soft">Até dois turnos por dia. Se fechar depois da meia-noite, é só colocar a hora (ex.: 18:00 às 02:00). Dia em branco = fechado.</p>
        <div className="flex flex-col gap-2">
          {WEEKDAY_NAMES.map((name, weekday) => {
            const shifts = hours.filter((row) => row.weekday === weekday);
            return (
              <fieldset key={name} className="grid grid-cols-2 items-end gap-2 rounded-2xl bg-cream p-2 sm:grid-cols-[6rem_1fr_1fr_1fr_1fr_auto]">
                <legend className="sr-only">{name}</legend>
                <span className="col-span-2 font-semibold capitalize sm:col-span-1">{name}</span>
                {[0, 1].map((index) => (
                  <div key={index} className="col-span-2 grid grid-cols-2 gap-2">
                    <label className="flex flex-col text-xs font-semibold">{index === 0 ? "Abre" : "2º turno abre"}
                      <input type="time" name={`open-${weekday}-${index + 1}`} defaultValue={hhmm(shifts[index]?.opens_at ?? null)} aria-label={`${name}: ${index === 0 ? "abre" : "segundo turno abre"}`} className={inputClass} />
                    </label>
                    <label className="flex flex-col text-xs font-semibold">Fecha
                      <input type="time" name={`close-${weekday}-${index + 1}`} defaultValue={hhmm(shifts[index]?.closes_at ?? null)} aria-label={`${name}: ${index === 0 ? "fecha" : "segundo turno fecha"}`} className={inputClass} />
                    </label>
                  </div>
                ))}
                <label className="col-span-2 flex min-h-11 items-center gap-2 text-sm sm:col-span-1">
                  <input type="checkbox" name={`pickup-${weekday}`} defaultChecked={shifts.some((shift) => shift.pickup_only)} className={check} /> Só retirada
                </label>
              </fieldset>
            );
          })}
        </div>
        <SubmitButton className="self-start">Salvar horários</SubmitButton>
      </ActionForm>

      <section className={card}>
        <h2 className="text-xl">Feriados e fechamentos especiais</h2>
        {closures.length === 0 && <p className="text-sm text-coffee-soft">Nenhum fechamento marcado.</p>}
        <ul className="flex flex-col gap-2">
          {closures.map((closure) => (
            <li key={closure.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream px-3 py-2">
              <span>{formatDateTime(closure.starts_at)} até {formatDateTime(closure.ends_at)}{closure.reason && ` · ${closure.reason}`}</span>
              <form action={deleteClosure}>
                <input type="hidden" name="id" value={closure.id} />
                <Button type="submit" variant="secondary" className="min-h-11 px-3 text-sm">Remover</Button>
              </form>
            </li>
          ))}
        </ul>
        <ActionForm action={addClosure} resetOnSuccess className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <Field label="De" name="from" type="date" required />
          <Field label="Até" name="to" type="date" />
          <Field label="Motivo" name="reason" maxLength={100} placeholder="Feriado municipal" />
          <SubmitButton variant="secondary" className="min-h-12">Adicionar</SubmitButton>
        </ActionForm>
      </section>

      <ActionForm action={saveAreas} className={card}>
        <h2 className="text-xl">Áreas de entrega e taxas</h2>
        <p className="text-sm text-coffee-soft">Marque onde a loja entrega. Cada bairro ou comunidade tem a sua taxa e o seu tempo.</p>
        <div className="flex flex-col gap-2">
          {hoods.map((hood) => (
            <fieldset key={hood.id} className="grid grid-cols-3 items-end gap-2 rounded-2xl bg-cream p-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
              <label className="col-span-3 flex min-h-11 items-center gap-2 font-semibold sm:col-span-1">
                <input type="checkbox" name={`serve-${hood.id}`} defaultChecked={hood.fee !== null} className={check} />
                {hood.name}{hood.is_rural && <span className="text-sm font-normal text-coffee-soft">(zona rural)</span>}
              </label>
              <label className="flex flex-col text-xs font-semibold">Taxa (R$)<input name={`fee-${hood.id}`} inputMode="decimal" defaultValue={hood.fee === null ? "" : money(hood.fee)} aria-label={`Taxa de entrega em ${hood.name}`} className={inputClass} /></label>
              <label className="flex flex-col text-xs font-semibold">Mín. (min)<input name={`min-${hood.id}`} type="number" min={0} defaultValue={hood.min ?? ""} aria-label={`Tempo mínimo em ${hood.name}`} className={inputClass} /></label>
              <label className="flex flex-col text-xs font-semibold">Máx. (min)<input name={`max-${hood.id}`} type="number" min={0} defaultValue={hood.max ?? ""} aria-label={`Tempo máximo em ${hood.name}`} className={inputClass} /></label>
            </fieldset>
          ))}
        </div>
        <SubmitButton className="self-start">Salvar áreas de entrega</SubmitButton>
      </ActionForm>

      <section className={card}>
        <h2 className="text-xl">Usuários da loja</h2>
        <ul className="flex flex-col gap-2">
          {team.map((member) => (
            <li key={member.id} data-testid="team-member" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream px-3 py-2">
              <span>
                <strong>{member.name || "Ainda não entrou"}</strong> · {STORE_ROLE_LABELS[member.role]}
                {member.phone && <span className="block text-sm text-coffee-soft">{formatPhone(member.phone)}</span>}
              </span>
              {member.role !== "owner" && member.id !== profile.id && (
                <form action={removeMember}>
                  <input type="hidden" name="profileId" value={member.id} />
                  <Button type="submit" variant="secondary" className="min-h-11 px-3 text-sm" aria-label={`Remover ${member.name || "pessoa"} da equipe`}>Remover</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <ActionForm action={inviteMember} resetOnSuccess className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <Field label="Nome" name="name" maxLength={80} />
          <Field label="Telefone com DDD" name="phone" type="tel" required placeholder="(82) 90000-0000" />
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Papel
            <select name="role" defaultValue="attendant" className={inputClass}>
              <option value="attendant">Atendente (pedidos e cardápio)</option>
              <option value="courier">Entregador (só as entregas dele)</option>
            </select>
          </label>
          <SubmitButton variant="secondary" className="min-h-12">Convidar</SubmitButton>
        </ActionForm>
        <p className="text-sm text-coffee-soft">A pessoa entra no Chegô com esse telefone e já cai no painel da loja.</p>
      </section>
    </div>
  );
}
