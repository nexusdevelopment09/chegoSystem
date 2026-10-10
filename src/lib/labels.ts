// Rótulos em português para valores guardados em inglês no banco.

export const STORE_ROLE_LABELS = {
  owner: "Dono",
  attendant: "Atendente",
  courier: "Entregador",
} as const;

/** Emoji mostrado para cada chave de ícone de categoria (leve, sem biblioteca de ícones). */
export const CATEGORY_EMOJI: Record<string, string> = {
  utensils: "🍽️",
  burger: "🍔",
  coffee: "☕",
  "ice-cream": "🍧",
  bottle: "🥤",
  basket: "🛒",
  pill: "💊",
  leaf: "🥗",
};

export const TICKET_REASON_LABELS = {
  delay: "Atraso",
  missing_item: "Item faltando",
  wrong_item: "Item errado",
  damaged_item: "Item danificado",
  billing: "Cobrança",
  other: "Outro",
} as const;

export const TICKET_STATUS_LABELS = {
  open: "Aberto",
  in_progress: "Em andamento",
  waiting_customer: "Aguardando você",
  resolved: "Resolvido",
} as const;

export const STORE_STATUS_LABELS = {
  pending: "Pendente",
  active: "Ativa",
  paused: "Pausada",
  suspended: "Suspensa",
} as const;

// Rede de entregadores do Chegô.
export const VEHICLE_LABELS = { motorcycle: "Moto", bicycle: "Bicicleta", car: "Carro", on_foot: "A pé" } as const;
export type Vehicle = keyof typeof VEHICLE_LABELS;
export const COURIER_KIND_LABELS = { platform: "Entregador do Chegô", partner: "Entregador parceiro" } as const;
export const COURIER_STATUS_LABELS = { pending: "Em análise", active: "Aprovado", blocked: "Bloqueado" } as const;
export const DELIVERY_PROVIDER_LABELS = { store: "Entregador da loja", platform: "Entregadores do Chegô" } as const;
