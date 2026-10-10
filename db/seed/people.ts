// Pessoas e lugares fictícios do seed de desenvolvimento.

export const URBAN = [
  { name: "Centro", fee: 300, min: 20, max: 35 },
  { name: "Vila Nova", fee: 400, min: 30, max: 45 },
  { name: "Alto do Cruzeiro", fee: 500, min: 30, max: 45 },
  { name: "Conjunto Esperança", fee: 500, min: 30, max: 45 },
  { name: "Loteamento Bela Vista", fee: 600, min: 30, max: 45 },
];

export const RURAL = [
  { name: "Sítio Riacho Fundo", fee: 800, min: 45, max: 70 },
  { name: "Povoado Lagoa Seca", fee: 1000, min: 45, max: 70 },
  { name: "Sítio Mata Verde", fee: 1200, min: 45, max: 70 },
];

export const NEIGHBOR_CITY = [
  { name: "Centro", fee: 300, min: 20, max: 35 },
  { name: "Bairro Novo", fee: 400, min: 30, max: 45 },
];

export const CATEGORIES = [
  { name: "Restaurantes", slug: "restaurantes", icon: "utensils" },
  { name: "Lanches", slug: "lanches", icon: "burger" },
  { name: "Café da manhã", slug: "cafe-da-manha", icon: "coffee" },
  { name: "Açaí e sobremesas", slug: "acai-e-sobremesas", icon: "ice-cream" },
  { name: "Bebidas", slug: "bebidas", icon: "bottle" },
  { name: "Mercado", slug: "mercado", icon: "basket" },
  { name: "Farmácia", slug: "farmacia", icon: "pill" },
  { name: "Saudável", slug: "saudavel", icon: "leaf" },
  // Preparado para o futuro: ainda sem telas.
  { name: "Moda e calçados", slug: "moda-e-calcados", icon: "shirt", active: false },
  { name: "Papelaria", slug: "papelaria", icon: "pencil", active: false },
  { name: "Serviços", slug: "servicos", icon: "calendar", active: false },
  { name: "Classificados", slug: "classificados", icon: "tag", active: false },
];

/** Um dono por loja, na mesma ordem de STORES. */
export const OWNER_NAMES = [
  "Marcos Antônio Tavares", "Luciana Prado", "Maria Lia Correia", "Renato Yamada", "Sebastião Marinho",
  "Thiago Bezerra", "Dona Zefinha Moura", "Paulo Sérgio Leite", "Camila Duarte", "Wellington Farias",
  "Rosângela Batista", "Dr. Fábio Queiroz", "Larissa Pontes", "Rafael Guedes", "José Cícero Lins",
  "Edvaldo Nascimento", "Sandra Melo",
];

export type CustomerDef = {
  key: string;
  name: string;
  neighborhood: string;
  street: string;
  number: string;
  reference?: string;
  /** Participação relativa no histórico de pedidos gerado. */
  weight: number;
  blocked?: boolean;
  minor?: boolean;
  scenario: string;
};

export const CUSTOMERS: CustomerDef[] = [
  { key: "ana", name: "Ana Clara Souza", neighborhood: "Centro", street: "Rua do Comércio", number: "120", weight: 30, scenario: "Cliente frequente: muitos pedidos, favoritos e avaliações." },
  { key: "bruno", name: "Bruno Henrique Lima", neighborhood: "Vila Nova", street: "Rua das Mangueiras", number: "45", weight: 15, scenario: "Pedidos variados. Tem um pedido pago esperando aceite na pizzaria." },
  { key: "carla", name: "Carla Mendes", neighborhood: "Sítio Riacho Fundo", street: "Estrada do Riacho", number: "S/N", reference: "Casa azul depois da ponte, portão de madeira", weight: 8, scenario: "Zona rural, com ponto de referência." },
  { key: "diego", name: "Diego Alves", neighborhood: "Alto do Cruzeiro", street: "Rua da Paz", number: "18", weight: 0, scenario: "Cliente novo, sem nenhum pedido (cupom de primeira compra e indicação)." },
  { key: "eduarda", name: "Eduarda Santos", neighborhood: "Conjunto Esperança", street: "Quadra C", number: "7", weight: 6, scenario: "Tem um pedido aguardando pagamento, com Pix aberto." },
  { key: "felipe", name: "Felipe Rocha", neighborhood: "Centro", street: "Avenida Principal", number: "310", weight: 10, scenario: "Tem um pedido saindo para entrega." },
  { key: "gabriela", name: "Gabriela Nunes", neighborhood: "Loteamento Bela Vista", street: "Rua 3", number: "22", weight: 8, scenario: "Tem um chamado de suporte aberto." },
  { key: "henrique", name: "Henrique Costa", neighborhood: "Vila Nova", street: "Rua das Flores", number: "9", weight: 4, blocked: true, scenario: "Cliente bloqueado: não consegue fazer pedido." },
  { key: "isabela", name: "Isabela Ferreira", neighborhood: "Centro", street: "Travessa São José", number: "5", weight: 5, minor: true, scenario: "Tem 17 anos: não pode comprar bebida alcoólica." },
  { key: "joao", name: "João Pedro Barros", neighborhood: "Povoado Lagoa Seca", street: "Rua da Igreja", number: "S/N", reference: "Ao lado da mercearia do povoado", weight: 6, scenario: "Zona rural. Tem um pedido recusado com reembolso." },
];

/**
 * Rede de entregadores do Chegô: os da própria plataforma e os parceiros autônomos.
 * Um parceiro está em análise e outro bloqueado, para testar a aprovação pelo admin.
 */
export const COURIERS = [
  { name: "Wesley Santana", kind: "platform", status: "active", vehicle: "motorcycle", plate: "QWE1A23", available: true, scenario: "Entregador do próprio Chegô, disponível." },
  { name: "Patrícia Lopes", kind: "platform", status: "active", vehicle: "bicycle", plate: null, available: false, scenario: "Entregadora do próprio Chegô, parada no momento." },
  { name: "Jonas Ferreira", kind: "partner", status: "active", vehicle: "motorcycle", plate: "RTY4B56", available: true, scenario: "Parceiro aprovado, disponível, com ganhos a receber." },
  { name: "Kelly Araújo", kind: "partner", status: "pending", vehicle: "bicycle", plate: null, available: false, scenario: "Parceira esperando a aprovação do admin." },
  { name: "Marcelo Dias", kind: "partner", status: "blocked", vehicle: "car", plate: "UIO7C89", available: false, scenario: "Parceiro bloqueado pelo admin." },
] as const;

export const GOOD_COMMENTS = [
  "Chegou rapidinho e quentinho!", "Muito bom, como sempre.", "Tudo certinho, recomendo.",
  "Entrega no prazo e bem embalado.", "Gostei demais, vou pedir de novo.", "Atendimento nota dez.",
];
export const OK_COMMENTS = ["Estava bom, mas demorou um pouco.", "Bom, só veio menos molho do que eu esperava.", "Normal, nada demais."];
export const BAD_COMMENTS = ["Demorou muito para chegar.", "Veio faltando um item.", "Chegou frio."];
export const REPLIES = ["Obrigado pela preferência! Volte sempre.", "Que bom que gostou! Até a próxima.", "Agradecemos o retorno, vamos melhorar."];
export const REJECT_REASONS = ["Item esgotado", "Loja muito cheia", "Fora da área de entrega"];
