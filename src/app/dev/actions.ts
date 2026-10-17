"use server";

import { execFile } from "node:child_process";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { homeFor } from "@/lib/auth/home";
import { createSession, type UserRole } from "@/lib/auth/session";
import { placeOrder } from "@/lib/checkout/place-order";
import { cartInputSchema } from "@/lib/checkout/quote";
import { now, setSimulatedNow } from "@/lib/clock";
import { sql } from "@/lib/db";
import { databaseUrl, isLocalEnv } from "@/lib/env";
import { buildMockWebhook } from "@/lib/payments/mock";
import { handlePaymentWebhook } from "@/lib/payments/webhook";
import { runScheduledTasks } from "@/lib/tasks/run";

// Toda ação aqui é um atalho de teste e se recusa a rodar em qualquer lugar
// que não seja o ambiente de testes.
function assertLocal() {
  if (!isLocalEnv) throw new Error("Not available outside the test environment.");
}

const uuid = z.uuid();

export async function loginAs(formData: FormData) {
  assertLocal();
  const profileId = uuid.parse(formData.get("profileId"));

  const [profile] = await sql<{ id: string; role: UserRole }[]>`
    select id, role from profiles where id = ${profileId} and deleted_at is null`;
  if (!profile) throw new Error("Test user not found.");

  await createSession(profile.id);
  redirect(homeFor(profile.role));
}

export async function setClock(formData: FormData) {
  assertLocal();
  // O campo é uma data e hora local de Maceió, que é UTC-3 o ano todo.
  const value = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).parse(formData.get("datetime"));
  await setSimulatedNow(new Date(`${value}:00-03:00`));
  revalidatePath("/dev");
}

export async function resetClock() {
  assertLocal();
  await setSimulatedNow(null);
  revalidatePath("/dev");
}

const EVENT_TYPES = {
  approve: "payment.approved",
  decline: "payment.declined",
  expire: "payment.expired",
} as const;

/**
 * Faz o papel do banco: o gateway de mentira manda um webhook assinado para
 * o pagamento do pedido, exatamente o caminho que um gateway de verdade vai usar.
 */
export async function simulatePayment(formData: FormData) {
  assertLocal();
  const orderId = uuid.parse(formData.get("orderId"));
  const outcome = z.enum(["approve", "decline", "expire"]).parse(formData.get("outcome"));
  const back = z.string().regex(/^\/(?!\/)/).max(200).optional().parse(formData.get("back") ?? undefined);

  const [payment] = await sql<{ provider_payment_id: string }[]>`
    select provider_payment_id from payments
    where order_id = ${orderId} and status in ('pending', 'declined')
    order by created_at desc limit 1`;

  if (payment) {
    const { rawBody, signature } = buildMockWebhook(payment.provider_payment_id, EVENT_TYPES[outcome]);
    await handlePaymentWebhook(rawBody, signature);
  }

  revalidatePath("/dev");
  if (!back) return;
  // "Voltar" para a página de pagamento de um pedido que não está mais esperando
  // mostraria conteúdo velho: vai direto para a página de acompanhamento.
  const [order] = await sql<{ status: string }[]>`select status from orders where id = ${orderId}`;
  if (order?.status !== "awaiting_payment") redirect(`/pedidos/${orderId}`);
  revalidatePath(back);
}

// ---------------------------------------- tarefas, pedido aleatório, reset

export type DevState = { error?: string; ok?: boolean; message?: string };

/** Roda todas as tarefas agendadas agora, no horário atual (talvez simulado). */
export async function runTasksNow(): Promise<DevState> {
  assertLocal();
  const report = await runScheduledTasks(await now());
  const done = Object.entries(report)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name.replaceAll("_", " ")}: ${count}`);
  revalidatePath("/dev");
  return { ok: true, message: done.length > 0 ? `Tarefas rodadas. ${done.join(" · ")}.` : "Tarefas rodadas. Nada estava pendente." };
}

/** Cria um pedido pago de um cliente aleatório numa loja aberta agora, para testar o painel da loja. */
export async function generateRandomOrder(): Promise<DevState> {
  assertLocal();
  const at = await now();

  const products = await sql<{ id: string; store_id: string; store_name: string; price_cents: number; min_order_cents: number; is_market: boolean }[]>`
    select p.id, p.store_id, s.name as store_name, p.price_cents, s.min_order_cents, c.slug = 'mercado' as is_market
    from products p
    join stores s on s.id = p.store_id
    join categories c on c.id = s.category_id
    join cities ci on ci.id = s.city_id and ci.active
    where s.status = 'active' and p.deleted_at is null and p.available and p.price_cents > 0
      and not p.requires_age_check and p.min_lead_minutes = 0 and p.max_per_order is null
      and (not p.track_stock or p.stock_qty > 10)
      and not exists (select 1 from product_option_groups g where g.product_id = p.id and (g.required or g.min_choices > 0))
      and not exists (select 1 from product_availability a where a.product_id = p.id)
    order by random() limit 30`;
  const customers = await sql<{ id: string; full_name: string; phone: string | null; birth_date: string | null; city_id: string | null; address_id: string }[]>`
    select p.id, p.full_name, p.phone, p.birth_date::text, p.city_id, a.id as address_id
    from profiles p join addresses a on a.profile_id = p.id and a.is_default and a.deleted_at is null
    where p.role = 'customer' and p.blocked_at is null and p.deleted_at is null
    order by random()`;
  if (customers.length === 0) return { error: "Nenhum cliente de teste com endereço. Rode npm run db:reset." };

  let lastReason = "Nenhuma loja aberta agora.";
  for (const [index, product] of products.entries()) {
    const customer = customers[index % customers.length];
    const quantity = Math.max(1, Math.ceil(product.min_order_cents / product.price_cents));
    for (const fulfillment of ["delivery", "pickup"] as const) {
      const result = await placeOrder(
        cartInputSchema.parse({
          storeId: product.store_id, fulfillment, addressId: customer.address_id, paymentMethod: "pix",
          missingItemPolicy: product.is_market ? "call" : null,
          items: [{ key: "dev", productId: product.id, quantity, notes: "", picks: [] }],
        }),
        { id: customer.id, fullName: customer.full_name, phone: customer.phone, role: "customer", blocked: false, birthDate: customer.birth_date, cityId: customer.city_id },
        at,
      );
      if (!result.ok) {
        lastReason = result.errors[0] ?? lastReason;
        continue;
      }
      // Pagando pelo app, o gateway de mentira aprova; direto à loja o pedido já chegou nela.
      if (result.providerPaymentId) {
        const { rawBody, signature } = buildMockWebhook(result.providerPaymentId, "payment.approved");
        await handlePaymentWebhook(rawBody, signature);
      }
      revalidatePath("/dev");
      return { ok: true, message: `Pedido criado: ${customer.full_name} na ${product.store_name}. Veja no painel da loja.` };
    }
  }
  return { error: `Não deu para criar o pedido. ${lastReason} Ajuste o relógio simulado para um horário com lojas abertas.` };
}

/** Apaga o banco e carrega os dados de teste de novo. Todo mundo é desconectado. */
export async function resetDatabase(_previous: DevState, formData: FormData): Promise<DevState> {
  assertLocal();
  if (formData.get("confirm") !== "on") return { error: "Marque a caixa para confirmar. Isso apaga tudo o que você testou." };

  const database = new URL(databaseUrl()).pathname.slice(1);
  await new Promise<void>((resolve, reject) => {
    execFile(process.execPath, ["scripts/db.ts", "reset"], { env: { ...process.env, CHEGO_DB: database }, cwd: process.cwd() }, (error) =>
      error ? reject(error) : resolve());
  });
  redirect("/dev");
}
