// Lojas e cardápios fictícios do seed de desenvolvimento. Todos os nomes são inventados.
import type { PriceMode } from "../../src/lib/catalog/pricing.ts";

/** Desenho usado na foto gerada do produto. */
export type Art =
  | "pizza" | "burger" | "acai" | "bottle" | "grocery" | "medicine"
  | "fish" | "bread" | "lunchbox" | "sushi" | "cake" | "jar";

export type OptionDef = { name: string; price?: number; label?: string; available?: boolean };
export type GroupDef = { key: string; name: string; options: OptionDef[] };

export type GroupLink = {
  group: string;
  required?: boolean;
  min?: number;
  max?: number;
  repeat?: boolean;
  mode?: PriceMode;
  free?: number;
  /** Preço de cada opção neste produto, pelo nome da opção. */
  prices?: Record<string, number>;
};

export type ProductDef = {
  name: string;
  price: number;
  section: string;
  art: Art;
  desc?: string;
  groups?: GroupLink[];
  ageCheck?: boolean;
  leadMinutes?: number;
  stock?: number;
  /** Dias da semana (0 = domingo) e faixa de horário opcional em que pode ser pedido. */
  availability?: { days: number[]; from?: string; to?: string };
  available?: boolean;
  noImage?: boolean;
  featured?: boolean;
  maxPerOrder?: number;
};

export type Shift = { days: number[]; open: string; close: string; pickupOnly?: boolean };

export type StoreDef = {
  key: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  color: string;
  status?: "pending" | "active" | "suspended";
  city?: "neighbor";
  hours: Shift[];
  commission: number;
  prepMinutes: number;
  minOrder: number;
  /** "urban" = só os bairros da cidade; "all" = também as comunidades rurais. */
  areas: "urban" | "all" | string[];
  scheduled?: { cutoff?: string; windowStart?: string; windowEnd?: string };
  pizzaPricing?: "highest" | "average";
  featured?: boolean;
  founder?: boolean;
  /** "platform": quem entrega é a rede de entregadores do Chegô, e não a equipe da loja. */
  deliveryBy?: "platform";
  /** Participação relativa no histórico de pedidos gerado. */
  weight: number;
  groups?: GroupDef[];
  products: ProductDef[];
};

/** R$ 12,50 -> 1250 centavos. */
const c = (reais: number) => Math.round(reais * 100);
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const MON_SAT = [1, 2, 3, 4, 5, 6];
const TUE_SUN = [2, 3, 4, 5, 6, 0];

const names = (list: string[], price = 0, label?: string): OptionDef[] =>
  list.map((name) => ({ name, price, label }));

// ------------------------------------------------------------------ pizzaria

const PIZZA_SIZES = [
  { name: "Pizza Broto", slices: 4, flavors: 1 },
  { name: "Pizza Média", slices: 6, flavors: 2 },
  { name: "Pizza Grande", slices: 8, flavors: 2 },
  { name: "Pizza Família", slices: 12, flavors: 3 },
];

const FLAVORS = [
  { label: "Tradicionais", prices: [25, 35, 45, 60], list: ["Mussarela", "Calabresa", "Portuguesa", "Frango com Catupiry", "Margherita", "Napolitana", "Milho com Bacon", "Atum"] },
  { label: "Especiais", prices: [32, 44, 56, 74], list: ["Carne de Sol com Queijo Coalho", "Charque com Cebola Roxa", "Camarão", "Quatro Queijos", "Calabresa Especial com Cheddar"] },
  { label: "Doces", prices: [27, 37, 47, 62], list: ["Chocolate com Morango", "Banana com Canela", "Romeu e Julieta", "Prestígio"] },
];

const CRUSTS = [
  { name: "Catupiry", prices: [5, 7, 8, 10] },
  { name: "Cheddar", prices: [5, 7, 8, 10] },
  { name: "Chocolate", prices: [6, 8, 9, 11] },
];

const pizzaProducts: ProductDef[] = PIZZA_SIZES.map((size, index) => ({
  name: `${size.name} (${size.slices} fatias)`,
  price: 0,
  section: "Pizzas",
  art: "pizza",
  desc: size.flavors === 1 ? "Escolha 1 sabor." : `Escolha até ${size.flavors} sabores.`,
  featured: size.name === "Pizza Grande",
  groups: [
    {
      group: "sabores", required: true, min: 1, max: size.flavors, mode: "highest",
      prices: Object.fromEntries(
        FLAVORS.flatMap((family) => family.list.map((flavor) => [flavor, c(family.prices[index])])),
      ),
    },
    {
      group: "bordas", max: 1, mode: "sum",
      prices: Object.fromEntries(CRUSTS.map((crust) => [crust.name, c(crust.prices[index])])),
    },
  ],
}));

const softDrinks = (section: string): ProductDef[] => [
  { name: "Refrigerante 2 L", price: c(12), section, art: "bottle" },
  { name: "Refrigerante lata", price: c(6), section, art: "bottle" },
  { name: "Água mineral 500 ml", price: c(3), section, art: "bottle", noImage: true },
];

// -------------------------------------------------------------------- mercado

const grocery = (section: string, items: [string, number, number][], art: Art = "grocery"): ProductDef[] =>
  items.map(([name, price, stock]) => ({ name, price: c(price), section, art, stock }));

const marketProducts: ProductDef[] = [
  ...grocery("Hortifrúti", [
    ["Tomate 1 kg", 7.5, 30], ["Cebola 1 kg", 5.9, 40], ["Banana prata dúzia", 6, 25],
    ["Batata 1 kg", 6.5, 35], ["Alface unidade", 3, 4], ["Cenoura 1 kg", 5.5, 20],
    ["Limão 1 kg", 4.9, 18], ["Mamão unidade", 7, 0], ["Coentro maço", 2, 15],
  ]),
  ...grocery("Mercearia", [
    ["Arroz branco 1 kg", 6.9, 80], ["Feijão carioca 1 kg", 8.5, 60], ["Açúcar 1 kg", 4.8, 70],
    ["Café torrado 250 g", 9.9, 45], ["Flocão de milho 500 g", 2.9, 90], ["Óleo de soja 900 ml", 7.9, 50],
    ["Macarrão espaguete 500 g", 4.5, 55], ["Sal refinado 1 kg", 2.5, 40], ["Farinha de mandioca 1 kg", 7, 30],
    ["Farinha de trigo 1 kg", 5.5, 3], ["Molho de tomate 340 g", 3.2, 48], ["Biscoito cream cracker 400 g", 5.9, 36],
    ["Leite em pó 400 g", 16.9, 22], ["Achocolatado 400 g", 8.9, 0],
  ]),
  ...grocery("Carnes", [
    ["Frango inteiro congelado 1 kg", 13.9, 20], ["Carne moída bandeja 500 g", 17.9, 12],
    ["Linguiça calabresa 500 g", 15.5, 14], ["Coxa e sobrecoxa bandeja 1 kg", 14.9, 2],
    ["Charque bandeja 500 g", 26.9, 10],
  ]),
  ...grocery("Laticínios", [
    ["Leite integral 1 L", 5.9, 60], ["Manteiga 200 g", 11.9, 25], ["Queijo coalho 500 g", 22, 15],
    ["Iogurte natural 170 g", 3.5, 30], ["Requeijão cremoso 200 g", 8.9, 18], ["Ovos bandeja com 12", 11.5, 5],
  ]),
  ...grocery("Padaria", [
    ["Pão de forma 500 g", 8.5, 20], ["Bolacha doce 300 g", 4.9, 26], ["Torrada 160 g", 5.5, 16],
  ], "bread"),
  ...grocery("Bebidas", [
    ["Refrigerante 2 L", 9.9, 48], ["Suco em pó 30 g", 1.5, 100], ["Água mineral 1,5 L", 3.5, 60],
    ["Água de coco 1 L", 9.5, 12], ["Suco de caixa 1 L", 7.9, 0],
  ], "bottle"),
  ...grocery("Limpeza", [
    ["Sabão em pó 800 g", 12.9, 30], ["Detergente 500 ml", 2.9, 70], ["Água sanitária 1 L", 4.5, 40],
    ["Desinfetante 500 ml", 5.9, 28], ["Esponja de aço pacote", 3.2, 44], ["Sabão em barra 5 unidades", 9.9, 4],
    ["Amaciante 2 L", 13.9, 15],
  ]),
  ...grocery("Higiene", [
    ["Sabonete 85 g", 2.5, 90], ["Creme dental 90 g", 4.9, 50], ["Papel higiênico 4 rolos", 6.9, 60],
    ["Desodorante aerossol 150 ml", 13.9, 20], ["Xampu 325 ml", 12.5, 18], ["Condicionador 325 ml", 13.5, 16],
    ["Escova de dentes", 6.9, 24], ["Absorvente pacote com 8", 5.9, 22], ["Fralda descartável M pacote", 34.9, 9],
    ["Algodão 50 g", 3.9, 30], ["Cotonete caixa com 75", 3.5, 28],
  ]),
];
marketProducts[4].noImage = true;
marketProducts[12].noImage = true;

// ---------------------------------------------------------------------- lojas

export const STORES: StoreDef[] = [
  {
    key: "pizzaria", name: "Pizzaria Forno de Barro", slug: "pizzaria-forno-de-barro", category: "restaurantes",
    description: "Pizza no forno a lenha, com massa feita na casa.", color: "#B4480F",
    hours: [{ days: TUE_SUN, open: "18:00", close: "23:30" }],
    commission: 0.12, prepMinutes: 35, minOrder: c(25), areas: ["Sítio Riacho Fundo"], pizzaPricing: "highest",
    featured: true, weight: 16,
    groups: [
      {
        key: "sabores", name: "Sabores",
        options: FLAVORS.flatMap((family) =>
          family.list.map((name) => ({ name, label: family.label, available: name !== "Camarão" })),
        ),
      },
      { key: "bordas", name: "Borda", options: CRUSTS.map((crust) => ({ name: crust.name })) },
      { key: "sabores_combo", name: "Sabores tradicionais", options: names(FLAVORS[0].list) },
    ],
    products: [
      ...pizzaProducts,
      {
        name: "Combo Pizza Grande + Refrigerante 2 L", price: c(52), section: "Combos", art: "pizza",
        desc: "Pizza grande com até 2 sabores tradicionais e um refrigerante de 2 litros.",
        groups: [{ group: "sabores_combo", required: true, min: 1, max: 2, mode: "sum" }],
      },
      ...softDrinks("Bebidas"),
      { name: "Suco natural 500 ml", price: c(8), section: "Bebidas", art: "bottle" },
    ],
  },
  {
    key: "lasanha", deliveryBy: "platform", name: "Casa da Lasanha", slug: "casa-da-lasanha", category: "restaurantes",
    description: "Lasanhas artesanais, prontas ou congeladas.", color: "#A63D2F",
    hours: [{ days: ALL_DAYS, open: "11:00", close: "14:00" }, { days: ALL_DAYS, open: "18:00", close: "22:00" }],
    commission: 0.10, prepMinutes: 40, minOrder: c(20), areas: "urban", weight: 6,
    groups: [{ key: "preparo", name: "Como você quer?", options: names(["Pronta para comer", "Congelada"]) }],
    products: [
      ...([["Bolonhesa", 22, 65], ["Frango com Catupiry", 24, 70], ["Quatro Queijos", 26, 75], ["Carne de Sol", 28, 80]] as const).flatMap(
        ([flavor, single, family]): ProductDef[] => [
          { name: `Lasanha ${flavor} individual`, price: c(single), section: "Individuais", art: "lunchbox", groups: [{ group: "preparo", required: true, min: 1, max: 1 }] },
          { name: `Lasanha ${flavor} família`, price: c(family), section: "Família (serve 4)", art: "lunchbox", groups: [{ group: "preparo", required: true, min: 1, max: 1 }] },
        ],
      ),
      ...softDrinks("Bebidas"),
    ],
  },
  {
    key: "quentinha", name: "Quentinha da Dona Lia", slug: "quentinha-da-dona-lia", category: "restaurantes",
    description: "Comida caseira no almoço, com prato do dia.", color: "#8A5A12",
    hours: [{ days: MON_SAT, open: "09:00", close: "14:00" }],
    commission: 0.10, prepMinutes: 25, minOrder: c(15), areas: "urban", weight: 12,
    scheduled: { cutoff: "11:00", windowStart: "11:30", windowEnd: "13:30" },
    groups: [
      { key: "tamanho", name: "Tamanho", options: [{ name: "P", price: 0 }, { name: "G", price: c(5) }] },
      { key: "acompanhamentos", name: "Acompanhamentos", options: names(["Arroz branco", "Feijão", "Macarrão", "Farofa", "Salada", "Vinagrete", "Purê", "Baião de dois"]) },
      { key: "proteina", name: "Proteína extra", options: [{ name: "Proteína extra", price: c(6) }] },
    ],
    products: [
      ...(["Frango guisado", "Carne de sol acebolada", "Feijoada", "Peixe frito", "Galinha caipira", "Churrasco misto"]).map(
        (dish, index): ProductDef => ({
          name: `Quentinha de ${dish}`, price: c(15), section: "Prato do dia", art: "lunchbox",
          desc: "Prato do dia. Escolha o tamanho e 3 acompanhamentos.",
          availability: { days: [index + 1] },
          groups: [
            { group: "tamanho", required: true, min: 1, max: 1, mode: "sum" },
            { group: "acompanhamentos", required: true, min: 3, max: 3 },
            { group: "proteina", max: 1, mode: "sum" },
          ],
        }),
      ),
      { name: "Marmita Fitness", price: c(22), section: "Todo dia", art: "lunchbox", desc: "Frango grelhado, arroz integral e legumes." },
      { name: "Suco do dia 300 ml", price: c(5), section: "Todo dia", art: "bottle" },
    ],
  },
  {
    key: "sushi", deliveryBy: "platform", name: "Sushi Maré", slug: "sushi-mare", category: "restaurantes",
    description: "Combinados, temakis e hot rolls.", color: "#1F6F78",
    hours: [{ days: [3, 4, 5, 6, 0], open: "18:00", close: "23:00" }],
    commission: 0.12, prepMinutes: 45, minOrder: c(30), areas: "urban", weight: 5,
    groups: [
      { key: "hashi", name: "Enviar hashi?", options: names(["Sim", "Não"]) },
      { key: "extras", name: "Extras", options: [{ name: "Molho tarê extra", price: c(2) }, { name: "Sem cebolinha", price: 0 }] },
    ],
    products: ([["Combo 15 peças", 45], ["Combo 30 peças", 79], ["Combo 50 peças", 125], ["Temaki de salmão", 26], ["Hot roll 10 peças", 28]] as const).map(
      ([name, price]): ProductDef => ({
        name, price: c(price), section: name.startsWith("Combo") ? "Combinados" : "Avulsos", art: "sushi",
        groups: [{ group: "hashi", required: true, min: 1, max: 1 }, { group: "extras", max: 2, mode: "sum" }],
      }),
    ),
  },
  {
    key: "peixaria", name: "Peixaria Águas Claras", slug: "peixaria-aguas-claras", category: "restaurantes",
    description: "Peixe fresco em porções fixas, limpo do seu jeito.", color: "#1B5E8C",
    hours: [
      { days: [2, 3, 4, 5, 6], open: "07:00", close: "17:00" },
      { days: [0], open: "07:00", close: "17:00", pickupOnly: true },
    ],
    commission: 0.08, prepMinutes: 20, minOrder: c(18), areas: "urban", weight: 4,
    groups: [{ key: "preparo", name: "Como preparar", options: names(["Inteiro", "Limpo", "Em postas", "Filetado"]) }],
    products: [
      ...([["Tilápia inteira — bandeja 1 kg", 28], ["Filé de tilápia — bandeja 500 g", 25], ["Camarão limpo — bandeja 500 g", 45], ["Sardinha — bandeja 1 kg", 18], ["Postas de cavala — bandeja 1 kg", 38]] as const).map(
        ([name, price]): ProductDef => ({
          name, price: c(price), section: "Peixes e frutos do mar", art: "fish",
          groups: [{ group: "preparo", required: true, min: 1, max: 1 }],
        }),
      ),
      { name: "Peixe frito pronto — porção", price: c(30), section: "Prontos", art: "fish" },
    ],
  },
  {
    key: "burger", name: "Brasa Burger", slug: "brasa-burger", category: "lanches",
    description: "Hambúrguer artesanal na brasa.", color: "#7A2E0E",
    hours: [{ days: ALL_DAYS, open: "18:00", close: "00:00" }],
    commission: 0.12, prepMinutes: 30, minOrder: c(20), areas: "urban", weight: 15,
    groups: [
      { key: "ponto", name: "Ponto da carne", options: names(["Ao ponto", "Bem passado"]) },
      { key: "adicionais", name: "Adicionais", options: [{ name: "Bacon", price: c(4) }, { name: "Cheddar", price: c(3) }, { name: "Ovo", price: c(2) }, { name: "Carne extra", price: c(8) }, { name: "Queijo coalho", price: c(4) }] },
      { key: "retirar", name: "Retirar ingredientes", options: names(["Cebola", "Tomate", "Alface", "Picles", "Molho"]) },
      { key: "combo", name: "Transformar em combo?", options: [{ name: "Batata média + refrigerante lata", price: c(10) }] },
      { key: "milkshake", name: "Sabor", options: names(["Chocolate", "Morango", "Baunilha", "Ovomaltine"]) },
    ],
    products: [
      ...([["Brasa Clássico", 22, "Pão, carne 150 g, queijo, alface, tomate e molho da casa.", true], ["Brasa Bacon", 26, "Com bacon crocante e cheddar.", true], ["Brasa Duplo", 32, "Duas carnes de 150 g e queijo em dobro.", true], ["Brasa Nordestino", 29, "Com queijo coalho e manteiga de garrafa.", true], ["Frango Crispy", 24, "Frango empanado crocante.", false], ["Veggie", 24, "Hambúrguer de grão-de-bico.", false]] as const).map(
        ([name, price, desc, beef]): ProductDef => ({
          name, price: c(price), desc, section: "Hambúrgueres", art: "burger", featured: name === "Brasa Nordestino",
          groups: [
            ...(beef ? [{ group: "ponto", required: true, min: 1, max: 1 } satisfies GroupLink] : []),
            { group: "adicionais", max: 5, mode: "sum" },
            { group: "retirar", max: 5 },
            { group: "combo", max: 1, mode: "sum" },
          ],
        }),
      ),
      { name: "Batata frita", price: c(15), section: "Porções", art: "burger" },
      { name: "Batata com cheddar e bacon", price: c(24), section: "Porções", art: "burger" },
      { name: "Anéis de cebola", price: c(18), section: "Porções", art: "burger", noImage: true },
      { name: "Milkshake 400 ml", price: c(16), section: "Bebidas", art: "acai", groups: [{ group: "milkshake", required: true, min: 1, max: 1 }] },
      { name: "Refrigerante lata", price: c(6), section: "Bebidas", art: "bottle" },
    ],
  },
  {
    key: "delicias", name: "Delícias da Vó", slug: "delicias-da-vo", category: "lanches",
    description: "Salgados, bolos e doces para o dia a dia e para a sua festa.", color: "#9C3D6B",
    hours: [{ days: MON_SAT, open: "08:00", close: "19:00" }],
    commission: 0.10, prepMinutes: 20, minOrder: c(10), areas: "urban", weight: 6,
    scheduled: {},
    groups: [
      { key: "salgados", name: "Sabores", options: names(["Coxinha", "Risole", "Pastel", "Bolinha de queijo", "Enroladinho"]) },
      { key: "bolo", name: "Sabor", options: names(["Chocolate", "Ninho com morango", "Cenoura com chocolate", "Prestígio"]) },
    ],
    products: [
      ...["Coxinha", "Risole", "Pastel", "Bolinha de queijo", "Enroladinho"].map(
        (name): ProductDef => ({ name, price: c(5), section: "Salgados", art: "bread" }),
      ),
      { name: "Cento de salgadinhos", price: c(90), section: "Encomendas", art: "bread", leadMinutes: 24 * 60, desc: "100 salgadinhos. Escolha até 4 sabores. Encomenda com 24 horas.", groups: [{ group: "salgados", required: true, min: 1, max: 4 }] },
      { name: "Cento de brigadeiro", price: c(110), section: "Encomendas", art: "cake", leadMinutes: 24 * 60, desc: "100 brigadeiros. Encomenda com 24 horas." },
      { name: "Bolo no pote", price: c(12), section: "Doces", art: "jar", groups: [{ group: "bolo", required: true, min: 1, max: 1 }] },
      { name: "Fatia de bolo", price: c(8), section: "Doces", art: "cake", groups: [{ group: "bolo", required: true, min: 1, max: 1 }] },
      { name: "Torta de frango — fatia", price: c(9), section: "Salgados", art: "cake" },
    ],
  },
  {
    key: "padaria", name: "Padaria Pão Quentinho", slug: "padaria-pao-quentinho", category: "cafe-da-manha",
    description: "Pão saindo do forno e café da manhã nordestino.", color: "#B07A1E",
    hours: [{ days: ALL_DAYS, open: "05:30", close: "11:00" }, { days: ALL_DAYS, open: "15:00", close: "20:00" }],
    commission: 0.08, prepMinutes: 15, minOrder: c(8), areas: "urban", weight: 10, founder: true,
    groups: [{ key: "recheio", name: "Recheio", options: [{ name: "Queijo coalho", price: c(3) }, { name: "Frango", price: c(4) }, { name: "Coco com leite condensado", price: c(3) }, { name: "Manteiga", price: 0 }] }],
    products: [
      { name: "Pão francês — unidade", price: c(0.8), section: "Pães", art: "bread", maxPerOrder: 50 },
      { name: "Pão francês — saco com 10", price: c(7.5), section: "Pães", art: "bread", featured: true },
      { name: "Pão doce", price: c(2.5), section: "Pães", art: "bread" },
      { name: "Bolo de milho — fatia", price: c(5), section: "Pães", art: "cake" },
      ...([["Cuscuz com ovo", 10], ["Cuscuz com charque", 14], ["Café com leite", 4], ["Kit café da manhã para 2", 32]] as const).map(
        ([name, price]): ProductDef => ({ name, price: c(price), section: "Café da manhã (até 10h)", art: name.startsWith("Café") ? "jar" : "lunchbox", availability: { days: ALL_DAYS, to: "10:00" } }),
      ),
      { name: "Tapioca", price: c(8), section: "Café da manhã (até 10h)", art: "bread", availability: { days: ALL_DAYS, to: "10:00" }, groups: [{ group: "recheio", required: true, min: 1, max: 2, mode: "sum" }] },
    ],
  },
  {
    key: "acai", name: "Açaí Tropical", slug: "acai-tropical", category: "acai-e-sobremesas",
    description: "Açaí cremoso com os complementos que você escolher.", color: "#5B2A86",
    hours: [{ days: ALL_DAYS, open: "14:00", close: "23:00" }],
    commission: 0.10, prepMinutes: 15, minOrder: c(12), areas: "urban", weight: 13,
    groups: [
      { key: "base", name: "Base", options: names(["Açaí puro", "Açaí com banana", "Cupuaçu"]) },
      { key: "complementos", name: "Complementos", options: names(["Granola", "Leite em pó", "Banana", "Paçoca", "Amendoim", "Flocos de arroz", "Confete", "Jujuba"], c(1)) },
      { key: "adicionais", name: "Adicionais", options: [{ name: "Creme de avelã", price: c(4) }, { name: "Leite condensado", price: c(2) }, { name: "Morango", price: c(3) }, { name: "Kiwi", price: c(3) }, { name: "Bis", price: c(3) }, { name: "Creme de ninho", price: c(4) }] },
      { key: "montagem", name: "Complementos por cima ou em camadas?", options: names(["Por cima", "Em camadas"]) },
    ],
    products: [
      ...([["Açaí 300 ml", 12], ["Açaí 500 ml", 16], ["Açaí 700 ml", 20], ["Barca de açaí 1 L", 35]] as const).map(
        ([name, price]): ProductDef => ({
          name, price: c(price), section: name.startsWith("Barca") ? "Para dividir" : "Copos", art: "acai", featured: name === "Açaí 500 ml",
          groups: [
            { group: "base", required: true, min: 1, max: 1 },
            { group: "complementos", max: 8, mode: "free_up_to", free: 4 },
            { group: "adicionais", max: 6, mode: "sum" },
            { group: "montagem", required: true, min: 1, max: 1 },
          ],
        }),
      ),
    ],
  },
  {
    key: "deposito", name: "Depósito Gelada Já", slug: "deposito-gelada-ja", category: "bebidas",
    description: "Bebida gelada, gelo e carvão na sua porta.", color: "#12507A",
    hours: [{ days: ALL_DAYS, open: "09:00", close: "02:00" }],
    commission: 0.08, prepMinutes: 10, minOrder: c(15), areas: "all", weight: 9,
    groups: [{ key: "temperatura", name: "Temperatura", options: names(["Gelada", "Natural"]) }],
    products: [
      ...([["Cerveja pilsen lata 350 ml", 4.5], ["Cerveja long neck 330 ml", 7], ["Cerveja pilsen — caixa com 12 latas", 48]] as const).map(
        ([name, price]): ProductDef => ({ name, price: c(price), section: "Cervejas", art: "bottle", ageCheck: true, groups: [{ group: "temperatura", required: true, min: 1, max: 1 }] }),
      ),
      ...([["Refrigerante 2 L", 10], ["Água mineral 500 ml", 2.5], ["Água de coco 1 L", 9], ["Energético 250 ml", 9]] as const).map(
        ([name, price]): ProductDef => ({ name, price: c(price), section: "Sem álcool", art: "bottle", groups: [{ group: "temperatura", required: true, min: 1, max: 1 }] }),
      ),
      { name: "Gelo 5 kg", price: c(10), section: "Para o churrasco", art: "jar" },
      { name: "Carvão 3 kg", price: c(18), section: "Para o churrasco", art: "grocery" },
    ],
  },
  {
    key: "mercado", name: "Mercado Boa Compra", slug: "mercado-boa-compra", category: "mercado",
    description: "Sua feira completa, entregue em casa.", color: "#1E7B4F",
    hours: [{ days: MON_SAT, open: "07:00", close: "20:00" }, { days: [0], open: "07:00", close: "12:00" }],
    commission: 0.08, prepMinutes: 40, minOrder: c(30), areas: "all", weight: 11,
    products: marketProducts,
  },
  {
    key: "farmacia", name: "Farmácia Saúde Mais", slug: "farmacia-saude-mais", category: "farmacia",
    description: "Itens sem receita, higiene e cuidados pessoais.", color: "#0F766E",
    hours: [{ days: ALL_DAYS, open: "07:00", close: "22:00" }],
    commission: 0.08, prepMinutes: 15, minOrder: c(10), areas: "all", weight: 6,
    products: ([
      ["Dipirona 500 mg — 10 comprimidos", 6.9, 40, "Sem receita"], ["Paracetamol 750 mg — 10 comprimidos", 8.5, 35, "Sem receita"],
      ["Antiácido efervescente — 2 envelopes", 5.9, 30, "Sem receita"], ["Soro fisiológico 500 ml", 7.5, 25, "Sem receita"],
      ["Sais de reidratação — envelope", 2.5, 60, "Sem receita"], ["Curativo adesivo — caixa com 10", 4.9, 45, "Primeiros socorros"],
      ["Álcool 70% 500 ml", 8.9, 3, "Primeiros socorros"], ["Termômetro digital", 24.9, 8, "Primeiros socorros"],
      ["Protetor solar FPS 50 120 ml", 39.9, 12, "Cuidados pessoais"], ["Repelente 100 ml", 18.9, 14, "Cuidados pessoais"],
      ["Fralda infantil M — pacote", 36.9, 10, "Bebê"], ["Fralda infantil G — pacote", 38.9, 0, "Bebê"],
      ["Absorvente — pacote com 8", 6.5, 26, "Cuidados pessoais"], ["Escova de dentes", 7.9, 20, "Cuidados pessoais"],
      ["Fio dental 50 m", 6.9, 18, "Cuidados pessoais"], ["Preservativo — pacote com 3", 9.9, 30, "Cuidados pessoais"],
    ] as const).map(([name, price, stock, section]): ProductDef => ({ name, price: c(price), stock, section, art: "medicine" })),
  },
  {
    key: "emporio", name: "Empório Vida Verde", slug: "emporio-vida-verde", category: "saudavel",
    description: "Grãos, castanhas e produtos naturais em porções.", color: "#4D7C0F",
    hours: [{ days: MON_SAT, open: "08:00", close: "18:00" }],
    commission: 0.10, prepMinutes: 15, minOrder: c(15), areas: "urban", weight: 3,
    products: ([
      ["Granola 250 g", 12.9], ["Castanha de caju 200 g", 24.9], ["Amendoim torrado 250 g", 8.9], ["Mix de castanhas 200 g", 27.9],
      ["Chá de camomila 30 g", 7.5], ["Chá de erva-doce 30 g", 7.5], ["Mel 300 g", 22], ["Farinha de linhaça 250 g", 9.9],
      ["Aveia em flocos 500 g", 8.5], ["Pasta de amendoim 500 g", 26.9],
    ] as const).map(([name, price]): ProductDef => ({ name, price: c(price), section: name.startsWith("Chá") ? "Chás" : "Grãos e castanhas", art: "jar" })),
  },
  {
    key: "suplementos", deliveryBy: "platform", name: "Força Total Suplementos", slug: "forca-total-suplementos", category: "saudavel",
    description: "Suplementos para o seu treino.", color: "#374151",
    hours: [{ days: MON_SAT, open: "09:00", close: "19:00" }],
    commission: 0.10, prepMinutes: 15, minOrder: c(20), areas: "urban", weight: 3,
    groups: [
      { key: "sabor_whey", name: "Sabor", options: names(["Chocolate", "Baunilha", "Morango"]) },
      { key: "sabor_pre", name: "Sabor", options: names(["Frutas vermelhas", "Limão", "Uva"]) },
      { key: "sabor_barra", name: "Sabor", options: names(["Chocolate", "Cookies", "Amendoim"]) },
    ],
    products: [
      { name: "Whey protein 900 g", price: c(149), section: "Proteínas", art: "jar", groups: [{ group: "sabor_whey", required: true, min: 1, max: 1 }] },
      { name: "Creatina 300 g", price: c(99), section: "Performance", art: "jar" },
      { name: "Pré-treino 300 g", price: c(89), section: "Performance", art: "jar", groups: [{ group: "sabor_pre", required: true, min: 1, max: 1 }] },
      { name: "Barra de proteína", price: c(9), section: "Proteínas", art: "grocery", groups: [{ group: "sabor_barra", required: true, min: 1, max: 1 }] },
      { name: "Coqueteleira 600 ml", price: c(25), section: "Acessórios", art: "bottle" },
    ],
  },
  {
    key: "espetinho", name: "Espetinho do Zé", slug: "espetinho-do-ze", category: "lanches", status: "pending",
    description: "Espetinhos na brasa.", color: "#92400E",
    hours: [{ days: [4, 5, 6, 0], open: "18:00", close: "23:00" }],
    commission: 0.10, prepMinutes: 20, minOrder: c(15), areas: "urban", weight: 0,
    products: ([["Espetinho de carne", 8], ["Espetinho de frango", 7], ["Espetinho de queijo coalho", 8]] as const).map(
      ([name, price]): ProductDef => ({ name, price: c(price), section: "Espetinhos", art: "burger", noImage: true }),
    ),
  },
  {
    key: "pastelaria", name: "Pastelaria Sabor Antigo", slug: "pastelaria-sabor-antigo", category: "lanches", status: "suspended",
    description: "Pastéis fritos na hora.", color: "#A16207",
    hours: [{ days: MON_SAT, open: "16:00", close: "22:00" }],
    commission: 0.10, prepMinutes: 15, minOrder: c(10), areas: "urban", weight: 0,
    products: ([["Pastel de carne", 7], ["Pastel de queijo", 7], ["Pastel de frango com catupiry", 8], ["Caldo de cana 300 ml", 5]] as const).map(
      ([name, price]): ProductDef => ({ name, price: c(price), section: "Pastéis", art: name.startsWith("Caldo") ? "bottle" : "bread" }),
    ),
  },
  {
    key: "lanchonete", name: "Lanchonete Ponto Certo", slug: "lanchonete-ponto-certo", category: "lanches", city: "neighbor",
    description: "Lanches rápidos.", color: "#9A3412",
    hours: [{ days: ALL_DAYS, open: "17:00", close: "23:00" }],
    commission: 0.10, prepMinutes: 20, minOrder: c(10), areas: "urban", weight: 0,
    products: ([["Misto quente", 7], ["X-salada", 14], ["Suco de laranja 300 ml", 6]] as const).map(
      ([name, price]): ProductDef => ({ name, price: c(price), section: "Lanches", art: name.startsWith("Suco") ? "bottle" : "burger" }),
    ),
  },
];
