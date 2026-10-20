import { describe, expect, it } from "vitest";
import { ipFromHeaders } from "./client-ip";
import { csvCell } from "./merchant/csv";
import { collectionFor } from "./payments/collection";

// Testes de regressão dos achados da auditoria de segurança (docs/AUDITORIA_SEGURANCA.md).

describe("auditoria: endereço do visitante para os limites de tentativas", () => {
  it("usa o endereço que o proxy acrescentou, e não o que o visitante mandou", () => {
    // O visitante manda "1.1.1.1" para fugir do limite; o proxy acrescenta o endereço real.
    expect(ipFromHeaders("1.1.1.1, 203.0.113.9", null)).toBe("203.0.113.9");
    expect(ipFromHeaders("203.0.113.9", null)).toBe("203.0.113.9");
    expect(ipFromHeaders(null, "198.51.100.4")).toBe("198.51.100.4");
    expect(ipFromHeaders(" , ", null)).toBe("local");
  });
});

describe("auditoria: pagamento de mentira nunca vale fora do ambiente de testes", () => {
  it("com o gateway de mentira, produção sempre cai no pagamento direto à loja", () => {
    expect(collectionFor({ collection: "app", provider: "mock", local: false })).toBe("store");
    expect(collectionFor({ collection: "app", provider: undefined, local: false })).toBe("store");
    expect(collectionFor({ collection: "app", provider: "mock", local: true })).toBe("app");
    expect(collectionFor({ collection: "app", provider: "gateway-real", local: false })).toBe("app");
    expect(collectionFor({ collection: undefined, provider: "mock", local: true })).toBe("store");
  });
});

describe("auditoria: planilhas não executam fórmulas", () => {
  it("texto que começa com = + - @ vira texto comum no Excel", () => {
    expect(csvCell('=HYPERLINK("http://x","clique")')).toBe(`"'=HYPERLINK(""http://x"",""clique"")"`);
    expect(csvCell("+5511999")).toBe("'+5511999");
    expect(csvCell("-10")).toBe("'-10");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("Pizzaria; boa")).toBe('"Pizzaria; boa"');
    expect(csvCell("Pão de queijo")).toBe("Pão de queijo");
  });
});
