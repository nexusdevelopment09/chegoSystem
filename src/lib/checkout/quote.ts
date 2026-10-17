import "server-only";
import { z } from "zod";
import type { CurrentProfile } from "@/lib/auth/session";
import { productStatus } from "@/lib/catalog/availability";
import { loadProducts, type ProductDetail } from "@/lib/catalog/queries";
import { describeOptions, resolveSelection, toSnapshot, type ResolvedGroup } from "@/lib/catalog/selection";
import { validateCoupon, type CouponRules } from "@/lib/coupons/validate";
import { sql } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { computeTotals, courierFee, type DiscountPayer, type Totals } from "@/lib/orders/totals";
import { paymentCollection, type PaymentCollection } from "@/lib/payments/collection";
import { formatWeight, weightPriceCents } from "@/lib/catalog/weight";
import { getSettings } from "@/lib/settings";
import { storeAvailability, type Shift, type StoreSchedule } from "@/lib/stores/hours";
import { canOrderNow, isValidSlot, scheduleSlots, type ScheduleRules, type Slot } from "./schedule";

// Tudo o que o navegador envia sobre uma sacola. Preços nunca fazem parte,
// a não ser como "o que me mostraram", para avisar o cliente quando algo mudou.
export const cartInputSchema = z.object({
  storeId: z.uuid(),
  items: z
    .array(z.object({
      key: z.string().max(80),
      productId: z.uuid(),
      quantity: z.number().int().min(1).max(99),
      notes: z.string().max(140).default(""),
      picks: z.array(z.object({ groupId: z.uuid(), optionId: z.uuid(), quantity: z.number().int().min(1).max(20) })).max(40),
      expectedUnitPriceCents: z.number().int().min(0).optional(),
    }))
    .min(1)
    .max(60),
  fulfillment: z.enum(["delivery", "pickup"]).default("delivery"),
  addressId: z.uuid().nullish(),
  scheduledFor: z.iso.datetime().nullish(),
  couponCode: z.string().trim().max(30).nullish(),
  ageConfirmed: z.boolean().default(false),
  missingItemPolicy: z.enum(["call", "substitute", "remove"]).nullish(),
  notes: z.string().trim().max(300).default(""),
  // Pagando direto à loja: Pix da loja, cartão na entrega ou dinheiro. Pelo app: Pix ou cartão.
  paymentMethod: z.enum(["pix", "card", "cash"]).default("pix"),
  /** Dinheiro: para quanto o cliente precisa de troco, em centavos. */
  cashChangeForCents: z.number().int().positive().max(1_000_000).nullish(),
});

export type CartInput = z.infer<typeof cartInputSchema>;

export type QuoteLine = {
  key: string;
  productId: string;
  name: string;
  /** Vendido por peso: porção em gramas (a quantidade conta porções). */
  weightStepGrams: number | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  lines: string[];
  notes: string;
  requiresAgeCheck: boolean;
  /** Por que esta linha não pode ser pedida, se for o caso. */
  error: string | null;
  /** O preço é diferente do que o cliente viu ao adicionar. */
  priceChanged: boolean;
};

export type Quote = {
  ok: boolean;
  /** Motivos pelos quais o pedido não pode ser feito do jeito que está. */
  errors: string[];
  /** O que o cliente deve saber antes de pagar (um preço mudou...). */
  warnings: string[];
  store: { id: string; name: string; slug: string; isMarket: boolean };
  lines: QuoteLine[];
  totals: Totals;
  minOrderCents: number;
  missingForMinCents: number;
  fulfillment: "delivery" | "pickup";
  delivery: { available: boolean; reason: string | null; feeCents: number; neighborhoodName: string | null };
  pickupAvailable: boolean;
  requiresAgeCheck: boolean;
  orderNow: { allowed: boolean; reason: string | null };
  slots: Slot[];
  estimateMinutes: number;
  coupon: { code: string; ok: boolean; message: string; discountCents: number } | null;
  /** Como o cliente pode pagar este pedido. */
  payment: { collection: PaymentCollection; methods: ("pix" | "card" | "cash")[] };
};

/** O que fechar o pedido exige além da cotação mostrada ao cliente. */
export type QuoteInternals = {
  resolved: Map<string, { product: ProductDetail; groups: ResolvedGroup[] }>;
  cityId: string;
  commissionRate: number;
  /** Quem entrega este pedido e quanto o entregador da rede ganha (0 quando a loja entrega). */
  deliveryProvider: "store" | "platform";
  courierFeeCents: number;
  neighborhoodId: string | null;
  address: AddressRow | null;
  coupon: { id: string | null; paidBy: DiscountPayer; referrerId: string | null } | null;
  when: Date;
};

type AddressRow = {
  id: string; street: string; number: string; reference: string | null; complement: string | null;
  neighborhood_id: string; neighborhood_name: string; is_rural: boolean; city_name: string; state: string;
};

type StoreRow = {
  id: string; name: string; slug: string; city_id: string; category_id: string; category_slug: string;
  status: "active" | "paused"; manual_state: "auto" | "open" | "closed"; paused_until: Date | null;
  prep_time_minutes: number; busy_extra_minutes: number; min_order_cents: number;
  offers_delivery: boolean; offers_pickup: boolean; accepts_scheduled: boolean;
  schedule_min_lead_minutes: number; schedule_max_days: number;
  same_day_cutoff: string | null; delivery_window_start: string | null; delivery_window_end: string | null;
  commission_rate: string; delivery_provider: "store" | "platform"; maintenance_mode: boolean;
  accepts_pix: boolean; accepts_card: boolean; accepts_cash: boolean; shifts: Shift[]; closures: { startsAt: string; endsAt: string }[];
};

const UNAVAILABLE = "Essa loja não está mais disponível.";

function ageOn(birthDate: string, at: Date): number {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  const local = new Date(at.getTime() - 3 * 60 * 60 * 1000);
  let age = local.getUTCFullYear() - birth.getUTCFullYear();
  const hadBirthday =
    local.getUTCMonth() > birth.getUTCMonth() ||
    (local.getUTCMonth() === birth.getUTCMonth() && local.getUTCDate() >= birth.getUTCDate());
  if (!hadBirthday) age -= 1;
  return age;
}

/**
 * Recalcula a sacola inteira a partir do banco: todo preço, desconto, taxa
 * e total. `mode: "place"` também exige o que só é preciso para pedir de
 * verdade (ter entrado, endereço escolhido, idade confirmada...).
 */
export async function buildQuote(
  input: CartInput,
  profile: CurrentProfile | null,
  at: Date,
  options: { mode: "preview" | "place"; fallbackNeighborhoodId?: string | null },
): Promise<{ quote: Quote; internals: QuoteInternals } | { fatal: string }> {
  const [store] = await sql<StoreRow[]>`
    select s.id, s.name, s.slug, s.city_id, s.category_id, c.slug as category_slug, s.status, s.manual_state,
           s.paused_until, s.prep_time_minutes, s.busy_extra_minutes, s.min_order_cents, s.offers_delivery,
           s.offers_pickup, s.accepts_scheduled, s.schedule_min_lead_minutes, s.schedule_max_days,
           s.same_day_cutoff::text, s.delivery_window_start::text, s.delivery_window_end::text,
           sp.commission_rate, s.delivery_provider, ci.maintenance_mode, s.accepts_pix, s.accepts_card, s.accepts_cash,
           coalesce((select json_agg(json_build_object('weekday', h.weekday, 'opensAt', h.opens_at::text,
             'closesAt', h.closes_at::text, 'pickupOnly', h.pickup_only)) from store_hours h where h.store_id = s.id), '[]') as shifts,
           coalesce((select json_agg(json_build_object('startsAt', cl.starts_at, 'endsAt', cl.ends_at))
             from store_closures cl where cl.store_id = s.id and cl.ends_at > ${at}), '[]') as closures
    from stores s
    join categories c on c.id = s.category_id
    join cities ci on ci.id = s.city_id and ci.active
    join store_private sp on sp.store_id = s.id
    where s.id = ${input.storeId} and s.status in ('active', 'paused')`;
  if (!store) return { fatal: UNAVAILABLE };
  if (store.maintenance_mode) return { fatal: "O Chegô está em manutenção nesta cidade. Volta já já." };

  const errors: string[] = [];
  const warnings: string[] = [];
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  const when = scheduledFor ?? at;

  const schedule: StoreSchedule = {
    status: store.status, manualState: store.manual_state, pausedUntil: store.paused_until, shifts: store.shifts,
    closures: store.closures.map((closure) => ({ startsAt: new Date(closure.startsAt), endsAt: new Date(closure.endsAt) })),
  };
  const rules: ScheduleRules = {
    acceptsScheduled: store.accepts_scheduled, minLeadMinutes: store.schedule_min_lead_minutes,
    maxDays: store.schedule_max_days, sameDayCutoff: store.same_day_cutoff,
    windowStart: store.delivery_window_start, windowEnd: store.delivery_window_end,
  };

  // ------------------------------------------------------------------- itens
  const products = await loadProducts([...new Set(input.items.map((item) => item.productId))]);
  const resolved: QuoteInternals["resolved"] = new Map();
  const quantityByProduct = new Map<string, number>();
  for (const item of input.items) {
    quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? 0) + item.quantity);
  }

  const lines = input.items.map((item): QuoteLine => {
    const product = products.get(item.productId);
    const base = {
      key: item.key, productId: item.productId, name: product?.name ?? "Item indisponível", quantity: item.quantity,
      weightStepGrams: product?.weightStepGrams ?? null,
      unitPriceCents: 0, lineTotalCents: 0, lines: [] as string[], notes: item.notes,
      requiresAgeCheck: product?.requiresAgeCheck ?? false, priceChanged: false,
    };
    if (!product || product.storeId !== store.id) return { ...base, error: "Este item não está mais disponível." };

    const selection = resolveSelection(product.priceCents, product.groups, item.picks);
    if (!selection.ok) return { ...base, error: selection.error };

    // Por peso (sem opções): a linha custa o preço do quilo × gramas, arredondado só no fim.
    const grams = product.weightStepGrams ? item.quantity * product.weightStepGrams : null;
    const byWeight = grams !== null && product.pricePerKgCents !== null && product.groups.length === 0;
    const priced = {
      ...base,
      unitPriceCents: selection.unitPriceCents,
      lineTotalCents: byWeight ? weightPriceCents(product.pricePerKgCents!, grams!) : selection.unitPriceCents * item.quantity,
      lines: describeOptions(toSnapshot(selection.groups)),
      priceChanged: item.expectedUnitPriceCents !== undefined && item.expectedUnitPriceCents !== selection.unitPriceCents,
    };

    const status = productStatus(product.rules, when);
    if (!status.orderable) return { ...priced, error: status.reason === "sold_out" ? "Esgotou" : status.note };
    if (grams !== null && product.weightMinGrams && grams < product.weightMinGrams) {
      return { ...priced, error: `O mínimo deste produto é ${formatWeight(product.weightMinGrams)}.` };
    }
    if (product.maxPerOrder && quantityByProduct.get(product.id)! > product.maxPerOrder) {
      return { ...priced, error: `Máximo de ${product.maxPerOrder} por pedido.` };
    }
    if (product.rules.trackStock && quantityByProduct.get(product.id)! > (product.rules.stockQty ?? 0)) {
      return { ...priced, error: `Só temos ${product.rules.stockQty} em estoque.` };
    }

    resolved.set(item.key, { product, groups: selection.groups });
    return { ...priced, error: null };
  });

  for (const line of lines) {
    if (line.error) errors.push(`${line.name}: ${line.error}`);
    else if (line.priceChanged) warnings.push(`O preço de “${line.name}” mudou para ${formatCents(line.unitPriceCents)}.`);
  }
  const subtotalCents = lines.filter((line) => !line.error).reduce((total, line) => total + line.lineTotalCents, 0);

  // --------------------------------------------------- entrega ou retirada
  let address: AddressRow | null = null;
  if (profile && input.addressId) {
    [address] = await sql<AddressRow[]>`
      select a.id, a.street, a.number, a.reference, a.complement, a.neighborhood_id, n.name as neighborhood_name,
             n.is_rural, c.name as city_name, c.state
      from addresses a
      join neighborhoods n on n.id = a.neighborhood_id
      join cities c on c.id = n.city_id
      where a.id = ${input.addressId} and a.profile_id = ${profile.id} and a.deleted_at is null`;
  }
  const neighborhoodId = address?.neighborhood_id ?? options.fallbackNeighborhoodId ?? null;
  const [area] = neighborhoodId
    ? await sql<{ delivery_fee_cents: number; max_minutes: number; name: string }[]>`
        select a.delivery_fee_cents, a.max_minutes, n.name
        from store_delivery_areas a join neighborhoods n on n.id = a.neighborhood_id
        where a.store_id = ${store.id} and a.neighborhood_id = ${neighborhoodId}`
    : [];
  const [hood] = neighborhoodId && !area
    ? await sql<{ name: string }[]>`select name from neighborhoods where id = ${neighborhoodId}`
    : [];
  const neighborhoodName = area?.name ?? hood?.name ?? null;

  const availabilityThen = storeAvailability({ ...schedule, manualState: scheduledFor ? "auto" : schedule.manualState }, when);
  let deliveryReason: string | null = null;
  if (!store.offers_delivery) deliveryReason = "Essa loja só faz retirada no balcão.";
  else if (availabilityThen.pickupOnly) deliveryReason = "Nesse dia a loja só faz retirada no balcão.";
  else if (neighborhoodId && !area) deliveryReason = `Essa loja ainda não entrega em ${neighborhoodName}.`;
  const deliveryAvailable = deliveryReason === null;

  const fulfillment = input.fulfillment;
  if (fulfillment === "delivery" && !deliveryAvailable) errors.push(deliveryReason!);
  if (fulfillment === "pickup" && !store.offers_pickup) errors.push("Essa loja não faz retirada no balcão.");
  const deliveryFeeCents = fulfillment === "delivery" && area ? area.delivery_fee_cents : 0;

  // ------------------------------------------------------------- horário
  const madeToOrder = [...resolved.values()].map(({ product }) => product.rules.minLeadMinutes).filter((minutes) => minutes > 0);
  const slots = scheduleSlots(rules, schedule, at, Math.max(0, ...madeToOrder));
  const nowCheck = canOrderNow(rules, schedule, at, madeToOrder.length > 0);

  if (scheduledFor) {
    if (!isValidSlot(slots, scheduledFor)) errors.push("Esse horário não está mais disponível. Escolha outro.");
  } else if (!nowCheck.allowed) {
    errors.push(nowCheck.reason);
  }

  // ------------------------------------------------------------ mínimo
  const missingForMinCents = Math.max(0, store.min_order_cents - subtotalCents);
  if (missingForMinCents > 0) {
    errors.push(`Faltam ${formatCents(missingForMinCents)} para o pedido mínimo de ${formatCents(store.min_order_cents)}.`);
  }

  // ------------------------------------------------------------- cupom
  let couponView: Quote["coupon"] = null;
  let couponInternal: QuoteInternals["coupon"] = null;
  let discount = { productCents: 0, deliveryCents: 0, paidBy: null as DiscountPayer | null };
  const code = input.couponCode?.toUpperCase() || null;

  if (code) {
    if (!profile) {
      couponView = { code, ok: false, message: "Entre na sua conta para usar cupom", discountCents: 0 };
    } else {
      const found = await findCoupon(code, profile.id);
      const [stats] = await sql<{ paid_orders: number; uses: number }[]>`
        select
          (select count(*)::int from orders where customer_id = ${profile.id} and paid_at is not null) as paid_orders,
          (select count(*)::int from coupon_redemptions where customer_id = ${profile.id} and coupon_id = ${found?.id ?? null}) as uses`;
      const result = validateCoupon(found?.rules ?? null, {
        now: at, customerId: profile.id, customerPaidOrders: stats.paid_orders, customerUses: stats.uses,
        subtotalCents, deliveryFeeCents, storeId: store.id, categoryId: store.category_id, cityId: store.city_id,
      });
      if (result.ok) {
        discount = { productCents: result.productDiscountCents, deliveryCents: result.deliveryDiscountCents, paidBy: result.paidBy };
        couponInternal = { id: found!.id, paidBy: result.paidBy, referrerId: found!.referrerId };
        couponView = { code, ok: true, message: "Cupom aplicado", discountCents: result.productDiscountCents + result.deliveryDiscountCents };
      } else {
        couponView = { code, ok: false, message: result.message, discountCents: 0 };
        if (options.mode === "place") errors.push(result.message);
      }
    }
  }

  // ---------------------------------------------------- quem está comprando
  const requiresAgeCheck = lines.some((line) => !line.error && line.requiresAgeCheck);
  if (requiresAgeCheck && profile?.birthDate && ageOn(profile.birthDate, at) < 18) {
    errors.push("Bebidas alcoólicas só podem ser vendidas para maiores de 18 anos.");
  }
  if (profile?.blocked) errors.push("Sua conta está bloqueada para novos pedidos. Fale com o suporte.");

  const isMarket = store.category_slug === "mercado";
  if (options.mode === "place") {
    if (!profile) errors.push("Entre na sua conta para fazer o pedido.");
    if (fulfillment === "delivery" && !address) errors.push("Oxe, faltou o endereço.");
    if (requiresAgeCheck && !input.ageConfirmed) errors.push("Confirme que você tem 18 anos ou mais.");
    if (isMarket && !input.missingItemPolicy) errors.push("Diga o que fazer se faltar um item.");
  }

  const settings = await getSettings();
  // Retirada no balcão não tem entregador; só a entrega pode ser da rede do Chegô.
  const deliveryProvider = fulfillment === "delivery" ? store.delivery_provider : "store";

  // Pagando direto à loja, todo o dinheiro do pedido (inclusive a entrega) fica com a loja:
  // o Chegô não cobra taxa de serviço nem comissão do pedido. A loja paga ao Chegô uma
  // taxa fixa por pedido concluído, à parte (src/lib/fees/), e paga o entregador da rede.
  const collection = paymentCollection();
  const direct = collection === "store";
  const commissionRate = direct ? 0 : Number(store.commission_rate);
  const totals = computeTotals({
    deliveryBy: direct ? "store" : deliveryProvider,
    subtotalCents, deliveryFeeCents, serviceFeeCents: direct ? 0 : settings.service_fee_cents,
    commissionRate,
    productDiscountCents: discount.productCents, deliveryDiscountCents: discount.deliveryCents,
    discountPaidBy: discount.paidBy,
  });

  // Formas de pagamento: as que a loja aceita. Dinheiro não vale quando quem entrega é a
  // rede do Chegô, porque o entregador ficaria com o dinheiro da loja sem prestação de contas.
  const methods: ("pix" | "card" | "cash")[] = direct
    ? [
        ...(store.accepts_pix ? ["pix" as const] : []),
        ...(store.accepts_card ? ["card" as const] : []),
        ...(store.accepts_cash && deliveryProvider !== "platform" ? ["cash" as const] : []),
      ]
    : ["pix", "card"];
  if (options.mode === "place") {
    if (!methods.includes(input.paymentMethod)) errors.push("Essa forma de pagamento não está disponível para este pedido.");
    if (direct && input.paymentMethod === "cash" && input.cashChangeForCents && input.cashChangeForCents < totals.totalCents) {
      errors.push("O troco precisa ser para um valor maior que o total do pedido.");
    }
  }
  if (methods.length === 0) errors.push("Esta loja ainda não informou como recebe os pagamentos.");

  return {
    quote: {
      ok: errors.length === 0, errors: [...new Set(errors)], warnings,
      store: { id: store.id, name: store.name, slug: store.slug, isMarket },
      lines, totals, minOrderCents: store.min_order_cents, missingForMinCents, fulfillment,
      delivery: { available: deliveryAvailable, reason: deliveryReason, feeCents: area?.delivery_fee_cents ?? 0, neighborhoodName },
      pickupAvailable: store.offers_pickup,
      requiresAgeCheck,
      orderNow: { allowed: nowCheck.allowed, reason: nowCheck.allowed ? null : nowCheck.reason },
      slots,
      estimateMinutes: store.prep_time_minutes + store.busy_extra_minutes + (fulfillment === "delivery" ? area?.max_minutes ?? 0 : 0),
      coupon: couponView,
      payment: { collection, methods },
    },
    internals: {
      resolved, cityId: store.city_id, commissionRate, deliveryProvider,
      courierFeeCents: deliveryProvider === "platform" ? courierFee(deliveryFeeCents, settings.courier_fee_percent) : 0,
      neighborhoodId: fulfillment === "delivery" ? neighborhoodId : null, address, coupon: couponInternal, when,
    },
  };
}

type FoundCoupon = { id: string | null; rules: CouponRules; referrerId: string | null };

/** Um cupom pelo código, ou o código de indicação de um amigo usado como cupom de primeira compra. */
async function findCoupon(code: string, customerId: string): Promise<FoundCoupon | null> {
  const [row] = await sql<{
    id: string; code: string; type: CouponRules["type"]; value_cents: number | null; percent: string | null;
    max_discount_cents: number | null; paid_by: DiscountPayer; owner_profile_id: string | null;
    starts_at: Date | null; expires_at: Date | null; max_uses: number | null; uses_count: number;
    max_uses_per_customer: number; min_order_cents: number; first_order_only: boolean;
    store_ids: string[]; category_ids: string[]; city_ids: string[]; active: boolean;
  }[]>`select * from coupons where code = ${code}`;

  if (row) {
    return {
      id: row.id, referrerId: null,
      rules: {
        code: row.code, type: row.type, valueCents: row.value_cents, percent: row.percent === null ? null : Number(row.percent),
        maxDiscountCents: row.max_discount_cents, paidBy: row.paid_by, ownerProfileId: row.owner_profile_id,
        startsAt: row.starts_at, expiresAt: row.expires_at, maxUses: row.max_uses, usesCount: row.uses_count,
        maxUsesPerCustomer: row.max_uses_per_customer, minOrderCents: row.min_order_cents,
        firstOrderOnly: row.first_order_only, storeIds: row.store_ids, categoryIds: row.category_ids,
        cityIds: row.city_ids, active: row.active,
      },
    };
  }

  // "Indique e ganhe": o código de um amigo vale uma vez, na primeira compra.
  const [referrer] = await sql<{ id: string }[]>`
    select id from profiles where referral_code = ${code} and id <> ${customerId} and deleted_at is null`;
  if (!referrer) return null;
  const [already] = await sql`select 1 from referrals where referred_id = ${customerId}`;
  if (already) return null;

  const settings = await getSettings();
  return {
    id: null, referrerId: referrer.id,
    rules: {
      code, type: "fixed", valueCents: settings.referral_referred_cents, percent: null, maxDiscountCents: null,
      paidBy: "platform", ownerProfileId: null, startsAt: null, expiresAt: null, maxUses: null, usesCount: 0,
      maxUsesPerCustomer: 1, minOrderCents: 0, firstOrderOnly: true, storeIds: [], categoryIds: [], cityIds: [], active: true,
    },
  };
}
