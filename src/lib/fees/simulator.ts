// Simulador de receita do Chegô (painel do admin). Funções puras: nada aqui lê nem grava
// no banco, então uma simulação nunca vira taxa, cobrança ou fechamento de verdade.
// Dinheiro sempre em centavos inteiros.

export type Scenario = "conservador" | "intermediario" | "otimista";

export type SimulationInput = {
  stores: number;
  /** Pedidos por loja por dia. */
  ordersPerStoreDay: number;
  days: number;
  /** Tarifa simulada por pedido (centavos). Não muda a tarifa de produção. */
  feeCents: number;
  /**
   * Percentual de pedidos que chegam a ser entregues ou retirados. Só se aplica quando
   * ordersAreEligible é falso: se os pedidos informados já são os concluídos, aplicar o
   * percentual de novo contaria a perda duas vezes.
   */
  eligiblePercent: number;
  ordersAreEligible: boolean;
  /** Crescimento do número de lojas por mês, em %, para a projeção de 12 meses. */
  monthlyStoreGrowthPercent: number;
};

export const DEFAULT_FEE_CENTS = 50;

export const SCENARIOS: Record<Scenario, { label: string; input: SimulationInput }> = {
  conservador: {
    label: "Conservador",
    input: { stores: 10, ordersPerStoreDay: 10, days: 30, feeCents: DEFAULT_FEE_CENTS, eligiblePercent: 100, ordersAreEligible: true, monthlyStoreGrowthPercent: 5 },
  },
  intermediario: {
    label: "Intermediário",
    input: { stores: 50, ordersPerStoreDay: 15, days: 30, feeCents: DEFAULT_FEE_CENTS, eligiblePercent: 100, ordersAreEligible: true, monthlyStoreGrowthPercent: 10 },
  },
  otimista: {
    label: "Otimista",
    input: { stores: 100, ordersPerStoreDay: 20, days: 30, feeCents: DEFAULT_FEE_CENTS, eligiblePercent: 100, ordersAreEligible: true, monthlyStoreGrowthPercent: 15 },
  },
};

export type SimulationResult = {
  /** Pedidos que geram tarifa no período (lojas × pedidos elegíveis por loja/dia × dias). */
  eligibleOrders: number;
  /** Receita bruta do período: pedidos elegíveis × tarifa. Não é lucro. */
  revenueCents: number;
  dailyCents: number;
  weeklyCents: number;
  /** Mês padronizado de 30 dias. */
  monthly30Cents: number;
  /** 365 dias no ritmo atual, sem crescimento. */
  annualCents: number;
  /** 12 meses de 30 dias com as lojas crescendo a cada mês. */
  growth: { month: number; stores: number; revenueCents: number }[];
  /** Soma dos 12 meses da projeção com crescimento. */
  growthYearCents: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/** Entradas fora do razoável (negativas, texto) viram números válidos. */
export function sanitize(input: SimulationInput): SimulationInput {
  return {
    stores: Math.round(clamp(input.stores, 0, 100_000)),
    ordersPerStoreDay: clamp(input.ordersPerStoreDay, 0, 10_000),
    days: Math.round(clamp(input.days, 1, 3_650)),
    feeCents: Math.round(clamp(input.feeCents, 0, 100_000)),
    eligiblePercent: clamp(input.eligiblePercent, 0, 100),
    ordersAreEligible: input.ordersAreEligible,
    monthlyStoreGrowthPercent: clamp(input.monthlyStoreGrowthPercent, -100, 1_000),
  };
}

/** Pedidos elegíveis por loja por dia, aplicando o percentual uma vez só. */
export function eligiblePerStoreDay(input: SimulationInput): number {
  return input.ordersAreEligible ? input.ordersPerStoreDay : input.ordersPerStoreDay * (input.eligiblePercent / 100);
}

export function simulate(raw: SimulationInput): SimulationResult {
  const input = sanitize(raw);
  const perStoreDay = eligiblePerStoreDay(input);
  // Pedido é coisa inteira: arredonda os pedidos, e a receita sai deles (sem centavo quebrado).
  const ordersFor = (stores: number, days: number) => Math.round(stores * perStoreDay * days);
  const eligibleOrders = ordersFor(input.stores, input.days);
  const revenueCents = eligibleOrders * input.feeCents;

  const growth: SimulationResult["growth"] = [];
  let current = input.stores;
  for (let month = 1; month <= 12; month++) {
    const rounded = Math.round(current);
    growth.push({ month, stores: rounded, revenueCents: ordersFor(rounded, 30) * input.feeCents });
    current *= 1 + input.monthlyStoreGrowthPercent / 100;
  }

  return {
    eligibleOrders,
    revenueCents,
    // Média diária = receita do período ÷ dias.
    dailyCents: Math.round(revenueCents / input.days),
    weeklyCents: ordersFor(input.stores, 7) * input.feeCents,
    monthly30Cents: ordersFor(input.stores, 30) * input.feeCents,
    annualCents: ordersFor(input.stores, 365) * input.feeCents,
    growth,
    growthYearCents: growth.reduce((sum, item) => sum + item.revenueCents, 0),
  };
}
