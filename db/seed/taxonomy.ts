// Segmentos (categorias) e subcategorias do Chegô. Não são dados de teste: valem também
// em produção. syncTaxonomy roda a cada migrate e só acrescenta o que falta (pelo slug),
// então o admin pode renomear, reordenar ou desativar sem a mudança ser desfeita.
import type { Sql } from "postgres";

type Sub = { name: string; slug: string; group?: string };
type Category = { name: string; slug: string; icon: string; color: string; active?: boolean; subs: Sub[] };

const s = (name: string, slug: string, group?: string): Sub => ({ name, slug, group });

export const CATEGORIES: Category[] = [
  {
    name: "Restaurantes", slug: "restaurantes", icon: "utensils", color: "#C2410C",
    subs: [
      s("Hamburguerias", "hamburguerias"), s("Pizzarias", "pizzarias"), s("Lanchonetes", "lanchonetes"),
      s("Comida brasileira", "brasileira"), s("Comida japonesa", "japonesa"), s("Comida italiana", "italiana"),
      s("Comida chinesa", "chinesa"), s("Açaí e sorvetes", "acai-e-sorvetes"), s("Cafeterias", "cafeterias"),
      s("Padarias", "padarias"), s("Docerias", "docerias"), s("Marmitas e refeições", "marmitas"),
      s("Churrascarias", "churrascarias"), s("Comida saudável", "saudavel"), s("Comida mexicana", "mexicana"),
      s("Pastelarias", "pastelarias"), s("Peixes e frutos do mar", "peixes-e-frutos-do-mar"),
    ],
  },
  {
    name: "Lanches", slug: "lanches", icon: "burger", color: "#B45309",
    subs: [
      s("Hamburguerias", "hamburguerias"), s("Lanchonetes", "lanchonetes"), s("Salgados", "salgados"),
      s("Pastelarias", "pastelarias"), s("Cachorro-quente", "cachorro-quente"), s("Porções", "porcoes"),
    ],
  },
  {
    name: "Café da manhã", slug: "cafe-da-manha", icon: "coffee", color: "#A16207",
    subs: [s("Padarias", "padarias"), s("Cafeterias", "cafeterias"), s("Tapiocas", "tapiocas"), s("Bolos e tortas", "bolos-e-tortas")],
  },
  {
    name: "Açaí e sobremesas", slug: "acai-e-sobremesas", icon: "ice-cream", color: "#6D28D9",
    subs: [s("Açaí", "acai"), s("Sorvetes", "sorvetes"), s("Docerias", "docerias"), s("Bolos e tortas", "bolos-e-tortas")],
  },
  {
    name: "Bebidas", slug: "bebidas", icon: "bottle", color: "#1D4ED8",
    subs: [
      s("Cervejas", "cervejas"), s("Vinhos", "vinhos"), s("Espumantes", "espumantes"), s("Destilados", "destilados"),
      s("Drinks e coquetéis", "drinks"), s("Refrigerantes", "refrigerantes"), s("Sucos", "sucos"), s("Água", "agua"),
      s("Energéticos", "energeticos"), s("Sem álcool", "sem-alcool"), s("Gelo e carvão", "gelo-e-carvao"),
    ],
  },
  {
    name: "Mercado", slug: "mercado", icon: "basket", color: "#15803D",
    subs: [
      s("Hortifrúti", "hortifruti"), s("Frutas", "frutas"), s("Verduras e legumes", "verduras-e-legumes"), s("Carnes", "carnes"),
      s("Aves", "aves"), s("Peixes", "peixes"), s("Frios e laticínios", "frios-e-laticinios"), s("Padaria", "padaria"),
      s("Mercearia", "mercearia"), s("Bebidas", "bebidas"), s("Congelados", "congelados"), s("Limpeza", "limpeza"),
      s("Higiene pessoal", "higiene-pessoal"), s("Bebês", "bebes"), s("Pet shop", "pet-shop"),
    ],
  },
  {
    name: "Farmácia", slug: "farmacia", icon: "pill", color: "#0F766E",
    subs: [
      s("Medicamentos sem receita", "sem-receita"), s("Genéricos", "genericos"), s("Higiene pessoal", "higiene-pessoal"),
      s("Beleza e cuidados", "beleza"), s("Vitaminas e suplementos", "vitaminas"), s("Bebês", "bebes"),
      s("Mamães e gestantes", "gestantes"), s("Diabetes", "diabetes"), s("Controle de peso", "controle-de-peso"),
      s("Ortopedia e cuidados em casa", "ortopedia"),
    ],
  },
  {
    name: "Saudável", slug: "saudavel", icon: "leaf", color: "#4D7C0F",
    subs: [s("Saladas", "saladas"), s("Fit", "fit"), s("Naturais e a granel", "naturais"), s("Vegano", "vegano")],
  },
  {
    name: "Shopping", slug: "shopping", icon: "gift", color: "#BE185D",
    subs: [
      s("Presentes", "presentes", "Presentes e ocasiões"), s("Cestas de café da manhã", "cestas-cafe-da-manha", "Presentes e ocasiões"),
      s("Cestas especiais", "cestas-especiais", "Presentes e ocasiões"), s("Flores e buquês", "flores-e-buques", "Presentes e ocasiões"),
      s("Presentes românticos", "presentes-romanticos", "Presentes e ocasiões"), s("Personalizados", "personalizados", "Presentes e ocasiões"),
      s("Datas comemorativas", "datas-comemorativas", "Presentes e ocasiões"),
      s("Utilidades domésticas", "utilidades-domesticas", "Variedades"), s("Decoração", "decoracao", "Variedades"),
      s("Papelaria", "papelaria", "Variedades"), s("Acessórios", "acessorios", "Variedades"),
      s("Brinquedos", "brinquedos", "Crianças"), s("Jogos e atividades", "jogos", "Crianças"),
      s("Presentes infantis", "presentes-infantis", "Crianças"), s("Bebês", "bebes", "Crianças"),
      s("Perfumaria", "perfumaria", "Beleza"), s("Cosméticos", "cosmeticos", "Beleza"), s("Maquiagem", "maquiagem", "Beleza"),
      s("Cuidados pessoais", "cuidados-pessoais", "Beleza"), s("Kits de beleza", "kits-de-beleza", "Beleza"),
      s("Roupas", "roupas", "Moda"), s("Calçados", "calcados", "Moda"), s("Bolsas", "bolsas", "Moda"),
      s("Moda masculina", "moda-masculina", "Moda"), s("Moda feminina", "moda-feminina", "Moda"), s("Moda infantil", "moda-infantil", "Moda"),
      s("Arranjos", "arranjos", "Flores e cestas"), s("Cestas de aniversário", "cestas-aniversario", "Flores e cestas"),
      s("Cestas de chocolates", "cestas-chocolates", "Flores e cestas"), s("Kits comemorativos", "kits-comemorativos", "Flores e cestas"),
    ],
  },
  // Preparados para o futuro: ainda sem telas.
  { name: "Moda e calçados", slug: "moda-e-calcados", icon: "shirt", color: "#5C4632", active: false, subs: [] },
  { name: "Papelaria", slug: "papelaria", icon: "pencil", color: "#5C4632", active: false, subs: [] },
  { name: "Serviços", slug: "servicos", icon: "calendar", color: "#5C4632", active: false, subs: [] },
  { name: "Classificados", slug: "classificados", icon: "tag", color: "#5C4632", active: false, subs: [] },
];

/**
 * Bairros reais das cidades atendidas (pelo slug da cidade). Entram como bairros da cidade,
 * sem taxa: nenhuma loja passa a entregar neles sozinha. A loja marca em "Minha loja" onde
 * entrega e informa a taxa e o tempo de cada bairro.
 */
export const CITY_NEIGHBORHOODS: Record<string, string[]> = {
  "joaquim-gomes": ["Centro", "Casal", "Matadouro", "Terrenos", "Asplanas", "Cacimbas"],
};

/** Acrescenta segmentos, subcategorias e bairros que faltam. Devolve o id de cada segmento pelo slug. */
export async function syncTaxonomy(sql: Sql): Promise<Map<string, string>> {
  for (const [index, category] of CATEGORIES.entries()) {
    await sql`
      insert into categories (name, slug, icon, color, sort_order, active)
      values (${category.name}, ${category.slug}, ${category.icon}, ${category.color}, ${index}, ${category.active ?? true})
      on conflict (slug) do nothing`;
  }
  const rows = await sql<{ id: string; slug: string }[]>`select id, slug from categories`;
  const ids = new Map(rows.map((row) => [row.slug, row.id]));
  for (const category of CATEGORIES) {
    for (const [index, sub] of category.subs.entries()) {
      await sql`
        insert into subcategories (category_id, name, slug, group_name, sort_order)
        values (${ids.get(category.slug)!}, ${sub.name}, ${sub.slug}, ${sub.group ?? null}, ${index})
        on conflict (category_id, slug) do nothing`;
    }
  }
  // Só cidades que já existem (num banco recém-criado, a cidade vem depois, pelo seed).
  for (const [citySlug, names] of Object.entries(CITY_NEIGHBORHOODS)) {
    for (const name of names) {
      await sql`
        insert into neighborhoods (city_id, name)
        select id, ${name} from cities where slug = ${citySlug}
        on conflict (city_id, name) do nothing`;
    }
  }
  return ids;
}
