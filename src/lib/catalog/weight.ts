// Venda por peso: o cliente escolhe os gramas (múltiplos da precisão da loja, a partir
// de um mínimo) e paga pelo preço do quilo. Funções puras, usadas no navegador e no servidor.
//
// A "quantidade" guardada na sacola e no pedido conta passos de precisão: com precisão de
// 10 g, 110 g = quantidade 11. Assim estoque e limite por pedido seguem as contas de sempre.

/** Precisões que a loja pode escolher: de quantos em quantos gramas o cliente escolhe. */
export const WEIGHT_STEPS = [10, 50, 100, 250, 500, 1000] as const;

/** 350 -> "350 g"; 1250 -> "1,25 kg"; 2000 -> "2 kg". */
export function formatWeight(grams: number): string {
  if (grams < 1000) return `${grams} g`;
  const kg = (grams / 1000).toFixed(3).replace(/\.?0+$/, "").replace(".", ",");
  return `${kg} kg`;
}

/** Preço de uma quantidade de gramas pelo preço do quilo, arredondado ao centavo. */
export function weightPriceCents(pricePerKgCents: number, grams: number): number {
  return Math.round((pricePerKgCents * grams) / 1000);
}

/** Preço de um passo de precisão (guardado em price_cents, só para referência). */
export const portionPriceCents = weightPriceCents;

/** Como a quantidade aparece: "3x" para unidades, "110 g" para produtos por peso. */
export function quantityLabel(quantity: number, stepGrams: number | null | undefined): string {
  return stepGrams ? formatWeight(quantity * stepGrams) : `${quantity}x`;
}

/**
 * Confere os gramas que o cliente digitou. Devolve a quantidade (passos) ou o motivo
 * para recusar: abaixo do mínimo, ou fora da precisão da loja.
 */
export function gramsToQuantity(grams: number, rules: { stepGrams: number; minGrams: number }): { ok: true; quantity: number } | { ok: false; error: string } {
  if (!Number.isInteger(grams) || grams <= 0) return { ok: false, error: "Diga quantos gramas quer." };
  if (grams < rules.minGrams) return { ok: false, error: `O mínimo é ${formatWeight(rules.minGrams)}.` };
  if (grams % rules.stepGrams !== 0) return { ok: false, error: `Escolha de ${rules.stepGrams} em ${rules.stepGrams} g.` };
  return { ok: true, quantity: grams / rules.stepGrams };
}
