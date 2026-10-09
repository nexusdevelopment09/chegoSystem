import { describe, expect, it } from "vitest";
import { parseMoney } from "../format";
import { adjustPrice, parseMenuCsv, toMenuCsv } from "./csv";

describe("parseMoney", () => {
  it("reads Brazilian and plain formats", () => {
    expect(parseMoney("12,50")).toBe(1250);
    expect(parseMoney("R$ 1.234,56")).toBe(123456);
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("7")).toBe(700);
    expect(parseMoney("0,80")).toBe(80);
  });

  it("refuses what is not money", () => {
    for (const bad of ["", "abc", "12,345", "-5", "1,2,3"]) expect(parseMoney(bad)).toBeNull();
  });
});

describe("menu spreadsheet", () => {
  const csv = [
    "secao;nome;descricao;preco;disponivel;estoque",
    "Mercearia;Arroz branco 1 kg;Tipo 1;6,90;sim;80",
    'Mercearia;"Feijão; carioca 1 kg";;8,50;nao;',
    ";Sal 1 kg;;2,50;;0",
  ].join("\r\n");

  it("reads products, quoted cells, defaults and stock", () => {
    const { products, errors } = parseMenuCsv(`﻿${csv}`);
    expect(errors).toEqual([]);
    expect(products).toEqual([
      { section: "Mercearia", name: "Arroz branco 1 kg", description: "Tipo 1", priceCents: 690, available: true, stock: 80 },
      { section: "Mercearia", name: "Feijão; carioca 1 kg", description: "", priceCents: 850, available: false, stock: null },
      { section: "Outros", name: "Sal 1 kg", description: "", priceCents: 250, available: true, stock: 0 },
    ]);
  });

  it("exports what it can read back", () => {
    const { products } = parseMenuCsv(csv);
    expect(parseMenuCsv(toMenuCsv(products)).products).toEqual(products);
  });

  it("points to the line of each problem", () => {
    const bad = "nome;preco;estoque\n;5,00;\nArroz;cinco;\nFeijão;8,00;-1\nArroz 2;3,00;\nArroz 2;3,00;";
    expect(parseMenuCsv(bad).errors).toEqual([
      "Linha 2: falta o nome do produto.",
      "Linha 3: preço inválido (“cinco”). Use o formato 12,50.",
      "Linha 4: estoque inválido (“-1”).",
      "Linha 6: “Arroz 2” aparece duas vezes na seção Outros.",
    ]);
    expect(parseMenuCsv("produto;valor\nx;1").errors).toEqual(["Falta a coluna “nome” na primeira linha."]);
    expect(parseMenuCsv("").errors).toEqual(["A planilha está vazia."]);
  });

  it("adjusts prices in bulk, rounded to the cent", () => {
    expect(adjustPrice(4500, 5)).toBe(4725);
    expect(adjustPrice(690, 5)).toBe(725);
    expect(adjustPrice(1000, -10)).toBe(900);
    expect(adjustPrice(100, -200)).toBe(0);
  });
});
