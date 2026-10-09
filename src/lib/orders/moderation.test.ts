import { describe, expect, it } from "vitest";
import { chatOpen, moderateMessage } from "./moderation";

const blocked = (text: string) => {
  const result = moderateMessage(text);
  return result.allowed ? null : result.rule;
};

describe("moderateMessage", () => {
  it("blocks phone numbers in every disguise", () => {
    for (const text of [
      "me liga 82999990000",
      "82 99999-0000",
      "(82) 9 9999-0000",
      "8 2 9 9 9 9 9 0 0 0 0",
      "82.99999.0000",
      "+55 82 99999 0000",
      "meu fixo é 3222-1111",
      "99999/0000",
    ]) {
      expect(blocked(text), text).not.toBeNull();
    }
    expect(blocked("oito dois nove nove nove nove nove zero zero")).toBe("phone_spelled");
  });

  it("blocks e-mails, links and handles", () => {
    expect(blocked("manda no fulano@exemplo.com")).toBe("email");
    expect(blocked("fulano arroba exemplo ponto com")).toBe("email");
    expect(blocked("olha em https://exemplo.com/cardapio")).toBe("link");
    expect(blocked("www.minhaloja.com.br")).toBe("link");
    expect(blocked("entra em minhaloja.com.br")).toBe("link");
    expect(blocked("segue @pizzaria_jg")).toBe("handle");
  });

  it("blocks the words used to take the sale outside the app", () => {
    expect(blocked("me chama no zap")).toBe("zap");
    expect(blocked("manda um ZAPZAP")).toBe("zap");
    expect(blocked("tem WhatsApp?")).toBe("whats");
    expect(blocked("fala no wpp")).toBe("wpp");
    expect(blocked("faz um pix direto que sai mais barato")).toBe("pix_direto");
    expect(blocked("me chama que eu explico")).toBe("me_chama");
    expect(blocked("qual o seu número?")).toBe("me_chama");
    expect(blocked("paga por fora")).toBe("pix_direto");
    expect(blocked("me acha no Instagram")).toBe("social");
  });

  it("lets ordinary order talk through (no false positives)", () => {
    for (const text of [
      "O total ficou R$ 25,90, certo?",
      "Pode trocar por 2 refrigerantes de 2 L?",
      "Meu pedido é o JG-0123",
      "Chego às 19h30, pode ser?",
      "Casa 1250, portão verde, depois da ponte",
      "Troco para R$ 100,00 não precisa, já paguei no app",
      "Sem cebola e bem assada, por favor",
      "São 3 pizzas e 12 salgados",
      "Pode mandar 500 g de filé",
      "Obrigado! Entregue em 20 minutos.",
      "O ponto de referência é o posto",
      "Quero a pizza de calabresa especial",
    ]) {
      expect(blocked(text), text).toBeNull();
    }
  });
});

describe("chatOpen", () => {
  const paidAt = new Date("2026-10-09T20:00:00-03:00");
  const completedAt = new Date("2026-10-09T21:00:00-03:00");

  it("opens after the payment and closes 2 hours after the delivery", () => {
    expect(chatOpen({ paidAt: null, completedAt: null, status: "awaiting_payment" }, paidAt)).toBe(false);
    expect(chatOpen({ paidAt, completedAt: null, status: "preparing" }, completedAt)).toBe(true);
    expect(chatOpen({ paidAt, completedAt, status: "delivered" }, new Date("2026-10-09T23:00:00-03:00"))).toBe(true);
    expect(chatOpen({ paidAt, completedAt, status: "delivered" }, new Date("2026-10-09T23:00:01-03:00"))).toBe(false);
    expect(chatOpen({ paidAt, completedAt: null, status: "rejected" }, completedAt)).toBe(false);
  });
});
