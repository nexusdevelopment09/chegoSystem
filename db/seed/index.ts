// Dois seeds. `seed` (padrão do `npm run db:reset` e dos testes) cria a cidade de
// demonstração completa, com lojas, pessoas e pedidos fictícios: nunca rodar em produção.
// `seedBase` (SEED_MODE=base, usado no servidor) cria só o necessário, sem nada fictício.
// Tudo aqui é fictício. O mesmo número de semente sempre produz as mesmas
// lojas, cardápios e histórico de pedidos.
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { hashPassword } from "../../src/lib/auth/password.ts";
import { itemUnitPriceCents, type ChosenGroup, type PriceMode } from "../../src/lib/catalog/pricing.ts";
import { completeCnpj, completeCpf } from "../../src/lib/documents.ts";
import { computeTotals, courierFee, refundLedgerLines, refundShares, saleLedgerLines } from "../../src/lib/orders/totals.ts";
import { BANNERS, bannerImageUrl, generateImages, productImageUrl, storeCoverUrl, storeLogoUrl } from "./images.ts";
import { STORES, type ProductDef, type StoreDef } from "./menus.ts";
import { tagDemoTaxonomy } from "./demo-taxonomy.ts";
import { syncTaxonomy } from "./taxonomy.ts";
import {
  BAD_COMMENTS, CATEGORIES, COURIERS, CUSTOMERS, GOOD_COMMENTS, NEIGHBOR_CITY, OK_COMMENTS,
  OWNER_NAMES, REJECT_REASONS, REPLIES, RURAL, URBAN, type CustomerDef,
} from "./people.ts";

type Row = Record<string, unknown>;

const SERVICE_FEE_CENTS = 99;
const HISTORY_ORDERS = 400;
const HISTORY_DAYS = 90;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- auxiliares

/** Pequeno gerador aleatório determinístico (mulberry32). */
function createRandom(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const chance = (probability: number) => next() < probability;
  const weighted = <T>(list: readonly T[], weight: (item: T) => number): T => {
    const total = list.reduce((sum, item) => sum + weight(item), 0);
    let target = next() * total;
    for (const item of list) {
      target -= weight(item);
      if (target < 0) return item;
    }
    return list[list.length - 1];
  };
  const sample = <T>(list: readonly T[], count: number): T[] => {
    const pool = [...list];
    const chosen: T[] = [];
    while (chosen.length < count && pool.length > 0) {
      chosen.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
    }
    return chosen;
  };
  return { next, int, pick, chance, weighted, sample };
}

// Maceió é UTC-3 o ano todo (sem horário de verão).
const UTC_OFFSET_HOURS = 3;
const START = new Date();
const today = new Date(START.getTime() - UTC_OFFSET_HOURS * HOUR);

/** Um momento `daysAgo` dias atrás (negativo = futuro) às HH:MM, no horário de Maceió. */
function localTime(daysAgo: number, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo,
    hours + UTC_OFFSET_HOURS, minutes,
  ));
}
const weekdayOf = (daysAgo: number) => localTime(daysAgo, "12:00").getUTCDay();
const isoDate = (date: Date) => new Date(date.getTime() - UTC_OFFSET_HOURS * HOUR).toISOString().slice(0, 10);
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

async function insert(sql: Sql, table: string, rows: Row[]) {
  for (let index = 0; index < rows.length; index += 400) {
    await sql`insert into ${sql(table)} ${sql(rows.slice(index, index + 400) as never)}`;
  }
}

// ---------------------------------------------------------- mundo em memória

type SeedOption = { id: string; name: string; priceCents: number; available: boolean };
type SeedLink = {
  groupName: string; mode: PriceMode; free: number; min: number; max: number;
  required: boolean; options: SeedOption[];
};
type SeedProduct = { id: string; def: ProductDef; links: SeedLink[] };
type Area = { fee: number; min: number; max: number };
type SeedStore = {
  id: string; def: StoreDef; ownerId: string; courierId: string | null;
  cityId: string; products: SeedProduct[]; areas: Map<string, Area>;
};
type SeedCustomer = { id: string; def: CustomerDef; phone: string; neighborhoodId: string; address: Row };
type CouponUse = { id: string; code: string; paidBy: "platform" | "store"; productCents?: number; percent?: number; maxCents?: number; freeDelivery?: boolean };

type FinalStatus =
  | "awaiting_payment" | "expired" | "paid" | "accepted" | "preparing" | "ready"
  | "out_for_delivery" | "done" | "rejected" | "cancelled" | "refunded" | "partially_refunded";

type BuiltOrder = {
  id: string; createdAt: Date; status: string; storeId: string; customerId: string;
  completedAt: Date | null; order: Row; totalCents: number;
};

// ------------------------------------------------- base (vai para produção)

/** Configurações, recursos ligados e desligados e os textos legais (ainda provisórios). */
async function insertPlatform(sql: Sql) {
  await insert(sql, "platform_settings", [
    { key: "service_fee_cents", value: sql.json(SERVICE_FEE_CENTS), description: "Taxa de serviço fixa por pedido, em centavos" },
    { key: "default_commission_rate", value: sql.json(0.1), description: "Comissão padrão de novas lojas" },
    { key: "pix_expiration_minutes", value: sql.json(15), description: "Minutos até o Pix expirar" },
    { key: "acceptance_alert_minutes", value: sql.json(8), description: "Minutos sem aceite até o alerta forte" },
    { key: "auto_reject_minutes", value: sql.json(15), description: "Minutos sem aceite até a recusa automática" },
    { key: "review_window_days", value: sql.json(7), description: "Dias para avaliar depois da entrega" },
    { key: "referral_referred_cents", value: sql.json(500), description: "Cupom de quem foi indicado" },
    { key: "referral_referrer_cents", value: sql.json(500), description: "Cupom de quem indicou" },
  ]);

  await insert(sql, "feature_flags", [
    { key: "cash_on_delivery", enabled: false, description: "Pagamento em dinheiro na entrega" },
    { key: "order_chat", enabled: true, description: "Mensagens entre cliente e loja no pedido" },
    { key: "card_payments", enabled: true, description: "Pagamento com cartão de crédito" },
  ]);

  const legalIds = { terms: randomUUID(), merchant_terms: randomUUID(), privacy: randomUUID() };
  await insert(sql, "legal_documents", [
    { id: legalIds.terms, type: "terms", version: 1, title: "Termos de Uso", content: "[TEXTO PROVISÓRIO] Termos de Uso do Chegô.", published_at: plus(START, -120 * DAY) },
    { id: legalIds.merchant_terms, type: "merchant_terms", version: 1, title: "Termos do Lojista", content: "[TEXTO PROVISÓRIO] Termos do Lojista do Chegô.", published_at: plus(START, -120 * DAY) },
    { id: legalIds.privacy, type: "privacy", version: 1, title: "Política de Privacidade", content: "[TEXTO PROVISÓRIO] Política de Privacidade do Chegô.", published_at: plus(START, -120 * DAY) },
  ]);
  return legalIds;
}

/** Segmentos e subcategorias (os mesmos de produção, ver taxonomy.ts). */
async function insertCategories(sql: Sql) {
  return syncTaxonomy(sql);
}

async function insertPlans(sql: Sql) {
  const plans = { basic: randomUUID(), featured: randomUUID() };
  await insert(sql, "subscription_plans", [
    { id: plans.basic, name: "Básico", monthly_price_cents: 4990 },
    { id: plans.featured, name: "Destaque", monthly_price_cents: 9990 },
  ]);
  return plans;
}

export type BaseAdmin = { name: string; email: string; password: string };

/**
 * Seed de produção: só o que o sistema precisa para funcionar, sem nenhuma loja,
 * pessoa ou pedido fictício. Joaquim Gomes começa com o bairro Centro; os outros
 * bairros e comunidades reais são cadastrados pelo admin em Cadastros.
 */
export async function seedBase(sql: Sql, admin: BaseAdmin) {
  const images = await generateImages({ categoriesOnly: true });
  if (images.written > 0) console.log(`  ${images.written} imagens de segmentos geradas em storage/`);

  const legalIds = await insertPlatform(sql);
  const cityId = randomUUID();
  await insert(sql, "cities", [
    { id: cityId, name: "Joaquim Gomes", state: "AL", slug: "joaquim-gomes", order_code_prefix: "JG", active: true },
  ]);
  await insert(sql, "neighborhoods", [{ id: randomUUID(), city_id: cityId, name: "Centro", is_rural: false }]);
  await insertCategories(sql);
  await insertPlans(sql);

  const adminId = randomUUID();
  await insert(sql, "profiles", [{
    id: adminId, full_name: admin.name, phone: null, email: admin.email.toLowerCase(), role: "admin",
    password_hash: hashPassword(admin.password), city_id: cityId, accepted_terms_at: START,
  }]);
  await insert(sql, "legal_acceptances", [
    { profile_id: adminId, document_id: legalIds.terms, accepted_at: START },
    { profile_id: adminId, document_id: legalIds.privacy, accepted_at: START },
  ]);
  console.log(`  base criada: Joaquim Gomes (bairro Centro), ${CATEGORIES.length} categorias, planos e o admin ${admin.email}`);
}

// ----------------------------------------- demonstração (testes e este computador)

/** Senha de todos os usuários de teste, para entrar com telefone e senha. */
export const DEMO_PASSWORD = "123456";

export async function seed(sql: Sql) {
  const random = createRandom(20261009);
  const adminId = randomUUID();
  const demoPasswordHash = hashPassword(DEMO_PASSWORD);

  const images = await generateImages();
  if (images.written > 0) console.log(`  ${images.written} imagens geradas em storage/`);

  const legalIds = await insertPlatform(sql);

  // ------------------------------------------------------------------ lugares

  const cityId = randomUUID();
  const neighborCityId = randomUUID();
  await insert(sql, "cities", [
    { id: cityId, name: "Joaquim Gomes", state: "AL", slug: "joaquim-gomes", order_code_prefix: "JG", active: true },
    { id: neighborCityId, name: "Cidade Vizinha Teste", state: "AL", slug: "cidade-vizinha-teste", order_code_prefix: "CV", active: false },
  ]);

  const hoodIds = new Map<string, string>();
  const neighborHoodIds = new Map<string, string>();
  await insert(sql, "neighborhoods", [
    ...URBAN.map((hood) => ({ id: remember(hoodIds, hood.name), city_id: cityId, name: hood.name, is_rural: false })),
    ...RURAL.map((hood) => ({ id: remember(hoodIds, hood.name), city_id: cityId, name: hood.name, is_rural: true })),
    ...NEIGHBOR_CITY.map((hood) => ({ id: remember(neighborHoodIds, hood.name), city_id: neighborCityId, name: hood.name, is_rural: false })),
  ]);

  const categoryIds = await insertCategories(sql);

  // ------------------------------------------------------------------ pessoas

  const profiles: Row[] = [];
  const profile = (fields: { name: string; phone: string; role: string } & Row) => {
    const id = (fields.id as string | undefined) ?? randomUUID();
    const { name, ...rest } = fields;
    profiles.push({
      email: null, password_hash: demoPasswordHash, birth_date: null, referral_code: null,
      blocked_at: null, blocked_reason: null, city_id: cityId,
      ...rest, id, full_name: name, accepted_terms_at: plus(START, -100 * DAY),
    });
    return id;
  };

  profile({ id: adminId, name: "Admin Chegô", phone: "+5582900000000", role: "admin", email: "admin@chego.local", password_hash: hashPassword("admin") });

  const ownerIds = STORES.map((store, index) =>
    profile({
      name: OWNER_NAMES[index], phone: `+55829100000${String(index + 1).padStart(2, "0")}`, role: "merchant",
      city_id: store.city === "neighbor" ? neighborCityId : cityId,
    }),
  );
  const pizzaAttendantId = profile({ name: "Juliana Peixoto", phone: "+5582920000001", role: "merchant" });
  const marketAttendantId = profile({ name: "Cícero Vieira", phone: "+5582920000002", role: "merchant" });
  const pizzaCourierId = profile({ name: "Robson Entregas", phone: "+5582930000001", role: "merchant" });

  // Entregadores da rede do Chegô: +55 82 95000-00NN.
  const courierRows: Row[] = COURIERS.map((def, index) => {
    const id = profile({ name: def.name, phone: `+55829500000${String(index + 1).padStart(2, "0")}`, role: "courier" });
    return {
      profile_id: id, kind: def.kind, status: def.status, city_id: cityId, document_type: "cpf",
      document_number: completeCpf(String(310200300 + index * 7919)), vehicle: def.vehicle, plate: def.plate,
      available: def.available, approved_at: def.status === "pending" ? null : plus(START, -60 * DAY),
      blocked_reason: def.status === "blocked" ? "Duas entregas não concluídas sem aviso" : null,
      created_at: plus(START, -70 * DAY),
    };
  });
  const networkCourierIds = courierRows.filter((row) => row.status === "active").map((row) => row.profile_id as string);
  const jonasId = courierRows[COURIERS.findIndex((def) => def.name === "Jonas Ferreira")].profile_id as string;

  const customers = new Map<string, SeedCustomer>();
  const seventeenYearsAgo = new Date(Date.UTC(today.getUTCFullYear() - 17, today.getUTCMonth() - 3, 15));
  CUSTOMERS.forEach((def, index) => {
    const phone = `+55829400000${String(index + 1).padStart(2, "0")}`;
    const id = profile({
      name: def.name, phone, role: "customer",
      referral_code: `${def.key.toUpperCase()}${100 + index * 7}`,
      birth_date: def.minor ? seventeenYearsAgo.toISOString().slice(0, 10) : def.key === "ana" ? "1994-05-12" : null,
      blocked_at: def.blocked ? plus(START, -5 * DAY) : null,
      blocked_reason: def.blocked ? "Vários pedidos cancelados depois de prontos" : null,
    });
    const neighborhoodId = hoodIds.get(def.neighborhood)!;
    customers.set(def.key, {
      id, def, phone, neighborhoodId,
      address: {
        id: randomUUID(), profile_id: id, label: "Casa", street: def.street, number: def.number,
        neighborhood_id: neighborhoodId, reference: def.reference ?? null, is_default: true,
      },
    });
  });

  await insert(sql, "profiles", profiles);
  await insert(sql, "couriers", courierRows);
  await insert(sql, "addresses", [...customers.values()].map((customer) => customer.address));
  await insert(sql, "legal_acceptances", profiles.flatMap((row) => [
    { profile_id: row.id, document_id: legalIds.terms, accepted_at: row.accepted_terms_at },
    { profile_id: row.id, document_id: legalIds.privacy, accepted_at: row.accepted_terms_at },
    ...(row.role === "merchant" ? [{ profile_id: row.id, document_id: legalIds.merchant_terms, accepted_at: row.accepted_terms_at }] : []),
  ]));

  // -------------------------------------------------------------------- lojas

  const { basic: basicPlanId, featured: featuredPlanId } = await insertPlans(sql);

  const rows = {
    stores: [] as Row[], store_private: [] as Row[], store_members: [] as Row[], store_hours: [] as Row[],
    store_delivery_areas: [] as Row[], store_subscriptions: [] as Row[], product_sections: [] as Row[],
    option_groups: [] as Row[], options: [] as Row[], products: [] as Row[], product_availability: [] as Row[],
    product_option_groups: [] as Row[], product_option_prices: [] as Row[],
  };
  const stores = new Map<string, SeedStore>();
  const subscriptionIds = new Map<string, string>();

  STORES.forEach((def, storeIndex) => {
    const id = randomUUID();
    const ownerId = ownerIds[storeIndex];
    const inNeighborCity = def.city === "neighbor";
    const hoods = inNeighborCity ? neighborHoodIds : hoodIds;
    const status = def.status ?? "active";

    rows.stores.push({
      id, city_id: inNeighborCity ? neighborCityId : cityId, category_id: categoryIds.get(def.category)!,
      owner_id: ownerId, name: def.name, slug: def.slug, description: def.description,
      street: "Rua Principal", number: String(100 + storeIndex * 12), neighborhood_id: hoods.get("Centro")!,
      logo_url: storeLogoUrl(def.slug), cover_url: storeCoverUrl(def.slug), status,
      prep_time_minutes: def.prepMinutes, min_order_cents: def.minOrder,
      accepts_scheduled: Boolean(def.scheduled),
      schedule_min_lead_minutes: 60, schedule_max_days: 7,
      same_day_cutoff: def.scheduled?.cutoff ?? null,
      delivery_window_start: def.scheduled?.windowStart ?? null,
      delivery_window_end: def.scheduled?.windowEnd ?? null,
      pizza_pricing: def.pizzaPricing ?? "highest", delivery_provider: def.deliveryBy ?? "store",
      featured_until: def.featured ? plus(START, 30 * DAY) : null,
      created_at: plus(START, -110 * DAY),
    });
    rows.store_private.push({
      store_id: id, internal_phone: `+558233330${String(100 + storeIndex)}`,
      document_type: storeIndex % 3 === 0 ? "cpf" : "cnpj",
      document_number: storeIndex % 3 === 0 ? completeCpf(String(111222300 + storeIndex * 4337)) : completeCnpj(`${String(11222300 + storeIndex * 911)}0001`),
      commission_rate: def.commission, payment_recipient_id: status === "pending" ? null : `mock_recipient_${def.key}`,
      // Chave Pix fictícia (domínio de teste): o cliente vê no pedido depois do aceite.
      pix_key: `${def.key}@pix.chego.local`,
      status_reason: status === "suspended" ? "Fatura da mensalidade vencida há mais de 10 dias" : null,
      approved_at: status === "pending" ? null : plus(START, -105 * DAY),
      approved_by: status === "pending" ? null : adminId,
    });
    rows.store_members.push({ store_id: id, profile_id: ownerId, role: "owner" });

    for (const shift of def.hours) {
      for (const weekday of shift.days) {
        rows.store_hours.push({ store_id: id, weekday, opens_at: shift.open, closes_at: shift.close, pickup_only: shift.pickupOnly ?? false });
      }
    }

    const areas = new Map<string, Area>();
    const served = inNeighborCity
      ? NEIGHBOR_CITY
      : [...URBAN, ...RURAL.filter((hood) => def.areas === "all" || (Array.isArray(def.areas) && def.areas.includes(hood.name)))];
    for (const hood of served) {
      const neighborhoodId = hoods.get(hood.name)!;
      areas.set(neighborhoodId, hood);
      rows.store_delivery_areas.push({ store_id: id, neighborhood_id: neighborhoodId, delivery_fee_cents: hood.fee, min_minutes: hood.min, max_minutes: hood.max });
    }

    if (status !== "pending") {
      const subscriptionId = remember(subscriptionIds, def.key);
      rows.store_subscriptions.push({
        id: subscriptionId, store_id: id, plan_id: def.featured ? featuredPlanId : basicPlanId,
        free_until: def.founder ? isoDate(plus(START, 90 * DAY)) : null, started_at: plus(START, -105 * DAY),
      });
    }

    const sectionIds = new Map<string, string>();
    for (const product of def.products) {
      if (!sectionIds.has(product.section)) {
        rows.product_sections.push({ id: remember(sectionIds, product.section), store_id: id, name: product.section, sort_order: sectionIds.size });
      }
    }

    const groups = new Map<string, { id: string; name: string; options: (SeedOption & { defaultCents: number })[] }>();
    for (const group of def.groups ?? []) {
      const groupId = randomUUID();
      rows.option_groups.push({ id: groupId, store_id: id, name: group.name });
      const options = group.options.map((option, index) => {
        const optionId = randomUUID();
        rows.options.push({
          id: optionId, group_id: groupId, name: option.name, category_label: option.label ?? null,
          default_price_cents: option.price ?? 0, available: option.available ?? true, sort_order: index,
        });
        return { id: optionId, name: option.name, priceCents: option.price ?? 0, defaultCents: option.price ?? 0, available: option.available ?? true };
      });
      groups.set(group.key, { id: groupId, name: group.name, options });
    }

    const products: SeedProduct[] = def.products.map((product, productIndex) => {
      const productId = randomUUID();
      rows.products.push({
        id: productId, store_id: id, section_id: sectionIds.get(product.section)!, name: product.name,
        description: product.desc ?? "", price_cents: product.price,
        image_url: product.noImage ? null : productImageUrl(def.slug, product.name),
        available: product.available ?? true, featured: product.featured ?? false, sort_order: productIndex,
        min_lead_minutes: product.leadMinutes ?? 0, max_per_order: product.maxPerOrder ?? null,
        track_stock: product.stock !== undefined, stock_qty: product.stock ?? null,
        requires_age_check: product.ageCheck ?? false,
        weight_step_grams: product.weight?.step ?? null, price_per_kg_cents: product.weight?.perKg ?? null,
        weight_min_grams: product.weight?.min ?? null,
        // Os produtos chegam junto com a loja: não contam como "novidades".
        created_at: plus(START, -110 * DAY),
      });

      if (product.availability) {
        for (const weekday of product.availability.days) {
          rows.product_availability.push({
            product_id: productId, weekday,
            starts_at: product.availability.from ?? "00:00", ends_at: product.availability.to ?? "23:59:59",
          });
        }
      }

      const links: SeedLink[] = (product.groups ?? []).map((link, linkIndex) => {
        const group = groups.get(link.group);
        if (!group) throw new Error(`Grupo "${link.group}" não existe na loja ${def.name}`);
        const mode = link.mode ?? "sum";
        rows.product_option_groups.push({
          product_id: productId, group_id: group.id, required: link.required ?? false,
          min_choices: link.min ?? 0, max_choices: link.max ?? 1, allow_repeat: link.repeat ?? false,
          price_mode: mode, free_quantity: link.free ?? 0, sort_order: linkIndex,
        });
        const options = group.options.map((option) => {
          const priceCents = link.prices?.[option.name] ?? option.defaultCents;
          if (link.prices) {
            rows.product_option_prices.push({ product_id: productId, option_id: option.id, price_cents: priceCents });
          }
          return { id: option.id, name: option.name, priceCents, available: option.available };
        });
        return { groupName: group.name, mode, free: link.free ?? 0, min: link.min ?? 0, max: link.max ?? 1, required: link.required ?? false, options };
      });

      return { id: productId, def: product, links };
    });

    stores.set(def.key, {
      id, def, ownerId, courierId: def.key === "pizzaria" ? pizzaCourierId : null,
      cityId: inNeighborCity ? neighborCityId : cityId, products, areas,
    });
  });

  rows.store_members.push(
    { store_id: stores.get("pizzaria")!.id, profile_id: pizzaAttendantId, role: "attendant" },
    { store_id: stores.get("pizzaria")!.id, profile_id: pizzaCourierId, role: "courier" },
    { store_id: stores.get("mercado")!.id, profile_id: marketAttendantId, role: "attendant" },
  );

  for (const table of Object.keys(rows) as (keyof typeof rows)[]) {
    await insert(sql, table, rows[table]);
  }
  await tagDemoTaxonomy(sql);

  // A Peixaria fecha por um feriado local na semana que vem (para testar fechamentos especiais).
  await insert(sql, "store_closures", [{
    store_id: stores.get("peixaria")!.id, starts_at: localTime(-7, "00:00"), ends_at: localTime(-8, "00:00"), reason: "Feriado municipal",
  }]);

  // ------------------------------------------------------------------- cupons

  const coupons = {
    PRIMEIRA: randomUUID(), FRETEGRATIS: randomUUID(), PIZZA10: randomUUID(), VELHO: randomUUID(), ESGOTOU: randomUUID(),
  };
  const couponBase = {
    value_cents: null, percent: null, max_discount_cents: null, created_by_store_id: null, owner_profile_id: null,
    starts_at: plus(START, -100 * DAY), expires_at: null, max_uses: null, min_order_cents: 0, first_order_only: false,
  };
  await insert(sql, "coupons", [
    { ...couponBase, id: coupons.PRIMEIRA, code: "PRIMEIRA", description: "R$ 10,00 de desconto na primeira compra", type: "fixed", value_cents: 1000, paid_by: "platform", min_order_cents: 3000, first_order_only: true },
    { ...couponBase, id: coupons.FRETEGRATIS, code: "FRETEGRATIS", description: "Frete grátis acima de R$ 50,00", type: "free_delivery", paid_by: "platform", min_order_cents: 5000, max_uses_per_customer: 100 },
    { ...couponBase, id: coupons.PIZZA10, code: "PIZZA10", description: "10% na Pizzaria Forno de Barro", type: "percent", percent: 10, max_discount_cents: 1500, paid_by: "store", created_by_store_id: stores.get("pizzaria")!.id, max_uses_per_customer: 100 },
    { ...couponBase, id: coupons.VELHO, code: "VELHO", description: "Cupom expirado", type: "fixed", value_cents: 500, paid_by: "platform", expires_at: plus(START, -10 * DAY) },
    { ...couponBase, id: coupons.ESGOTOU, code: "ESGOTOU", description: "Cupom com limite de uso atingido", type: "fixed", value_cents: 500, paid_by: "platform", max_uses: 5, max_uses_per_customer: 100 },
  ].map((coupon) => ({ max_uses_per_customer: 1, ...coupon })));
  await sql`update coupons set store_ids = array[${stores.get("pizzaria")!.id}]::uuid[] where id = ${coupons.PIZZA10}`;

  await insert(sql, "banners", BANNERS.map((banner, index) => ({
    city_id: cityId, title: banner.title, image_url: bannerImageUrl(banner.key),
    link_url: index === 1 ? "/loja/pizzaria-forno-de-barro" : index === 2 ? "/loja/acai-tropical" : null,
    starts_at: plus(START, -10 * DAY), ends_at: plus(START, 60 * DAY), sort_order: index,
  })));

  // ------------------------------------------------------------------ pedidos

  const out = {
    orders: [] as Row[], order_items: [] as Row[], order_item_options: [] as Row[], order_status_history: [] as Row[],
    payments: [] as Row[], refunds: [] as Row[], ledger_entries: [] as Row[], coupon_redemptions: [] as Row[], reviews: [] as Row[],
    courier_earnings: [] as Row[],
  };
  const built: BuiltOrder[] = [];

  /** Produtos que o cliente poderia pedir naquele momento. */
  function orderable(store: SeedStore, customer: SeedCustomer, weekday: number, minutes: number, scheduled: boolean) {
    return store.products.filter(({ def }) => {
      if (def.available === false || def.stock === 0) return false;
      // Os pedidos do histórico não usam os granéis: as quantidades sorteadas não respeitariam o mínimo em gramas.
      if (def.weight) return false;
      if (def.ageCheck && customer.def.minor) return false;
      if (Boolean(def.leadMinutes) !== scheduled) return false;
      if (!def.availability) return true;
      return def.availability.days.includes(weekday)
        && minutes >= toMinutes(def.availability.from ?? "00:00")
        && minutes <= toMinutes(def.availability.to ?? "23:59");
    });
  }

  function buildOrder(input: {
    store: SeedStore; customer: SeedCustomer; createdAt: Date; final: FinalStatus;
    coupon?: CouponUse; scheduledFor?: Date; live?: boolean; forcePickup?: boolean; products?: string[];
    /** Só para lojas da rede do Chegô: o entregador da entrega, ou null para deixá-la sem entregador (oferta). */
    networkCourier?: string | null;
  }): BuiltOrder | null {
    const { store, customer, createdAt, final } = input;
    const local = new Date(createdAt.getTime() - UTC_OFFSET_HOURS * HOUR);
    const weekday = local.getUTCDay();
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();

    const candidates = input.products
      ? store.products.filter((product) => input.products!.includes(product.def.name))
      : orderable(store, customer, weekday, minutes, Boolean(input.scheduledFor));
    if (candidates.length === 0) return null;

    const isMarket = store.def.key === "mercado" || store.def.key === "farmacia";
    const chosenProducts = input.products ? candidates : random.sample(candidates, isMarket ? random.int(3, 7) : random.int(1, 3));
    const orderId = randomUUID();

    const items = chosenProducts.map((product) => {
      const groups: ChosenGroup[] = [];
      const optionRows: Row[] = [];
      const itemId = randomUUID();

      for (const link of product.links) {
        const available = link.options.filter((option) => option.available);
        const count = link.required
          ? random.int(link.min, link.max)
          : link.mode === "free_up_to"
            ? random.int(2, 5)
            : random.chance(0.35) ? random.int(1, Math.min(link.max, 2)) : 0;
        const picked = random.sample(available, Math.min(count, link.max));
        groups.push({ mode: link.mode, freeQuantity: link.free, choices: picked.map((option) => ({ priceCents: option.priceCents, quantity: 1 })) });
        for (const option of picked) {
          optionRows.push({
            order_item_id: itemId, option_id: option.id, group_name: link.groupName, option_name: option.name,
            price_mode: link.mode, quantity: 1, price_cents: option.priceCents, sort_order: optionRows.length,
          });
        }
      }

      const unitPrice = itemUnitPriceCents(product.def.price, groups);
      const quantity = product.def.maxPerOrder ? random.int(4, 10) : random.chance(0.2) ? 2 : 1;
      return { itemId, product, unitPrice, quantity, optionRows };
    });

    // Respeita o pedido mínimo da loja somando unidades do primeiro item.
    const subtotalOf = () => items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    while (subtotalOf() < store.def.minOrder && items[0].unitPrice > 0) items[0].quantity += 1;
    const subtotalCents = subtotalOf();

    const shift = store.def.hours.find((hours) => hours.days.includes(weekday));
    const area = store.areas.get(customer.neighborhoodId);
    const fulfillment = input.forcePickup || !area || shift?.pickupOnly ? "pickup" : "delivery";
    const deliveryFeeCents = fulfillment === "delivery" ? area!.fee : 0;
    // Lojas que usam a rede do Chegô: a taxa de entrega vai para o lado da plataforma, que paga o entregador.
    const byNetwork = store.def.deliveryBy === "platform" && fulfillment === "delivery";
    // Sem usar o gerador aleatório, para o resto do histórico continuar igual.
    const networkCourierId = !byNetwork ? null
      : input.networkCourier !== undefined ? input.networkCourier : networkCourierIds[out.orders.length % networkCourierIds.length];

    const coupon = input.coupon;
    const productDiscount = coupon?.productCents
      ?? (coupon?.percent ? Math.min(Math.round((subtotalCents * coupon.percent) / 100), coupon.maxCents ?? Infinity) : 0);
    const totals = computeTotals({
      subtotalCents, deliveryFeeCents, serviceFeeCents: SERVICE_FEE_CENTS, commissionRate: store.def.commission,
      productDiscountCents: productDiscount, deliveryDiscountCents: coupon?.freeDelivery ? deliveryFeeCents : 0,
      discountPaidBy: coupon?.paidBy ?? null, deliveryBy: byNetwork ? "platform" : "store",
    });
    const courierFeeCents = byNetwork ? courierFee(deliveryFeeCents, 100) : 0;

    // Linha do tempo.
    const step = (min: number, max: number) => (input.live ? random.int(1, 2) : random.int(min, max)) * MINUTE;
    const history: { status: string; at: Date; by: string | null; reason?: string }[] = [
      { status: "awaiting_payment", at: createdAt, by: customer.id },
    ];
    const stamps: Record<string, Date | null> = { paid_at: null, accepted_at: null, ready_at: null, dispatched_at: null, completed_at: null };
    let clock = createdAt;
    const advance = (status: string, ms: number, by: string | null, reason?: string) => {
      clock = plus(clock, ms);
      history.push({ status, at: clock, by, reason });
    };

    const flow = fulfillment === "delivery"
      ? ["paid", "accepted", "preparing", "ready", "out_for_delivery", "delivered"]
      : ["paid", "accepted", "preparing", "ready", "picked_up"];
    const target = final === "done" || final === "refunded" || final === "partially_refunded" ? flow[flow.length - 1] : final;

    if (final === "expired") {
      advance("expired", 15 * MINUTE, null, "Pix não pago no prazo");
    } else if (final !== "awaiting_payment") {
      for (const status of flow) {
        if (status === "paid") { advance(status, step(1, 3), null); stamps.paid_at = clock; }
        if (status === "accepted") { advance(status, step(2, 6), store.ownerId); stamps.accepted_at = clock; }
        if (status === "preparing") advance(status, step(1, 2), store.ownerId);
        if (status === "ready") { advance(status, step(store.def.prepMinutes - 5, store.def.prepMinutes + 10), store.ownerId); stamps.ready_at = clock; }
        if (status === "out_for_delivery") { advance(status, step(2, 6), networkCourierId ?? store.ownerId); stamps.dispatched_at = clock; }
        if (status === "delivered") { advance(status, step(area?.min ?? 15, area?.max ?? 30) / 2, networkCourierId ?? store.courierId ?? store.ownerId); stamps.completed_at = clock; }
        if (status === "picked_up") { advance(status, step(8, 25), store.ownerId); stamps.completed_at = clock; }
        if (status === target || ((final === "rejected" || final === "cancelled") && status === "paid")) break;
      }
      if (final === "rejected") advance("rejected", step(3, 10), store.ownerId, random.pick(REJECT_REASONS));
      if (final === "cancelled") advance("cancelled", step(1, 3), customer.id, "Cancelado pelo cliente");
    }

    // Reembolsos.
    const paymentId = randomUUID();
    let refundedCents = 0;
    const refund = (amountCents: number, reason: string, by: string | null, at: Date) => {
      const shares = refundShares(amountCents, { storeAmountCents: totals.storeAmountCents, totalCents: totals.totalCents });
      const refundId = randomUUID();
      refundedCents += amountCents;
      out.refunds.push({
        id: refundId, order_id: orderId, payment_id: paymentId, amount_cents: amountCents,
        store_share_cents: shares.storeShareCents, platform_share_cents: shares.platformShareCents,
        reason, requested_by: by, provider_refund_id: `mock_refund_${refundId.slice(0, 8)}`, created_at: at,
      });
      for (const line of refundLedgerLines(shares)) {
        out.ledger_entries.push({
          account: line.account, store_id: line.account === "store" ? store.id : null, direction: line.direction,
          amount_cents: line.amountCents, reason: line.reason, order_id: orderId, refund_id: refundId, invoice_id: null, courier_id: null, created_at: at,
        });
      }
    };

    let removedItemId: string | null = null;
    let status = history[history.length - 1].status;
    if (final === "rejected" || final === "cancelled") {
      refund(totals.totalCents, final === "rejected" ? "Pedido recusado pela loja" : "Pedido cancelado pelo cliente", null, clock);
    } else if (final === "refunded") {
      advance("refunded", random.int(1, 20) * HOUR, adminId, "Pedido chegou errado");
      refund(totals.totalCents, "Pedido chegou errado", adminId, clock);
      status = "refunded";
    } else if (final === "partially_refunded") {
      const removed = items.length > 1 ? items[items.length - 1] : null;
      const amount = Math.min(
        removed ? removed.unitPrice * removed.quantity : Math.round(totals.totalCents / 4),
        totals.totalCents - 1,
      );
      removedItemId = removed?.itemId ?? null;
      advance("partially_refunded", random.int(5, 40) * MINUTE, removed ? store.ownerId : adminId, removed ? "Item em falta" : "Item chegou danificado");
      refund(amount, removed ? "Item em falta" : "Item chegou danificado", removed ? null : adminId, clock);
      status = "partially_refunded";
    }

    const paid = stamps.paid_at !== null;
    const requiresAgeCheck = items.some((item) => item.product.def.ageCheck);
    const order: Row = {
      id: orderId, code: "", city_id: store.cityId, customer_id: customer.id, store_id: store.id, status,
      fulfillment, customer_name: customer.def.name, customer_phone: customer.phone,
      address_snapshot: fulfillment === "delivery"
        ? sql.json({ street: customer.def.street, number: customer.def.number, neighborhood: customer.def.neighborhood, reference: customer.def.reference ?? null, city: "Joaquim Gomes - AL" })
        : null,
      neighborhood_id: fulfillment === "delivery" ? customer.neighborhoodId : null,
      scheduled_for: input.scheduledFor ?? null,
      estimated_at: input.scheduledFor ?? plus(createdAt, (store.def.prepMinutes + (area?.max ?? 0)) * MINUTE),
      subtotal_cents: totals.subtotalCents, discount_cents: totals.discountCents,
      discount_paid_by: totals.discountCents > 0 ? coupon!.paidBy : null,
      coupon_id: totals.discountCents > 0 ? coupon!.id : null,
      delivery_fee_cents: totals.deliveryFeeCents, service_fee_cents: totals.serviceFeeCents,
      commission_rate: store.def.commission, commission_cents: totals.commissionCents,
      store_amount_cents: totals.storeAmountCents, platform_amount_cents: totals.platformAmountCents,
      total_cents: totals.totalCents, refunded_cents: refundedCents,
      payment_method: random.chance(0.8) ? "pix" : "card",
      age_confirmed: requiresAgeCheck, requires_age_check: requiresAgeCheck,
      missing_item_policy: store.def.key === "mercado" ? random.pick(["call", "substitute", "remove"]) : null,
      notes: null,
      delivery_code: fulfillment === "delivery" ? String(random.int(0, 9999)).padStart(4, "0") : null,
      // Na rede do Chegô o entregador pega a entrega logo depois do aceite da loja.
      courier_id: byNetwork ? (stamps.accepted_at ? networkCourierId : null) : stamps.dispatched_at ? store.courierId : null,
      delivery_provider: byNetwork ? "platform" : "store", courier_fee_cents: courierFeeCents,
      courier_assigned_at: byNetwork && stamps.accepted_at ? plus(stamps.accepted_at, MINUTE) : null,
      payment_expires_at: plus(createdAt, 15 * MINUTE),
      ...stamps, created_at: createdAt, updated_at: clock,
    };
    out.orders.push(order);

    for (const item of items) {
      out.order_items.push({
        id: item.itemId, order_id: orderId, product_id: item.product.id, name: item.product.def.name,
        unit_price_cents: item.unitPrice, quantity: item.quantity, line_total_cents: item.unitPrice * item.quantity,
        notes: null, requires_age_check: item.product.def.ageCheck ?? false,
        weight_step_grams: item.product.def.weight?.step ?? null,
        removed_at: item.itemId === removedItemId ? clock : null,
        removed_reason: item.itemId === removedItemId ? "Item em falta" : null,
      });
      out.order_item_options.push(...item.optionRows);
    }
    for (const entry of history) {
      out.order_status_history.push({ order_id: orderId, status: entry.status, changed_by: entry.by, reason: entry.reason ?? null, created_at: entry.at });
    }

    const paymentStatus = !paid
      ? (final === "expired" ? "expired" : "pending")
      : refundedCents === 0 ? "approved" : refundedCents >= totals.totalCents ? "refunded" : "partially_refunded";
    out.payments.push({
      id: paymentId, order_id: orderId, invoice_id: null, provider: "mock", provider_payment_id: `mock_${orderId.slice(0, 13)}`,
      method: order.payment_method, status: paymentStatus, amount_cents: totals.totalCents,
      pix_copy_paste: order.payment_method === "pix" ? `00020126CHEGO-TESTE-${orderId.slice(0, 8).toUpperCase()}` : null,
      expires_at: order.payment_expires_at, created_at: createdAt, updated_at: clock,
    });

    if (paid) {
      for (const line of saleLedgerLines(totals)) {
        out.ledger_entries.push({
          account: line.account, store_id: line.account === "store" ? store.id : null, direction: line.direction,
          amount_cents: line.amountCents, reason: line.reason, order_id: orderId, refund_id: null, invoice_id: null, courier_id: null, created_at: stamps.paid_at,
        });
      }
    }

    // Entrega concluída pela rede: o ganho do entregador sai da parte da plataforma.
    // As entregas com mais de duas semanas já foram repassadas.
    if (byNetwork && networkCourierId && courierFeeCents > 0 && history.some((entry) => entry.status === "delivered")) {
      const deliveredAt = stamps.completed_at!;
      const paidOut = deliveredAt.getTime() < START.getTime() - 14 * DAY;
      const payoutAt = plus(deliveredAt, 3 * DAY);
      out.courier_earnings.push({
        order_id: orderId, courier_id: networkCourierId, amount_cents: courierFeeCents,
        paid_at: paidOut ? payoutAt : null, paid_by: paidOut ? adminId : null, created_at: deliveredAt,
      });
      const entry = { store_id: null, amount_cents: courierFeeCents, order_id: orderId, refund_id: null, invoice_id: null };
      out.ledger_entries.push(
        { ...entry, account: "platform", direction: "debit", reason: "delivery", courier_id: null, created_at: deliveredAt },
        { ...entry, account: "courier", direction: "credit", reason: "delivery", courier_id: networkCourierId, created_at: deliveredAt },
      );
      if (paidOut) {
        out.ledger_entries.push({ ...entry, order_id: null, account: "courier", direction: "debit", reason: "payout", courier_id: networkCourierId, created_at: payoutAt });
      }
    }
    if (totals.discountCents > 0) {
      out.coupon_redemptions.push({ coupon_id: coupon!.id, order_id: orderId, customer_id: customer.id, discount_cents: totals.discountCents, created_at: createdAt });
    }

    const result: BuiltOrder = {
      id: orderId, createdAt, status, storeId: store.id, customerId: customer.id,
      completedAt: stamps.completed_at, order, totalCents: totals.totalCents,
    };
    built.push(result);
    return result;
  }

  // Histórico: cerca de 400 pedidos nos últimos 90 dias, dentro do horário de cada loja.
  const activeStores = [...stores.values()].filter((store) => store.def.weight > 0);
  const buyers = [...customers.values()].filter((customer) => customer.def.weight > 0);
  let exhaustedCouponUses = 0;

  for (let attempts = 0; built.length < HISTORY_ORDERS && attempts < HISTORY_ORDERS * 5; attempts += 1) {
    const store = random.weighted(activeStores, (item) => item.def.weight);
    const daysAgo = random.int(1, HISTORY_DAYS);
    const weekday = weekdayOf(daysAgo);
    const shifts = store.def.hours.filter((hours) => hours.days.includes(weekday));
    if (shifts.length === 0) continue;
    // Os fins de semana são mais movimentados para quem serve jantar.
    if (store.def.hours[0].open >= "14:00" && ![5, 6, 0].includes(weekday) && random.chance(0.35)) continue;

    const shift = random.pick(shifts);
    const open = toMinutes(shift.open);
    const close = toMinutes(shift.close) <= open ? toMinutes(shift.close) + 24 * 60 : toMinutes(shift.close);
    const cutoff = store.def.scheduled?.cutoff ? toMinutes(store.def.scheduled.cutoff) : close - 20;
    const minute = random.int(open, Math.max(open, Math.min(close - 20, cutoff)));
    const createdAt = plus(localTime(daysAgo, "00:00"), minute * MINUTE);

    let customer = random.weighted(buyers, (item) => item.def.weight);
    if (customer.def.blocked && daysAgo < 10) customer = customers.get("ana")!;
    if (store.def.key === "deposito" && customer.def.minor) continue;

    const roll = random.next();
    const final: FinalStatus = roll < 0.88 ? "done" : roll < 0.91 ? "cancelled" : roll < 0.94 ? "rejected"
      : roll < 0.96 ? "refunded" : roll < 0.98 ? "partially_refunded" : "expired";

    let coupon: CouponUse | undefined;
    if (final !== "expired") {
      if (exhaustedCouponUses < 5 && random.chance(0.05)) {
        coupon = { id: coupons.ESGOTOU, code: "ESGOTOU", paidBy: "platform", productCents: 500 };
        exhaustedCouponUses += 1;
      } else if (store.def.key === "pizzaria" && random.chance(0.12)) {
        coupon = { id: coupons.PIZZA10, code: "PIZZA10", paidBy: "store", percent: 10, maxCents: 1500 };
      }
    }
    buildOrder({ store, customer, createdAt, final, coupon });
  }
  // Garante que o cupom de "limite atingido" esteja mesmo esgotado.
  while (exhaustedCouponUses < 5) {
    buildOrder({
      store: stores.get("acai")!, customer: customers.get("ana")!, createdAt: plus(localTime(20 + exhaustedCouponUses, "16:00"), 0),
      final: "done", coupon: { id: coupons.ESGOTOU, code: "ESGOTOU", paidBy: "platform", productCents: 500 },
    });
    exhaustedCouponUses += 1;
  }

  // Situações prontas para testar.
  const live = {
    awaitingPayment: buildOrder({ store: stores.get("acai")!, customer: customers.get("eduarda")!, createdAt: plus(START, -3 * MINUTE), final: "awaiting_payment", products: ["Açaí 500 ml"] })!,
    waitingAcceptance: buildOrder({ store: stores.get("pizzaria")!, customer: customers.get("bruno")!, createdAt: plus(START, -4 * MINUTE), final: "paid", live: true, products: ["Pizza Grande (8 fatias)", "Refrigerante 2 L"] })!,
    preparing: buildOrder({ store: stores.get("burger")!, customer: customers.get("ana")!, createdAt: plus(START, -12 * MINUTE), final: "preparing", live: true, products: ["Brasa Bacon", "Batata frita"] })!,
    outForDelivery: buildOrder({ store: stores.get("pizzaria")!, customer: customers.get("felipe")!, createdAt: plus(START, -25 * MINUTE), final: "out_for_delivery", live: true, products: ["Pizza Média (6 fatias)"] })!,
    scheduled: buildOrder({ store: stores.get("delicias")!, customer: customers.get("ana")!, createdAt: plus(START, -2 * HOUR), final: "accepted", live: true, scheduledFor: localTime(-1, "15:00"), products: ["Cento de salgadinhos"] })!,
    rejected: buildOrder({ store: stores.get("deposito")!, customer: customers.get("joao")!, createdAt: localTime(2, "19:30"), final: "rejected", products: ["Cerveja pilsen — caixa com 12 latas", "Gelo 5 kg"] })!,
    // Rede de entregadores do Chegô: duas entregas esperando alguém pegar e uma já na rua com o Jonas.
    offerReady: buildOrder({ store: stores.get("sushi")!, customer: customers.get("bruno")!, createdAt: plus(START, -30 * MINUTE), final: "ready", live: true, networkCourier: null })!,
    offerPreparing: buildOrder({ store: stores.get("lasanha")!, customer: customers.get("felipe")!, createdAt: plus(START, -10 * MINUTE), final: "preparing", live: true, networkCourier: null })!,
    networkOnTheWay: buildOrder({ store: stores.get("suplementos")!, customer: customers.get("ana")!, createdAt: plus(START, -40 * MINUTE), final: "out_for_delivery", live: true, networkCourier: jonasId })!,
    ticket: buildOrder({ store: stores.get("mercado")!, customer: customers.get("gabriela")!, createdAt: localTime(1, "10:15"), final: "done", products: ["Arroz branco 1 kg", "Feijão carioca 1 kg", "Leite integral 1 L", "Sabão em pó 800 g"] })!,
  };

  // Códigos curtos e legíveis, em ordem cronológica: JG-0001, JG-0002...
  built.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  built.forEach((item, index) => { item.order.code = `JG-${String(index + 1).padStart(4, "0")}`; });

  // Avaliações em cerca de 60% dos pedidos concluídos.
  const reviewable = built.filter((item) => item.completedAt && item.id !== live.ticket.id);
  let hiddenReviews = 0;
  for (const item of reviewable) {
    if (!random.chance(0.6)) continue;
    const rating = random.weighted([5, 4, 3, 2, 1], (stars) => ({ 5: 50, 4: 28, 3: 12, 2: 6, 1: 4 })[stars]!);
    const comment = random.chance(0.7)
      ? random.pick(rating >= 4 ? GOOD_COMMENTS : rating === 3 ? OK_COMMENTS : BAD_COMMENTS)
      : null;
    const createdAt = plus(item.completedAt!, random.int(1, 40) * HOUR);
    const replied = comment !== null && random.chance(0.35);
    const hide = rating === 1 && comment !== null && hiddenReviews === 0;
    if (hide) hiddenReviews += 1;
    out.reviews.push({
      order_id: item.id, store_id: item.storeId, customer_id: item.customerId, rating,
      comment: hide ? "Comentário com palavrões (exemplo de avaliação ocultada)." : comment,
      reply: replied ? random.pick(REPLIES) : null, replied_at: replied ? plus(createdAt, 3 * HOUR) : null,
      reported_at: hide ? plus(createdAt, HOUR) : null,
      hidden_at: hide ? plus(createdAt, 5 * HOUR) : null, hidden_by: hide ? adminId : null,
      hidden_reason: hide ? "Linguagem ofensiva" : null, created_at: createdAt,
    });
  }

  for (const table of Object.keys(out) as (keyof typeof out)[]) {
    await insert(sql, table, out[table]);
  }

  await sql`update cities set next_order_number = ${built.length + 1} where id = ${cityId}`;
  await sql`update coupons c set uses_count = (select count(*) from coupon_redemptions r where r.coupon_id = c.id)`;
  await sql`
    update stores s set rating_count = stats.total, rating_avg = stats.average
    from (
      select store_id, count(*)::int as total, round(avg(rating), 2) as average
      from reviews
      where hidden_at is null and created_at > now() - interval '180 days'
      group by store_id
    ) stats
    where stats.store_id = s.id`;

  // ------------------------------------------- mensagens, suporte e o restante

  await insert(sql, "order_messages", [
    { order_id: live.outForDelivery.id, sender_id: stores.get("pizzaria")!.ownerId, sender_side: "store", body: "Seu pedido saiu! Já já chega aí.", read_at: plus(START, -4 * MINUTE), created_at: plus(START, -6 * MINUTE) },
    { order_id: live.outForDelivery.id, sender_id: customers.get("felipe")!.id, sender_side: "customer", body: "Obrigado! O portão é o verde, pode buzinar.", read_at: null, created_at: plus(START, -3 * MINUTE) },
  ]);
  await insert(sql, "blocked_message_attempts", [{
    order_id: live.outForDelivery.id, sender_id: customers.get("felipe")!.id,
    body: "Me chama no zap 82 99999-0000 que eu explico", matched_rule: "phone", created_at: plus(START, -5 * MINUTE),
  }]);

  const ticketId = randomUUID();
  await insert(sql, "support_tickets", [{
    id: ticketId, order_id: live.ticket.id, customer_id: customers.get("gabriela")!.id, store_id: stores.get("mercado")!.id,
    reason: "missing_item", status: "open", created_at: plus(live.ticket.completedAt!, 30 * MINUTE),
  }]);
  await insert(sql, "ticket_messages", [{
    ticket_id: ticketId, sender_id: customers.get("gabriela")!.id, sender_side: "customer",
    body: "O sabão em pó não veio na sacola, mas foi cobrado.", created_at: plus(live.ticket.completedAt!, 30 * MINUTE),
  }]);

  // Indicação: a Ana convidou o Bruno, que já concluiu o primeiro pedido.
  const referralCouponId = randomUUID();
  await insert(sql, "coupons", [{
    ...couponBase, id: referralCouponId, code: "INDICA-ANA100", description: "Obrigado por indicar o Chegô!",
    type: "fixed", value_cents: 500, paid_by: "platform", owner_profile_id: customers.get("ana")!.id, max_uses: 1, max_uses_per_customer: 1,
  }]);
  const brunoFirstOrder = built.find((item) => item.customerId === customers.get("bruno")!.id && item.completedAt);
  await insert(sql, "referrals", [{
    referrer_id: customers.get("ana")!.id, referred_id: customers.get("bruno")!.id, referrer_coupon_id: referralCouponId,
    first_order_id: brunoFirstOrder?.id ?? null, rewarded_at: brunoFirstOrder ? plus(brunoFirstOrder.completedAt!, HOUR) : null,
  }]);

  await insert(sql, "favorites", [
    ...["pizzaria", "acai", "burger", "padaria"].map((key) => ({ profile_id: customers.get("ana")!.id, store_id: stores.get(key)!.id })),
    { profile_id: customers.get("bruno")!.id, store_id: stores.get("mercado")!.id },
  ]);

  // Faturas mensais: dois meses pagos, um em aberto e a vencida que fez
  // a Pastelaria ser suspensa. A loja fundadora ainda não paga nada.
  const invoices: Row[] = [];
  const invoicePayments: Row[] = [];
  const invoiceLedger: Row[] = [];
  const monthStart = (monthsAgo: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsAgo, 1));
  for (const store of stores.values()) {
    const subscriptionId = subscriptionIds.get(store.def.key);
    if (!subscriptionId || store.def.founder || store.def.city === "neighbor") continue;
    const amount = store.def.featured ? 9990 : 4990;
    for (const monthsAgo of [2, 1, 0]) {
      const periodStart = monthStart(monthsAgo);
      const dueDate = plus(periodStart, 9 * DAY);
      const suspended = store.def.status === "suspended";
      if (monthsAgo === 0 && (suspended || store.def.key !== "mercado")) continue;
      const status = monthsAgo === 0 ? "open" : suspended && monthsAgo === 1 ? "overdue" : "paid";
      const invoiceId = randomUUID();
      invoices.push({
        id: invoiceId, store_id: store.id, subscription_id: subscriptionId,
        period_start: periodStart.toISOString().slice(0, 10), period_end: plus(monthStart(monthsAgo - 1), -DAY).toISOString().slice(0, 10),
        amount_cents: amount, status, due_date: dueDate.toISOString().slice(0, 10),
        paid_at: status === "paid" ? plus(dueDate, -2 * DAY) : null, created_at: periodStart,
      });
      if (status === "paid") {
        invoicePayments.push({
          order_id: null, invoice_id: invoiceId, provider: "mock", provider_payment_id: `mock_inv_${invoiceId.slice(0, 13)}`,
          method: "pix", status: "approved", amount_cents: amount, created_at: plus(dueDate, -2 * DAY), updated_at: plus(dueDate, -2 * DAY),
        });
        invoiceLedger.push({
          account: "platform", store_id: null, direction: "credit", amount_cents: amount, reason: "subscription",
          order_id: null, refund_id: null, invoice_id: invoiceId, courier_id: null, created_at: plus(dueDate, -2 * DAY),
        });
      }
    }
  }
  await insert(sql, "invoices", invoices);
  await insert(sql, "payments", invoicePayments);
  await insert(sql, "ledger_entries", invoiceLedger);

  const ana = customers.get("ana")!.id;
  await insert(sql, "notifications", [
    { profile_id: ana, type: "order_preparing", title: "Seu pedido está sendo preparado", body: "O Brasa Burger já está cuidando do seu pedido.", link: `/pedidos/${live.preparing.id}`, order_id: live.preparing.id, promotional: false, read_at: null, created_at: plus(START, -8 * MINUTE) },
    { profile_id: ana, type: "referral_reward", title: "Seu cupom de indicação chegou!", body: "Bruno fez o primeiro pedido. Use o cupom INDICA-ANA100.", link: "/perfil/cupons", order_id: null, promotional: false, read_at: null, created_at: plus(START, -3 * DAY) },
    { profile_id: ana, type: "promo", title: "Sexta da pizza", body: "Hoje tem pizza na Forno de Barro. Bora?", link: "/loja/pizzaria-forno-de-barro", order_id: null, promotional: true, read_at: plus(START, -6 * DAY), created_at: plus(START, -7 * DAY) },
    { profile_id: customers.get("felipe")!.id, type: "order_out_for_delivery", title: "Seu pedido saiu!", body: "Já já chega aí.", link: `/pedidos/${live.outForDelivery.id}`, order_id: live.outForDelivery.id, promotional: false, read_at: null, created_at: plus(START, -6 * MINUTE) },
    { profile_id: customers.get("joao")!.id, type: "order_rejected", title: "Eita, a loja não pôde aceitar seu pedido", body: "O valor já foi devolvido para você.", link: `/pedidos/${live.rejected.id}`, order_id: live.rejected.id, promotional: false, read_at: plus(START, -1 * DAY), created_at: plus(START, -2 * DAY) },
    { profile_id: stores.get("pizzaria")!.ownerId, type: "order_new", title: "Novo pedido!", body: "Chegou um pedido novo. Aceite em até 8 minutos.", link: "/lojista/pedidos", order_id: live.waitingAcceptance.id, promotional: false, read_at: null, created_at: plus(START, -3 * MINUTE) },
    { profile_id: pizzaAttendantId, type: "order_new", title: "Novo pedido!", body: "Chegou um pedido novo. Aceite em até 8 minutos.", link: "/lojista/pedidos", order_id: live.waitingAcceptance.id, promotional: false, read_at: null, created_at: plus(START, -3 * MINUTE) },
  ]);

  await insert(sql, "outbound_messages", [
    { channel: "sms", recipient: customers.get("joao")!.phone, profile_id: customers.get("joao")!.id, subject: null, body: "Chegô: a loja não pôde aceitar seu pedido. O valor já foi devolvido.", created_at: plus(START, -2 * DAY) },
    { channel: "push", recipient: "Felipe Rocha", profile_id: customers.get("felipe")!.id, subject: "Seu pedido saiu!", body: "Já já chega aí.", created_at: plus(START, -6 * MINUTE) },
    { channel: "email", recipient: "mercado@exemplo.test", profile_id: stores.get("mercado")!.ownerId, subject: "Sua fatura do Chegô chegou", body: "A mensalidade deste mês já está disponível no painel.", created_at: plus(START, -8 * DAY) },
    { channel: "whatsapp", recipient: "+5582910000016", profile_id: stores.get("pastelaria")!.ownerId, subject: null, body: "Chegô: sua loja foi suspensa por fatura vencida. Regularize pelo painel.", created_at: plus(START, -4 * DAY) },
  ]);

  await insert(sql, "audit_logs", [
    { actor_id: adminId, action: "store.suspend", entity_type: "store", entity_id: stores.get("pastelaria")!.id, store_id: stores.get("pastelaria")!.id, details: sql.json({ reason: "Fatura vencida há mais de 10 dias" }), created_at: plus(START, -4 * DAY) },
    { actor_id: adminId, action: "customer.block", entity_type: "profile", entity_id: customers.get("henrique")!.id, store_id: null, details: sql.json({ reason: "Vários pedidos cancelados depois de prontos" }), created_at: plus(START, -5 * DAY) },
    { actor_id: adminId, action: "store.feature", entity_type: "store", entity_id: stores.get("pizzaria")!.id, store_id: stores.get("pizzaria")!.id, details: sql.json({ days: 30 }), created_at: plus(START, -1 * DAY) },
  ]);

  console.log(`  ${stores.size} lojas, ${rows.products.length} produtos, ${built.length} pedidos, ${out.reviews.length} avaliações`);
}

/** Cria um id para `key`, guarda no mapa e devolve. */
function remember(map: Map<string, string>, key: string): string {
  const id = randomUUID();
  map.set(key, id);
  return id;
}
