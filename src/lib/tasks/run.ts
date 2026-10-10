import "server-only";
import { randomInt } from "node:crypto";
import { sql } from "@/lib/db";
import { adminIds, notify, storeStaffIds } from "@/lib/notifications/notify";
import { transitionOrder } from "@/lib/orders/transitions";
import { getSettings } from "@/lib/settings";
import { recalculateRating } from "@/lib/stores/rating";
import { DAY_MS, MINUTE_MS, toLocal } from "@/lib/time";

// Tarefas agendadas. Todas são idempotentes: rodar duas vezes seguidas (ou
// duas cópias ao mesmo tempo) não muda nada na segunda vez. No ambiente de
// testes elas rodam a cada minuto e pela página /dev; em produção um
// agendador chama /api/tarefas.

export type TaskReport = Record<string, number>;

/** Esta pessoa já foi avisada disto sobre este pedido? Evita que os lembretes se repitam. */
const alreadyNotified = (type: string) => sql`
  exists (select 1 from notifications n where n.order_id = o.id and n.type = ${type})`;

/** Pedidos não pagos que passaram do prazo do Pix expiram; estoque e cupom voltam. */
async function expireUnpaid(at: Date): Promise<number> {
  const due = await sql<{ id: string }[]>`
    select id from orders where status = 'awaiting_payment' and payment_expires_at <= ${at}`;
  let done = 0;
  for (const { id } of due) {
    await sql.begin(async (tx) => {
      const [order] = await tx`select id from orders where id = ${id} and status = 'awaiting_payment' for update`;
      if (!order) return;
      await tx`update payments set status = 'expired' where order_id = ${id} and status in ('pending', 'declined')`;
      await transitionOrder(tx, { orderId: id, to: "expired", actor: "system", actorId: null, at, reason: "Pagamento não feito no prazo" });
      done += 1;
    });
  }
  return done;
}

/** "Seu Pix vai expirar em 3 minutos." */
async function warnPixExpiring(at: Date): Promise<number> {
  const soon = new Date(at.getTime() + 3 * MINUTE_MS);
  const orders = await sql<{ id: string; customer_id: string }[]>`
    select o.id, o.customer_id from orders o
    where o.status = 'awaiting_payment' and o.payment_method = 'pix'
      and o.payment_expires_at > ${at} and o.payment_expires_at <= ${soon}
      and not ${alreadyNotified("pix_expiring")}`;
  for (const order of orders) {
    await notify({
      profileIds: [order.customer_id], type: "pix_expiring", title: "Seu Pix vai expirar em 3 minutos",
      body: "Pague agora para a loja receber seu pedido.", link: `/pedidos/${order.id}/pagamento`, orderId: order.id, channels: ["push"], at,
    });
  }
  return orders.length;
}

/** Pedidos pagos que ninguém aceitou: primeiro um alerta mais forte, depois recusa automática com reembolso total. */
async function watchAcceptance(at: Date): Promise<{ alerted: number; rejected: number }> {
  const settings = await getSettings();
  const alertBefore = new Date(at.getTime() - settings.acceptance_alert_minutes * MINUTE_MS);
  const rejectBefore = new Date(at.getTime() - settings.auto_reject_minutes * MINUTE_MS);

  const late = await sql<{ id: string; code: string; store_id: string }[]>`
    select o.id, o.code, o.store_id from orders o
    where o.status = 'paid' and o.paid_at <= ${alertBefore} and o.paid_at > ${rejectBefore}
      and not ${alreadyNotified("order_no_accept")}`;
  for (const order of late) {
    await sql.begin(async (tx) => {
      await notify({
        profileIds: await storeStaffIds(order.store_id, tx, ["owner"]), type: "order_no_accept", title: "Pedido esperando aceite!",
        body: `O pedido ${order.code} está esperando há ${settings.acceptance_alert_minutes} minutos. Se ninguém aceitar, ele será recusado.`,
        link: "/lojista/pedidos", orderId: order.id, channels: ["push", "sms"], at,
      }, tx);
      await notify({
        profileIds: await adminIds(tx), type: "order_no_accept_admin", title: "Loja não aceitou um pedido ainda",
        body: `Pedido ${order.code} sem aceite há ${settings.acceptance_alert_minutes} minutos.`, link: `/admin/pedidos/${order.id}`, orderId: order.id, at,
      }, tx);
    });
  }

  const expired = await sql<{ id: string }[]>`select id from orders where status = 'paid' and paid_at <= ${rejectBefore}`;
  let rejected = 0;
  for (const { id } of expired) {
    await sql.begin(async (tx) => {
      const [order] = await tx`select id from orders where id = ${id} and status = 'paid' for update`;
      if (!order) return;
      await transitionOrder(tx, { orderId: id, to: "rejected", actor: "system", actorId: null, at, reason: "A loja não respondeu a tempo" });
      rejected += 1;
    });
  }
  return { alerted: late.length, rejected };
}

/** Uma hora depois da entrega, pede uma avaliação (uma vez, e só enquanto ainda dá para avaliar). */
async function remindReviews(at: Date): Promise<number> {
  const settings = await getSettings();
  const orders = await sql<{ id: string; customer_id: string; store_name: string }[]>`
    select o.id, o.customer_id, s.name as store_name
    from orders o join stores s on s.id = o.store_id
    where o.status in ('delivered', 'picked_up')
      and o.completed_at <= ${new Date(at.getTime() - 60 * MINUTE_MS)}
      and o.completed_at > ${new Date(at.getTime() - settings.review_window_days * DAY_MS)}
      and not exists (select 1 from reviews r where r.order_id = o.id)
      and not ${alreadyNotified("review_reminder")}`;
  for (const order of orders) {
    await notify({
      profileIds: [order.customer_id], type: "review_reminder", title: "Como foi seu pedido?",
      body: `Conta pra gente como foi na ${order.store_name}. Leva um minutinho.`, link: `/pedidos/${order.id}`, orderId: order.id, channels: ["push"], at,
    });
  }
  return orders.length;
}

/** "Indique e ganhe": quando o primeiro pedido do amigo convidado é entregue, quem convidou ganha um cupom. */
async function rewardReferrals(at: Date): Promise<number> {
  const settings = await getSettings();
  const pending = await sql<{ id: string; referrer_id: string; order_id: string }[]>`
    select r.id, r.referrer_id,
           (select o.id from orders o where o.customer_id = r.referred_id and o.status in ('delivered', 'picked_up') order by o.completed_at limit 1) as order_id
    from referrals r
    where r.rewarded_at is null
      and exists (select 1 from orders o where o.customer_id = r.referred_id and o.status in ('delivered', 'picked_up'))`;

  let done = 0;
  for (const referral of pending) {
    await sql.begin(async (tx) => {
      const [locked] = await tx`select id from referrals where id = ${referral.id} and rewarded_at is null for update`;
      if (!locked) return;
      const code = `INDICOU-${randomInt(100000, 999999)}`;
      const [coupon] = await tx<{ id: string }[]>`
        insert into coupons (code, description, type, value_cents, paid_by, owner_profile_id, max_uses)
        values (${code}, 'Obrigado por indicar o Chegô!', 'fixed', ${settings.referral_referrer_cents}, 'platform', ${referral.referrer_id}, 1)
        returning id`;
      await tx`update referrals set rewarded_at = ${at}, referrer_coupon_id = ${coupon.id}, first_order_id = ${referral.order_id} where id = ${referral.id}`;
      await notify({
        profileIds: [referral.referrer_id], type: "referral_reward", title: "Seu cupom de indicação chegou!",
        body: `Quem você indicou fez o primeiro pedido. Use o cupom ${code}.`, link: "/perfil", channels: ["push"], at,
      }, tx);
      done += 1;
    });
  }
  return done;
}

/** Faturas mensais: uma por loja e por mês, nunca para lojas fundadoras ainda no período grátis. */
async function runInvoices(at: Date): Promise<{ created: number; overdue: number }> {
  const today = toLocal(at).date;
  const month = `${today.slice(0, 7)}-01`;
  const created = await sql<{ id: string; store_id: string }[]>`
    insert into invoices (store_id, subscription_id, period_start, period_end, amount_cents, status, due_date, created_at)
    select sub.store_id, sub.id, ${month}::date, (${month}::date + interval '1 month' - interval '1 day')::date,
           p.monthly_price_cents, 'open', (${month}::date + interval '9 days')::date, ${at}
    from store_subscriptions sub
    join subscription_plans p on p.id = sub.plan_id
    join stores s on s.id = sub.store_id
    where sub.active and s.status in ('active', 'paused') and p.monthly_price_cents > 0
      and (sub.free_until is null or sub.free_until < ${month}::date)
    on conflict (store_id, period_start) do nothing
    returning id, store_id`;
  for (const invoice of created) {
    await notify({
      profileIds: await storeStaffIds(invoice.store_id, sql, ["owner"]), type: "invoice_created", title: "Sua fatura do Chegô chegou",
      body: "A mensalidade deste mês já está disponível no painel.", link: "/lojista/financeiro", channels: ["email"], at,
    });
  }

  // Um dia depois do vencimento a fatura passa a vencida e o dono é avisado.
  const overdue = await sql<{ id: string; store_id: string }[]>`
    update invoices set status = 'overdue' where status = 'open' and due_date < ${today}::date returning id, store_id`;
  for (const invoice of overdue) {
    await notify({
      profileIds: await storeStaffIds(invoice.store_id, sql, ["owner"]), type: "invoice_overdue", title: "Sua fatura do Chegô venceu",
      body: "Pague pelo painel para manter a loja no ar.", link: "/lojista/financeiro", channels: ["email"], at,
    });
  }
  return { created: created.length, overdue: overdue.length };
}

/** Banners e destaques pagos que chegaram à data de fim. */
async function endExpiredPromotions(at: Date): Promise<number> {
  const banners = await sql`update banners set active = false where active and ends_at is not null and ends_at <= ${at} returning id`;
  const featured = await sql`update stores set featured_until = null where featured_until is not null and featured_until <= ${at} returning id`;
  return banners.length + featured.length;
}

/** As notas das lojas seguem os últimos 180 dias, então são atualizadas conforme o tempo passa. */
async function refreshRatings(at: Date): Promise<number> {
  const stores = await sql<{ id: string }[]>`select id from stores where status in ('active', 'paused')`;
  for (const store of stores) await recalculateRating(sql, store.id, at);
  return stores.length;
}

/** Roda tudo o que está na hora em `at` e informa quanto cada tarefa fez. */
export async function runScheduledTasks(at: Date): Promise<TaskReport> {
  const expired = await expireUnpaid(at);
  const pixWarnings = await warnPixExpiring(at);
  const acceptance = await watchAcceptance(at);
  const reviewReminders = await remindReviews(at);
  const referralRewards = await rewardReferrals(at);
  const invoices = await runInvoices(at);
  const promotionsEnded = await endExpiredPromotions(at);
  const ratings = await refreshRatings(at);
  // As mensagens do pedido fecham duas horas depois da entrega por uma regra conferida a cada
  // leitura e escrita (chatOpen), então não há nada para desligar aqui.

  return {
    pedidos_expirados: expired,
    avisos_pix_expirando: pixWarnings,
    alertas_sem_aceite: acceptance.alerted,
    recusas_automaticas: acceptance.rejected,
    lembretes_de_avaliacao: reviewReminders,
    cupons_de_indicacao: referralRewards,
    faturas_geradas: invoices.created,
    faturas_vencidas: invoices.overdue,
    promocoes_encerradas: promotionsEnded,
    notas_recalculadas: ratings,
  };
}
