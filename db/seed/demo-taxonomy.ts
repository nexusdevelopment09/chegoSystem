// Seed de desenvolvimento: coloca as lojas e os produtos fictícios nas subcategorias e
// dá preço "de" a alguns produtos, para os filtros e as vitrines terem o que mostrar.
import type { Sql } from "postgres";

/** Subcategorias de cada loja (pelo slug da loja). */
const STORE_SUBS: Record<string, string[]> = {
  "pizzaria-forno-de-barro": ["pizzarias", "italiana"],
  "casa-da-lasanha": ["italiana", "marmitas"],
  "quentinha-da-dona-lia": ["marmitas", "brasileira"],
  "sushi-mare": ["japonesa"],
  "peixaria-aguas-claras": ["peixes-e-frutos-do-mar", "brasileira"],
  "brasa-burger": ["hamburguerias", "porcoes"],
  "delicias-da-vo": ["salgados", "lanchonetes"],
  "padaria-pao-quentinho": ["padarias", "bolos-e-tortas"],
  "acai-tropical": ["acai", "sorvetes"],
  "deposito-gelada-ja": ["cervejas", "refrigerantes", "agua", "energeticos", "gelo-e-carvao"],
  "farmacia-saude-mais": ["sem-receita", "higiene-pessoal", "bebes", "beleza"],
  "emporio-vida-verde": ["naturais"],
  "forca-total-suplementos": ["fit"],
  "mercado-boa-compra": ["hortifruti", "mercearia", "carnes", "limpeza", "higiene-pessoal"],
  "espetinho-do-ze": ["lanchonetes"],
  "pastelaria-sabor-antigo": ["pastelarias"],
  "lanchonete-ponto-certo": ["lanchonetes"],
};

/** Subcategoria de cada produto: a primeira regra do segmento que casa com "seção nome". */
const PRODUCT_RULES: Record<string, [RegExp, string][]> = {
  bebidas: [
    [/cerveja/i, "cervejas"], [/refrigerante/i, "refrigerantes"], [/coco|suco/i, "sucos"], [/água/i, "agua"],
    [/energético/i, "energeticos"], [/gelo|carvão/i, "gelo-e-carvao"],
  ],
  mercado: [
    [/^Hortifrúti .*(banana|mamão|limão)/i, "frutas"], [/^Hortifrúti/, "verduras-e-legumes"], [/^Mercearia/, "mercearia"],
    [/^Carnes .*(frango|coxa)/i, "aves"], [/^Carnes/, "carnes"], [/^Laticínios/, "frios-e-laticinios"], [/^Padaria/, "padaria"],
    [/^Bebidas/, "bebidas"], [/^Limpeza/, "limpeza"], [/^Higiene .*fralda/i, "bebes"], [/^Higiene/, "higiene-pessoal"],
  ],
  farmacia: [
    [/^Sem receita/, "sem-receita"], [/^Bebê/, "bebes"], [/protetor|repelente/i, "beleza"], [/^Cuidados pessoais/, "higiene-pessoal"],
    [/^Primeiros socorros/, "ortopedia"],
  ],
  saudavel: [[/^A granel|^Grãos|^Chás/, "naturais"], [/^Proteínas|^Performance/, "fit"]],
  lanches: [[/^Porções/, "porcoes"], [/^Salgados/, "salgados"]],
};

/** Ofertas fictícias: preço "de" maior que o preço atual. */
const OFFERS: [store: string, product: string, compareAtCents: number][] = [
  ["mercado-boa-compra", "Arroz branco 1 kg", 849],
  ["mercado-boa-compra", "Café torrado 250 g", 1290],
  ["mercado-boa-compra", "Sabão em pó 800 g", 1590],
  ["deposito-gelada-ja", "Cerveja pilsen — caixa com 12 latas", 5490],
  ["farmacia-saude-mais", "Protetor solar FPS 50 120 ml", 4990],
  ["brasa-burger", "Batata com cheddar e bacon", 2490],
];

export async function tagDemoTaxonomy(sql: Sql) {
  for (const [slug, subs] of Object.entries(STORE_SUBS)) {
    await sql`
      insert into store_subcategories (store_id, subcategory_id)
      select s.id, sc.id from stores s join subcategories sc on sc.category_id = s.category_id
      where s.slug = ${slug} and sc.slug = any(${subs}::text[])
      on conflict do nothing`;
  }

  const products = await sql<{ id: string; category: string; category_id: string; label: string }[]>`
    select p.id, c.slug as category, c.id as category_id, coalesce(ps.name, '') || ' ' || p.name as label
    from products p join stores s on s.id = p.store_id join categories c on c.id = s.category_id
    left join product_sections ps on ps.id = p.section_id`;
  const subs = await sql<{ id: string; category_id: string; slug: string }[]>`select id, category_id, slug from subcategories`;
  for (const product of products) {
    const rule = PRODUCT_RULES[product.category]?.find(([pattern]) => pattern.test(product.label));
    const sub = rule && subs.find((row) => row.category_id === product.category_id && row.slug === rule[1]);
    if (sub) await sql`update products set subcategory_id = ${sub.id} where id = ${product.id}`;
  }

  for (const [store, name, compareAt] of OFFERS) {
    await sql`
      update products p set compare_at_price_cents = ${compareAt}
      from stores s where s.id = p.store_id and s.slug = ${store} and p.name = ${name} and p.price_cents < ${compareAt}`;
  }
}
