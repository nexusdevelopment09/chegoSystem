import { describe, expect, it } from "vitest";
import { resolveRange, variation } from "./range";

// Quarta, 21/10/2026, 15h em Maceió (18h UTC).
const AT = new Date("2026-10-21T15:00:00-03:00");
const local = (date: Date) => new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");

describe("períodos do super admin", () => {
  it("hoje vai da meia-noite até agora e compara com ontem até a mesma hora", () => {
    const range = resolveRange({ periodo: "hoje" }, AT);
    expect(local(range.from)).toBe("2026-10-21 00:00");
    expect(range.to).toEqual(AT);
    expect(local(range.previous.from)).toBe("2026-10-20 00:00");
    expect(local(range.previous.to)).toBe("2026-10-20 15:00");
    expect(range.bucket).toBe("hora");
  });

  it("semana começa na segunda; semana passada é a anterior inteira", () => {
    expect(local(resolveRange({ periodo: "semana" }, AT).from)).toBe("2026-10-19 00:00");
    const last = resolveRange({ periodo: "semana_passada" }, AT);
    expect([last.firstDay, last.lastDay]).toEqual(["2026-10-12", "2026-10-18"]);
    expect(local(last.to)).toBe("2026-10-19 00:00");
  });

  it("mês passado, ano e ano passado", () => {
    const month = resolveRange({ periodo: "mes_passado" }, AT);
    expect([month.firstDay, month.lastDay]).toEqual(["2026-09-01", "2026-09-30"]);
    expect(local(month.previous.from)).toBe("2026-08-01 00:00");
    expect(resolveRange({ periodo: "ano" }, AT).bucket).toBe("mes");
    const year = resolveRange({ periodo: "ano_passado" }, AT);
    expect([year.firstDay, year.lastDay]).toEqual(["2025-01-01", "2025-12-31"]);
  });

  it("este mês não compara com um trecho maior que o mês anterior", () => {
    const march31 = new Date("2026-03-31T23:00:00-03:00");
    const range = resolveRange({ periodo: "mes" }, march31);
    expect(local(range.previous.to)).toBe("2026-03-01 00:00");
  });

  it("personalizado usa de/até e compara com o mesmo número de dias antes; padrão é este mês", () => {
    const range = resolveRange({ de: "2026-10-01", ate: "2026-10-10" }, AT);
    expect(range.key).toBe("personalizado");
    expect(local(range.to)).toBe("2026-10-11 00:00");
    expect(local(range.previous.from)).toBe("2026-09-21 00:00");
    expect(resolveRange({ de: "lixo" }, AT).key).toBe("mes");
  });

  it("variação não inventa percentual sem base", () => {
    expect(variation(150, 100)).toEqual({ pct: 50, direction: "up" });
    expect(variation(5, 0)).toEqual({ pct: null, direction: "new" });
    expect(variation(0, 0)).toEqual({ pct: null, direction: "none" });
  });
});
