import { describe, expect, it } from "vitest";
import { formatDocument, isValidCnpj, isValidCpf, parseDocument } from "./documents";

describe("CPF", () => {
  it("aceita um CPF com os dígitos verificadores certos, com ou sem pontuação", () => {
    expect(isValidCpf("123.456.789-09")).toBe(true);
    expect(isValidCpf("12345678909")).toBe(true);
    expect(isValidCpf("529.982.247-25")).toBe(true);
  });

  it("recusa dígito errado, tamanho errado e números repetidos", () => {
    expect(isValidCpf("123.456.789-00")).toBe(false);
    expect(isValidCpf("123.456.789-0")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });
});

describe("CNPJ", () => {
  it("aceita um CNPJ com os dígitos verificadores certos", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });

  it("recusa dígito errado, tamanho errado e números repetidos", () => {
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
    expect(isValidCnpj("11.222.333/0001")).toBe(false);
    expect(isValidCnpj("00.000.000/0000-00")).toBe(false);
  });
});

describe("máscara e conferência", () => {
  it("formata enquanto a pessoa digita", () => {
    expect(formatDocument("cpf", "1234")).toBe("123.4");
    expect(formatDocument("cpf", "12345678909")).toBe("123.456.789-09");
    expect(formatDocument("cpf", "123456789099999")).toBe("123.456.789-09");
    expect(formatDocument("cnpj", "112223330001")).toBe("11.222.333/0001");
    expect(formatDocument("cnpj", "11222333000181")).toBe("11.222.333/0001-81");
  });

  it("devolve só os números ou a mensagem certa para cada problema", () => {
    expect(parseDocument("cpf", "123.456.789-09")).toEqual({ ok: true, type: "cpf", digits: "12345678909" });
    expect(parseDocument("cnpj", "11.222.333/0001-81")).toEqual({ ok: true, type: "cnpj", digits: "11222333000181" });
    expect(parseDocument("cpf", "123.456.789-0")).toEqual({ ok: false, error: "O CPF tem 11 números." });
    expect(parseDocument("cpf", "123.456.789-00")).toEqual({ ok: false, error: "Esse CPF não existe. Confira os números." });
    expect(parseDocument("cnpj", "123")).toEqual({ ok: false, error: "O CNPJ tem 14 números." });
    expect(parseDocument("rg", "123")).toEqual({ ok: false, error: "Escolha CPF ou CNPJ." });
  });
});
