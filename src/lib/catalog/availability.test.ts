import { describe, expect, it } from "vitest";
import { earliestSchedule, productStatus, sameDayClosed, type ProductRules } from "./availability";

// 09/10/2026 é uma sexta; 12/10/2026 é uma segunda. Horário de Maceió.
const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);
const rules = (extra: Partial<ProductRules> = {}): ProductRules => ({
  available: true, trackStock: false, stockQty: null, minLeadMinutes: 0, windows: [], ...extra,
});
const everyDayUntil = (endsAt: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startsAt: "00:00", endsAt }));

describe("productStatus", () => {
  it("a regular product is always orderable", () => {
    expect(productStatus(rules(), at("2026-10-09", "15:00"))).toEqual({ orderable: true, mustSchedule: false, note: null });
  });

  it("is sold out when switched off or when the tracked stock reaches zero", () => {
    expect(productStatus(rules({ available: false }), at("2026-10-09", "15:00"))).toMatchObject({ orderable: false, reason: "sold_out" });
    expect(productStatus(rules({ trackStock: true, stockQty: 0 }), at("2026-10-09", "15:00"))).toMatchObject({ orderable: false, note: "Esgotado" });
    expect(productStatus(rules({ trackStock: true, stockQty: 2 }), at("2026-10-09", "15:00")).orderable).toBe(true);
    // Estoque que não é controlado nunca esgota sozinho.
    expect(productStatus(rules({ trackStock: false, stockQty: 0 }), at("2026-10-09", "15:00")).orderable).toBe(true);
  });

  it("breakfast items are only orderable until 10h", () => {
    const breakfast = rules({ windows: everyDayUntil("10:00") });
    expect(productStatus(breakfast, at("2026-10-09", "09:59"))).toMatchObject({ orderable: true, note: "Só até 10h" });
    expect(productStatus(breakfast, at("2026-10-09", "10:00")).orderable).toBe(true);
    expect(productStatus(breakfast, at("2026-10-09", "10:01"))).toEqual({ orderable: false, reason: "outside_window", note: "Só até 10h" });
  });

  it("the dish of the day is only orderable on its weekday", () => {
    const mondayDish = rules({ windows: [{ weekday: 1, startsAt: "00:00", endsAt: "23:59:59" }] });
    expect(productStatus(mondayDish, at("2026-10-12", "10:00")).orderable).toBe(true);
    expect(productStatus(mondayDish, at("2026-10-09", "10:00"))).toMatchObject({ orderable: false, note: "Só na segunda" });
  });

  it("made-to-order products force a scheduled order", () => {
    expect(productStatus(rules({ minLeadMinutes: 24 * 60 }), at("2026-10-09", "10:00"))).toEqual({
      orderable: true, mustSchedule: true, note: "Encomenda com 24 horas de antecedência",
    });
  });
});

describe("scheduling rules", () => {
  it("the earliest schedule respects the longest lead time", () => {
    const now = at("2026-10-09", "10:00");
    expect(earliestSchedule(now, [0, 24 * 60], 60)).toEqual(at("2026-10-10", "10:00"));
    expect(earliestSchedule(now, [], 60)).toEqual(at("2026-10-09", "11:00"));
  });

  it("lunch boxes stop taking same-day orders at 11h", () => {
    expect(sameDayClosed({ cutoff: "11:00" }, at("2026-10-09", "10:59"))).toBe(false);
    expect(sameDayClosed({ cutoff: "11:00" }, at("2026-10-09", "11:00"))).toBe(true);
    expect(sameDayClosed({ cutoff: null }, at("2026-10-09", "23:00"))).toBe(false);
  });
});
