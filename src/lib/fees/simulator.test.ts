import { describe, expect, it } from "vitest";
import { DEFAULT_FEE_CENTS, SCENARIOS, simulate, type SimulationInput } from "./simulator";

const base = (overrides: Partial<SimulationInput>): SimulationInput => ({
  stores: 10, ordersPerStoreDay: 10, days: 30, feeCents: DEFAULT_FEE_CENTS, eligiblePercent: 100, ordersAreEligible: true,
  monthlyStoreGrowthPercent: 0, ...overrides,
});

describe("simulador de receita", () => {
  // Os cenários de validação do pedido (ilustrativos, não são dados reais).
  it.each([
    ["Inicial", 10, 10, 150_000],
    ["Crescimento", 50, 15, 1_125_000],
    ["Expansão", 100, 20, 3_000_000],
    ["Escala", 500, 20, 15_000_000],
    ["Grande escala", 1_000, 30, 45_000_000],
  ])("%s: %i lojas × %i pedidos × 30 dias × R$ 0,50", (_name, stores, orders, expectedCents) => {
    const result = simulate(base({ stores, ordersPerStoreDay: orders }));
    expect(result.eligibleOrders).toBe(stores * orders * 30);
    expect(result.revenueCents).toBe(expectedCents);
    expect(result.monthly30Cents).toBe(expectedCents);
    expect(result.dailyCents).toBe(expectedCents / 30);
  });

  it("a tarifa padrão é R$ 0,50 e semana, mês e ano saem do mesmo ritmo diário", () => {
    expect(DEFAULT_FEE_CENTS).toBe(50);
    const result = simulate(base({}));
    expect(result.dailyCents).toBe(5_000);
    expect(result.weeklyCents).toBe(35_000);
    expect(result.annualCents).toBe(1_825_000);
  });

  it("o percentual de elegíveis só se aplica uma vez", () => {
    // Pedidos informados já são os entregues: o percentual é ignorado.
    expect(simulate(base({ eligiblePercent: 80, ordersAreEligible: true })).eligibleOrders).toBe(3_000);
    // Pedidos informados são todos os feitos: 80% chegam a ser entregues.
    expect(simulate(base({ eligiblePercent: 80, ordersAreEligible: false })).eligibleOrders).toBe(2_400);
  });

  it("período diferente de 30 dias: média diária = receita ÷ dias", () => {
    const result = simulate(base({ days: 7 }));
    expect(result.revenueCents).toBe(35_000);
    expect(result.dailyCents).toBe(5_000);
    expect(result.monthly30Cents).toBe(150_000);
  });

  it("frações viram pedidos inteiros e a receita nunca tem centavo quebrado", () => {
    const result = simulate(base({ stores: 3, ordersPerStoreDay: 2.5, days: 7, feeCents: 33 }));
    expect(result.eligibleOrders).toBe(53); // 52,5 arredondado
    expect(result.revenueCents).toBe(53 * 33);
    expect(Number.isInteger(result.dailyCents)).toBe(true);
  });

  it("projeção de 12 meses com crescimento de lojas", () => {
    const result = simulate(base({ stores: 100, monthlyStoreGrowthPercent: 10 }));
    expect(result.growth).toHaveLength(12);
    expect(result.growth[0]).toEqual({ month: 1, stores: 100, revenueCents: 1_500_000 });
    expect(result.growth[1].stores).toBe(110);
    expect(result.growth[11].stores).toBe(Math.round(100 * 1.1 ** 11));
    expect(result.growthYearCents).toBe(result.growth.reduce((sum, month) => sum + month.revenueCents, 0));
  });

  it("entradas inválidas não quebram a conta", () => {
    const result = simulate(base({ stores: -5, ordersPerStoreDay: Number.NaN, days: 0 }));
    expect(result.revenueCents).toBe(0);
    expect(result.dailyCents).toBe(0);
  });

  it("os cenários prontos usam a tarifa padrão", () => {
    for (const scenario of Object.values(SCENARIOS)) expect(scenario.input.feeCents).toBe(50);
  });
});
