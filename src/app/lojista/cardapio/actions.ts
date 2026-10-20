"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type postgres from "postgres";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { hasPermission, requirePermission } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { parseMoney } from "@/lib/format";
import { adjustPrice, parseMenuCsv } from "@/lib/merchant/csv";
import { pickedFile, PRODUCT_VARIANTS, saveImage, UploadError } from "@/lib/uploads";
import { portionPriceCents, WEIGHT_STEPS } from "@/lib/catalog/weight";

// Toda gravação aqui roda como o usuário que entrou (withUser), então, além da
// checagem de papel, as regras de acesso por linha (RLS) garantem que a loja só edita o próprio cardápio.

export type ActionState = { error?: string; ok?: boolean; message?: string };

const uuid = z.uuid();
const done = () => revalidatePath("/lojista/cardapio", "layout");
const staff = () => requirePermission("produtos.editar");
/** Mudar preço é uma permissão à parte. */
const pricing = () => requirePermission("produtos.precos");

// ------------------------------------------------------------------- seções

export async function saveSection(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await staff();
  const name = z.string().trim().min(1).max(60).safeParse(formData.get("name"));
  if (!name.success) return { error: "Dê um nome para a seção." };
  const id = uuid.safeParse(formData.get("id"));

  await withUser(profile.id, async (tx) => {
    if (id.success) {
      await tx`update product_sections set name = ${name.data} where id = ${id.data}`;
    } else {
      await tx`
        insert into product_sections (store_id, name, sort_order)
        values (${membership.storeId}, ${name.data},
                (select coalesce(max(sort_order), -1) + 1 from product_sections where store_id = ${membership.storeId}))`;
    }
  });
  done();
  return { ok: true };
}

/** Move uma seção uma posição para cima ou para baixo (o jeito de reordenar que funciona no teclado). */
export async function moveSection(formData: FormData): Promise<void> {
  const { profile, membership } = await staff();
  const id = uuid.parse(formData.get("id"));
  const direction = z.enum(["up", "down"]).parse(formData.get("direction"));

  await withUser(profile.id, async (tx) => {
    const sections = await tx<{ id: string }[]>`
      select id from product_sections where store_id = ${membership.storeId} order by sort_order, name`;
    const index = sections.findIndex((section) => section.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= sections.length) return;
    [sections[index], sections[target]] = [sections[target], sections[index]];
    for (const [position, section] of sections.entries()) {
      await tx`update product_sections set sort_order = ${position} where id = ${section.id}`;
    }
  });
  done();
}

export async function deleteSection(formData: FormData): Promise<void> {
  const { profile } = await staff();
  const id = uuid.parse(formData.get("id"));
  // Os produtos da seção são mantidos, sem seção.
  await withUser(profile.id, (tx) => tx`delete from product_sections where id = ${id}`);
  done();
}

// ----------------------------------------------------------------- produtos

/** Um toque: esgotado / disponível de novo. */
export async function toggleProduct(formData: FormData): Promise<void> {
  const { profile } = await staff();
  const id = uuid.parse(formData.get("id"));
  await withUser(profile.id, (tx) => tx`update products set available = not available where id = ${id}`);
  done();
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const { profile } = await staff();
  const id = uuid.parse(formData.get("id"));
  // Exclusão lógica: os pedidos antigos continuam apontando para o produto.
  await withUser(profile.id, (tx) => tx`update products set deleted_at = now(), available = false where id = ${id}`);
  done();
  redirect("/lojista/cardapio");
}

export async function duplicateProduct(formData: FormData): Promise<void> {
  const { profile } = await staff();
  const id = uuid.parse(formData.get("id"));

  const copyId = await withUser(profile.id, async (tx) => {
    const [copy] = await tx<{ id: string }[]>`
      insert into products (store_id, section_id, name, description, price_cents, image_url, available, sort_order,
                            min_lead_minutes, max_per_order, track_stock, stock_qty, requires_age_check, weight_step_grams, price_per_kg_cents, weight_min_grams, subcategory_id, compare_at_price_cents)
      select store_id, section_id, name || ' (cópia)', description, price_cents, image_url, false, sort_order + 1,
             min_lead_minutes, max_per_order, track_stock, stock_qty, requires_age_check, weight_step_grams, price_per_kg_cents, weight_min_grams,
             subcategory_id, compare_at_price_cents
      from products where id = ${id} and deleted_at is null
      returning id`;
    if (!copy) return null;
    await tx`
      insert into product_availability (product_id, weekday, starts_at, ends_at)
      select ${copy.id}, weekday, starts_at, ends_at from product_availability where product_id = ${id}`;
    await tx`
      insert into product_option_groups (product_id, group_id, required, min_choices, max_choices, allow_repeat, price_mode, free_quantity, sort_order)
      select ${copy.id}, group_id, required, min_choices, max_choices, allow_repeat, price_mode, free_quantity, sort_order
      from product_option_groups where product_id = ${id}`;
    await tx`
      insert into product_option_prices (product_id, option_id, price_cents)
      select ${copy.id}, option_id, price_cents from product_option_prices where product_id = ${id}`;
    return copy.id;
  });
  done();
  if (copyId) redirect(`/lojista/cardapio/produto/${copyId}`);
}

const productSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome para o produto.").max(120),
  description: z.string().trim().max(500),
  sectionId: z.union([uuid, z.literal("")]),
  minLeadHours: z.coerce.number().int().min(0).max(240),
  maxPerOrder: z.union([z.coerce.number().int().min(1).max(999), z.literal("")]),
  stockQty: z.union([z.coerce.number().int().min(0).max(99999), z.literal("")]),
  windowFrom: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal("")]),
  windowTo: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.literal("")]),
});

export async function saveProduct(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await staff();
  const id = uuid.safeParse(formData.get("id"));
  const parsed = productSchema.safeParse({
    name: formData.get("name"), description: formData.get("description") ?? "", sectionId: formData.get("sectionId") ?? "",
    minLeadHours: formData.get("minLeadHours") || 0, maxPerOrder: formData.get("maxPerOrder") ?? "",
    stockQty: formData.get("stockQty") ?? "", windowFrom: formData.get("windowFrom") ?? "", windowTo: formData.get("windowTo") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const typedPrice = parseMoney(String(formData.get("price") ?? ""));
  if (typedPrice === null) return { error: "Preço inválido. Use o formato 12,50." };

  const data = parsed.data;
  const trackStock = formData.get("trackStock") === "on";
  if (trackStock && data.stockQty === "") return { error: "Diga quanto tem em estoque." };

  // Por peso: o preço digitado é o do quilo, e estoque e máximo por pedido vêm em gramas.
  // O banco guarda porções: o preço de uma porção e quantas porções cabem no estoque.
  const byWeight = formData.get("saleUnit") === "weight";
  const step = byWeight ? Number(formData.get("weightStep")) : null;
  if (byWeight && !WEIGHT_STEPS.includes(step as (typeof WEIGHT_STEPS)[number])) return { error: "Escolha de quantos em quantos gramas vende." };
  if (byWeight && typedPrice <= 0) return { error: "Diga o preço do quilo." };
  const minGrams = byWeight ? Number(String(formData.get("weightMin") ?? "").trim() || step) : null;
  if (byWeight && (!Number.isInteger(minGrams) || minGrams! < step! || minGrams! % step! !== 0)) {
    return { error: `O mínimo em gramas precisa ser múltiplo de ${step} g (e pelo menos ${step} g).` };
  }
  const priceCents = byWeight ? portionPriceCents(typedPrice, step!) : typedPrice;
  const toPortions = (grams: number) => Math.floor(grams / step!);
  const stockQty = trackStock ? (byWeight ? toPortions(data.stockQty as number) : (data.stockQty as number)) : null;
  const maxPerOrder = data.maxPerOrder === "" ? null : byWeight ? Math.max(1, toPortions(data.maxPerOrder)) : data.maxPerOrder;
  const weekdays = formData.getAll("weekdays").map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

  // Preço "de" (oferta): só vitrine, o preço cobrado continua sendo price_cents.
  const compareText = String(formData.get("compareAt") ?? "").trim();
  const compareAt = byWeight || compareText === "" ? null : parseMoney(compareText);
  if (compareAt === null && compareText !== "" && !byWeight) return { error: "Preço de antes inválido. Use o formato 12,50." };
  if (compareAt !== null && compareAt <= priceCents) return { error: "O preço de antes precisa ser maior que o preço atual." };
  const subcategoryId = uuid.safeParse(formData.get("subcategoryId"));

  let imageUrl: string | null | undefined;
  try {
    const file = pickedFile(formData.get("image"));
    if (file) imageUrl = await saveImage(file, "products", membership.storeSlug, PRODUCT_VARIANTS);
    else if (formData.get("removeImage") === "on") imageUrl = null;
  } catch (error) {
    if (error instanceof UploadError) return { error: error.message };
    throw error;
  }

  const fields = {
    section_id: data.sectionId || null, name: data.name, description: data.description, price_cents: priceCents,
    available: formData.get("available") === "on", featured: formData.get("featured") === "on",
    min_lead_minutes: data.minLeadHours * 60, max_per_order: maxPerOrder,
    track_stock: trackStock, stock_qty: stockQty,
    weight_step_grams: step, price_per_kg_cents: byWeight ? typedPrice : null, weight_min_grams: minGrams,
    requires_age_check: formData.get("requiresAgeCheck") === "on",
    compare_at_price_cents: compareAt,
  };

  // Quem não pode alterar preços edita o resto do produto, mas não o preço (nem o "de").
  if (id.success && !hasPermission(membership, "produtos.precos")) {
    const [current] = await withUser(profile.id, (tx) => tx<{ price_cents: number; price_per_kg_cents: number | null; compare_at_price_cents: number | null }[]>`
      select price_cents, price_per_kg_cents, compare_at_price_cents from products where id = ${id.data}`);
    if (current && (current.price_cents !== priceCents || current.price_per_kg_cents !== fields.price_per_kg_cents || current.compare_at_price_cents !== compareAt)) {
      return { error: "Você não tem permissão para alterar preços. Peça ao dono da loja." };
    }
  }

  type Before = { name: string; price_cents: number; compare_at_price_cents: number | null; available: boolean };
  let before: Before | undefined;
  const productId = await withUser(profile.id, async (tx) => {
    // Subcategoria só do segmento da própria loja.
    const [sub] = subcategoryId.success
      ? await tx<{ id: string }[]>`
          select sc.id from subcategories sc join stores s on s.category_id = sc.category_id
          where sc.id = ${subcategoryId.data} and s.id = ${membership.storeId}`
      : [];
    Object.assign(fields, { subcategory_id: sub?.id ?? null });
    let savedId: string;
    if (id.success) {
      [before] = await tx<Before[]>`
        select name, price_cents, compare_at_price_cents, available from products where id = ${id.data} and deleted_at is null for update`;
      const updated = await tx<{ id: string }[]>`
        update products set ${tx(fields)} ${imageUrl !== undefined ? tx`, image_url = ${imageUrl}` : tx``}
        where id = ${id.data} and deleted_at is null returning id`;
      if (updated.length === 0) return null;
      savedId = id.data;
    } else {
      const [created] = await tx<{ id: string }[]>`
        insert into products ${tx({ ...fields, store_id: membership.storeId, image_url: imageUrl ?? null })} returning id`;
      savedId = created.id;
    }

    // Nenhum dia marcado = disponível todos os dias, o dia inteiro.
    await tx`delete from product_availability where product_id = ${savedId}`;
    const everyDay = weekdays.length === 0 || weekdays.length === 7;
    if (!everyDay || data.windowFrom || data.windowTo) {
      for (const weekday of everyDay ? [0, 1, 2, 3, 4, 5, 6] : weekdays) {
        await tx`
          insert into product_availability (product_id, weekday, starts_at, ends_at)
          values (${savedId}, ${weekday}, ${data.windowFrom || "00:00"}, ${data.windowTo || "23:59:59"})`;
      }
    }
    return savedId;
  });

  if (!productId) return { error: "Produto não encontrado." };
  // Auditoria: criação, edição e, à parte, mudança de preço (antes e depois).
  const after = { name: fields.name, price_cents: priceCents, compare_at_price_cents: compareAt, available: fields.available };
  const priceChanged = before && (before.price_cents !== priceCents || before.compare_at_price_cents !== compareAt);
  await audit({
    actorId: profile.id, action: !before ? "produtos.criado" : priceChanged ? "produtos.preco_alterado" : "produtos.editado",
    entityType: "product", entityId: productId, storeId: membership.storeId, actorRole: membership.role, module: "cardapio",
    details: before ? { antes: before, depois: after } : { depois: after },
  });
  done();
  if (!id.success) redirect(`/lojista/cardapio/produto/${productId}`);
  return { ok: true, message: "Produto salvo." };
}

// --------------------------------------------------------- grupos de opções

export async function saveGroup(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await staff();
  const name = z.string().trim().min(1).max(60).safeParse(formData.get("name"));
  if (!name.success) return { error: "Dê um nome para o grupo." };
  const id = uuid.safeParse(formData.get("id"));

  await withUser(profile.id, (tx) =>
    id.success
      ? tx`update option_groups set name = ${name.data} where id = ${id.data}`
      : tx`insert into option_groups (store_id, name) values (${membership.storeId}, ${name.data})`);
  done();
  return { ok: true };
}

export async function deleteGroup(formData: FormData): Promise<void> {
  const { profile } = await staff();
  await withUser(profile.id, (tx) => tx`delete from option_groups where id = ${uuid.parse(formData.get("id"))}`);
  done();
}

export async function saveOption(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await staff();
  const groupId = uuid.safeParse(formData.get("groupId"));
  const name = z.string().trim().min(1).max(80).safeParse(formData.get("name"));
  const label = z.string().trim().max(40).parse(formData.get("label") ?? "");
  const priceCents = parseMoney(String(formData.get("price") || "0"));
  if (!groupId.success || !name.success) return { error: "Dê um nome para a opção." };
  if (priceCents === null) return { error: "Preço inválido. Use o formato 4,00." };

  await withUser(profile.id, (tx) => tx`
    insert into options (group_id, name, category_label, default_price_cents, sort_order)
    values (${groupId.data}, ${name.data}, ${label || null}, ${priceCents},
            (select coalesce(max(sort_order), -1) + 1 from options where group_id = ${groupId.data}))`);
  done();
  return { ok: true };
}

export async function toggleOption(formData: FormData): Promise<void> {
  const { profile } = await staff();
  await withUser(profile.id, (tx) => tx`update options set available = not available where id = ${uuid.parse(formData.get("id"))}`);
  done();
}

export async function deleteOption(formData: FormData): Promise<void> {
  const { profile } = await staff();
  await withUser(profile.id, (tx) => tx`delete from options where id = ${uuid.parse(formData.get("id"))}`);
  done();
}

const linkSchema = z.object({
  productId: uuid,
  groupId: uuid,
  min: z.coerce.number().int().min(0).max(20),
  max: z.coerce.number().int().min(1).max(20),
  mode: z.enum(["sum", "highest", "average", "free_up_to"]),
  free: z.coerce.number().int().min(0).max(20),
});

/** Liga um grupo reutilizável a um produto, com as regras daquele produto. */
export async function linkGroup(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await staff();
  const parsed = linkSchema.safeParse({
    productId: formData.get("productId"), groupId: formData.get("groupId"), min: formData.get("min") || 0,
    max: formData.get("max") || 1, mode: formData.get("mode"), free: formData.get("free") || 0,
  });
  if (!parsed.success) return { error: "Confira os números do grupo." };
  const link = parsed.data;
  if (link.max < link.min) return { error: "O máximo não pode ser menor que o mínimo." };

  try {
    await withUser(profile.id, (tx) => tx`
      insert into product_option_groups (product_id, group_id, required, min_choices, max_choices, allow_repeat, price_mode, free_quantity, sort_order)
      values (${link.productId}, ${link.groupId}, ${link.min > 0}, ${link.min}, ${link.max}, ${formData.get("repeat") === "on"},
              ${link.mode}::option_price_mode, ${link.free},
              (select coalesce(max(sort_order), -1) + 1 from product_option_groups where product_id = ${link.productId}))
      on conflict (product_id, group_id) do update set
        required = excluded.required, min_choices = excluded.min_choices, max_choices = excluded.max_choices,
        allow_repeat = excluded.allow_repeat, price_mode = excluded.price_mode, free_quantity = excluded.free_quantity`);
  } catch {
    return { error: "Não foi possível ligar este grupo ao produto." };
  }
  done();
  return { ok: true };
}

export async function unlinkGroup(formData: FormData): Promise<void> {
  const { profile } = await staff();
  const productId = uuid.parse(formData.get("productId"));
  const groupId = uuid.parse(formData.get("groupId"));
  await withUser(profile.id, async (tx) => {
    await tx`delete from product_option_groups where product_id = ${productId} and group_id = ${groupId}`;
    await tx`
      delete from product_option_prices where product_id = ${productId}
        and option_id in (select id from options where group_id = ${groupId})`;
  });
  done();
}

/** Preços das opções em um produto (ex.: cada sabor na pizza grande). */
export async function saveOptionPrices(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await pricing();
  const productId = uuid.safeParse(formData.get("productId"));
  if (!productId.success) return { error: "Produto inválido." };

  const prices: { optionId: string; cents: number | null }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("price:")) continue;
    const optionId = uuid.safeParse(key.slice(6));
    if (!optionId.success) continue;
    const text = String(value).trim();
    const cents = text === "" ? null : parseMoney(text);
    if (text !== "" && cents === null) return { error: `Preço inválido: “${text}”. Use o formato 45,00.` };
    prices.push({ optionId: optionId.data, cents });
  }

  await withUser(profile.id, async (tx) => {
    for (const price of prices) {
      if (price.cents === null) {
        await tx`delete from product_option_prices where product_id = ${productId.data} and option_id = ${price.optionId}`;
      } else {
        await tx`
          insert into product_option_prices (product_id, option_id, price_cents)
          values (${productId.data}, ${price.optionId}, ${price.cents})
          on conflict (product_id, option_id) do update set price_cents = excluded.price_cents`;
      }
    }
  });
  done();
  return { ok: true, message: "Preços salvos." };
}

// ----------------------------------------------------------------- planilha

/** Cria ou atualiza produtos a partir de um arquivo CSV. Nada é alterado se alguma linha tiver problema. */
export async function importMenuCsv(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await staff();
  const file = pickedFile(formData.get("file"));
  if (!file) return { error: "Escolha o arquivo da planilha." };
  if (file.size > 1024 * 1024) return { error: "Arquivo muito grande. O limite é 1 MB." };

  const { products, errors } = parseMenuCsv(await file.text());
  if (errors.length > 0) return { error: errors.slice(0, 8).join(" ") };
  if (products.length === 0) return { error: "A planilha não tem nenhum produto." };
  if (products.length > 2000) return { error: "A planilha tem produtos demais. O limite é 2000." };

  const result = await withUser(profile.id, async (tx) => {
    let created = 0;
    let updated = 0;
    const sections = new Map<string, string>();
    for (const row of await tx<{ id: string; name: string }[]>`select id, name from product_sections where store_id = ${membership.storeId}`) {
      sections.set(row.name.toLowerCase(), row.id);
    }

    for (const product of products) {
      let sectionId = sections.get(product.section.toLowerCase());
      if (!sectionId) {
        const [section] = await tx<{ id: string }[]>`
          insert into product_sections (store_id, name, sort_order) values (${membership.storeId}, ${product.section}, ${sections.size})
          returning id`;
        sectionId = section.id;
        sections.set(product.section.toLowerCase(), sectionId);
      }
      const fields = {
        section_id: sectionId, description: product.description, price_cents: product.priceCents,
        available: product.available, track_stock: product.stock !== null, stock_qty: product.stock,
      };
      // Produto vendido por peso: na planilha o preço é o do quilo e o estoque é em gramas.
      const [weighted] = await tx<{ weight_step_grams: number }[]>`
        select weight_step_grams from products
        where store_id = ${membership.storeId} and deleted_at is null and lower(name) = lower(${product.name}) and weight_step_grams is not null
        limit 1`;
      const update = weighted
        ? {
            ...fields, price_per_kg_cents: product.priceCents, price_cents: portionPriceCents(product.priceCents, weighted.weight_step_grams),
            stock_qty: product.stock === null ? null : Math.floor(product.stock / weighted.weight_step_grams),
          }
        : fields;
      // Se o preço novo alcançar o preço "de", a oferta acaba (o banco exige de > por).
      const changed = await tx`
        update products set ${tx(update)}, ${keepOffer(tx, update.price_cents)}
        where store_id = ${membership.storeId} and deleted_at is null and lower(name) = lower(${product.name})
        returning id`;
      if (changed.length > 0) updated += changed.length;
      else {
        await tx`insert into products ${tx({ ...fields, store_id: membership.storeId, name: product.name })}`;
        created += 1;
      }
    }
    return { created, updated };
  });

  await audit({ actorId: profile.id, action: "menu.import_csv", entityType: "store", entityId: membership.storeId, storeId: membership.storeId, details: result });
  done();
  return { ok: true, message: `Planilha importada: ${result.created} produtos novos e ${result.updated} atualizados.` };
}

/** Mantém o preço "de" só enquanto ele continuar maior que o preço novo. */
const keepOffer = (tx: postgres.TransactionSql, priceCents: number) =>
  tx`compare_at_price_cents = case when compare_at_price_cents > ${priceCents} then compare_at_price_cents end`;

/** Sobe ou baixa todos os preços de uma seção (ou do cardápio inteiro) por um percentual. */
export async function adjustPrices(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const { profile, membership } = await pricing();
  const percent = z.coerce.number().min(-90).max(500).safeParse(String(formData.get("percent") ?? "").replace(",", "."));
  if (!percent.success || percent.data === 0) return { error: "Diga o percentual, por exemplo 5 ou -10." };
  const sectionId = uuid.safeParse(formData.get("sectionId"));

  const count = await withUser(profile.id, async (tx) => {
    const products = await tx<{ id: string; price_cents: number; price_per_kg_cents: number | null; weight_step_grams: number | null }[]>`
      select id, price_cents, price_per_kg_cents, weight_step_grams from products
      where store_id = ${membership.storeId} and deleted_at is null
        ${sectionId.success ? tx`and section_id = ${sectionId.data}` : tx``}`;
    for (const product of products) {
      if (product.price_per_kg_cents && product.weight_step_grams) {
        // Por peso: reajusta o quilo e recalcula a porção a partir dele.
        const perKg = adjustPrice(product.price_per_kg_cents, percent.data);
        await tx`update products set price_per_kg_cents = ${perKg}, price_cents = ${portionPriceCents(perKg, product.weight_step_grams)} where id = ${product.id}`;
      } else {
        const price = adjustPrice(product.price_cents, percent.data);
        await tx`update products set price_cents = ${price}, ${keepOffer(tx, price)} where id = ${product.id}`;
      }
    }
    // Os preços definidos por produto (sabores de pizza por tamanho) seguem o mesmo reajuste.
    const optionPrices = await tx<{ product_id: string; option_id: string; price_cents: number }[]>`
      select product_id, option_id, price_cents from product_option_prices
      where product_id = any(${products.map((product) => product.id)}::uuid[])`;
    for (const price of optionPrices) {
      await tx`
        update product_option_prices set price_cents = ${adjustPrice(price.price_cents, percent.data)}
        where product_id = ${price.product_id} and option_id = ${price.option_id}`;
    }
    return products.length;
  });

  await audit({ actorId: profile.id, action: "menu.adjust_prices", entityType: "store", entityId: membership.storeId, storeId: membership.storeId, details: { percent: percent.data, section: sectionId.success ? sectionId.data : "all", products: count } });
  done();
  return { ok: true, message: `Preços reajustados em ${count} produtos.` };
}
