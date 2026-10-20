// Regras do estoque. Funções puras (datas no horário de Maceió, como o resto do app).

export type StockUnit = "un" | "kg" | "g" | "l" | "ml" | "pacote" | "caixa";

export const UNIT_LABELS: Record<StockUnit, { short: string; long: string }> = {
  un: { short: "un.", long: "unidade" },
  kg: { short: "kg", long: "quilo" },
  g: { short: "g", long: "grama" },
  l: { short: "L", long: "litro" },
  ml: { short: "ml", long: "mililitro" },
  pacote: { short: "pct.", long: "pacote" },
  caixa: { short: "cx.", long: "caixa" },
};

export const MOVEMENT_LABELS = {
  compra: "Compra / reposição",
  venda: "Venda",
  producao: "Consumo na produção",
  perda: "Perda / desperdício",
  vencido: "Vencido (descarte)",
  ajuste: "Ajuste de inventário",
  devolucao: "Devolução",
  transferencia: "Transferência",
} as const;
export type MovementKind = keyof typeof MOVEMENT_LABELS;

/** Quantidades com até 3 casas, no formato brasileiro: 1,5 kg; 80 un. */
export function formatQuantity(value: number, unit: StockUnit): string {
  const rounded = Math.round(value * 1000) / 1000;
  return `${rounded.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${UNIT_LABELS[unit].short}`;
}

/** "1,5" ou "1.5" -> 1.5. Vazio ou inválido -> null. */
export function parseQuantity(text: string): number | null {
  const clean = text.trim().replace(/\s/g, "");
  if (!clean) return null;
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

export type StockLevel = "zerado" | "baixo" | "repor" | "normal";

/**
 * Situação de um item pelo estoque mínimo: zerado; abaixo da metade do mínimo = "baixo";
 * abaixo do mínimo = "repor"; senão normal. Sem mínimo cadastrado, só "zerado" ou "normal".
 */
export function stockLevel(quantity: number, minQuantity: number): StockLevel {
  if (quantity <= 0) return "zerado";
  if (minQuantity <= 0) return "normal";
  if (quantity < minQuantity / 2) return "baixo";
  if (quantity < minQuantity) return "repor";
  return "normal";
}

export const LEVEL_LABELS: Record<StockLevel, string> = { zerado: "Sem estoque", baixo: "Estoque baixo", repor: "Repor", normal: "Normal" };

/** Dias (de calendário, em Maceió) de hoje até a validade. Negativo = vencido há tantos dias. */
export function daysUntil(expiresAt: string, today: string): number {
  return Math.round((Date.parse(`${expiresAt}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

export type ExpiryStatus = "vencido" | "vence_hoje" | "urgente" | "atencao" | "ok" | "sem_validade";

/**
 * Situação de um lote: vencido (validade antes de hoje); vence hoje; "urgente" dentro do menor
 * aviso; "atenção" dentro do maior aviso configurado; senão ok.
 */
export function expiryStatus(expiresAt: string | null, today: string, warningDays: number[]): ExpiryStatus {
  if (!expiresAt) return "sem_validade";
  const days = daysUntil(expiresAt, today);
  if (days < 0) return "vencido";
  if (days === 0) return "vence_hoje";
  const sorted = [...warningDays].filter((day) => day > 0).sort((a, b) => a - b);
  if (sorted.length > 0 && days <= sorted[0]) return "urgente";
  if (sorted.length > 0 && days <= sorted[sorted.length - 1]) return "atencao";
  return "ok";
}

export const EXPIRY_LABELS: Record<ExpiryStatus, string> = {
  vencido: "Vencido", vence_hoje: "Vence hoje", urgente: "Vence logo", atencao: "Atenção", ok: "No prazo", sem_validade: "Sem validade",
};

/** Quanto de um produto vendido por peso sai do item do estoque, na unidade do item. */
export function soldAmount(quantity: number, weightStepGrams: number | null, unit: StockUnit): number {
  if (!weightStepGrams) return quantity;
  const grams = quantity * weightStepGrams;
  if (unit === "kg") return grams / 1000;
  if (unit === "g") return grams;
  return quantity;
}

export type RecipeLine = { productId: string; optionId: string | null; itemId: string; quantity: number };
export type SoldLine = {
  productId: string;
  quantity: number;
  /** Opções escolhidas, com a quantidade e quantas opções foram escolhidas no grupo dela. */
  options: { optionId: string; quantity: number; groupChoices: number; split: boolean }[];
};

/**
 * Consumo estimado de insumos pela ficha técnica. Linhas do produto contam por unidade
 * vendida; linhas de uma opção (o sabor) contam pela opção escolhida. Em grupos "meio a meio"
 * (preço pelo maior ou pela média), cada sabor conta pela fração dele (1/2, 1/3...).
 * Sem ficha técnica, nada é estimado (não inventa consumo).
 */
export function estimateConsumption(sold: SoldLine[], recipe: RecipeLine[]): Map<string, number> {
  const total = new Map<string, number>();
  const add = (itemId: string, amount: number) => total.set(itemId, Math.round(((total.get(itemId) ?? 0) + amount) * 10_000) / 10_000);
  for (const line of sold) {
    for (const entry of recipe.filter((row) => row.productId === line.productId && row.optionId === null)) add(entry.itemId, entry.quantity * line.quantity);
    for (const option of line.options) {
      const share = option.split && option.groupChoices > 1 ? 1 / option.groupChoices : 1;
      for (const entry of recipe.filter((row) => row.productId === line.productId && row.optionId === option.optionId)) {
        add(entry.itemId, entry.quantity * option.quantity * share * line.quantity);
      }
    }
  }
  return total;
}

export type ReplenishmentInput = {
  quantity: number;
  minQuantity: number;
  idealQuantity: number | null;
  leadTimeDays: number | null;
  /** Saídas (venda + consumo) por dia, nos últimos 7 e nos 7 anteriores, e nos últimos 30. */
  out7: number;
  outPrev7: number;
  out30: number;
  /** Quantos dias de estoque a loja quer ter depois de repor. */
  coverDays: number;
};

export type Replenishment = {
  dailyAverage: number;
  trend: "subindo" | "caindo" | "estavel" | "sem_dados";
  daysLeft: number | null;
  safetyStock: number;
  suggested: number;
  reason: string;
};

/**
 * Sugestão de compra a partir do consumo real registrado (vendas e fichas técnicas).
 * Média diária = maior entre a dos últimos 7 e a dos últimos 30 dias (não subestima quando
 * a venda está subindo). Estoque de segurança = mínimo cadastrado + consumo durante o prazo
 * do fornecedor. Sugere chegar ao ideal cadastrado ou a `coverDays` dias de consumo.
 */
export function replenishment(input: ReplenishmentInput): Replenishment {
  const avg7 = input.out7 / 7;
  const avg30 = input.out30 / 30;
  const dailyAverage = Math.round(Math.max(avg7, avg30) * 1000) / 1000;
  const trend = input.out7 === 0 && input.outPrev7 === 0 ? "sem_dados"
    : input.out7 > input.outPrev7 * 1.15 ? "subindo" : input.out7 < input.outPrev7 * 0.85 ? "caindo" : "estavel";
  const lead = input.leadTimeDays ?? 0;
  const safetyStock = Math.round((input.minQuantity + dailyAverage * lead) * 1000) / 1000;
  const target = Math.max(input.idealQuantity ?? 0, safetyStock + dailyAverage * input.coverDays);
  const suggested = Math.max(0, Math.round((target - input.quantity) * 1000) / 1000);
  const daysLeft = dailyAverage > 0 ? Math.floor(input.quantity / dailyAverage) : null;

  let reason: string;
  if (dailyAverage === 0) {
    reason = suggested > 0 ? "Sem consumo registrado: sugestão só pelo estoque mínimo/ideal cadastrado." : "Sem consumo registrado e acima do mínimo.";
  } else {
    reason = `Consumo médio de ${dailyAverage.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} por dia`
      + (daysLeft !== null ? `; o estoque atual dura cerca de ${daysLeft} dia${daysLeft === 1 ? "" : "s"}` : "")
      + (lead > 0 ? `; o fornecedor leva ${lead} dia${lead === 1 ? "" : "s"}` : "")
      + (trend === "subindo" ? "; vendas subindo" : trend === "caindo" ? "; vendas caindo" : "")
      + ".";
  }
  return { dailyAverage, trend, daysLeft, safetyStock, suggested, reason };
}
