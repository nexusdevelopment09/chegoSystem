-- Venda por peso, quantidade livre: o cliente escolhe qualquer quantidade de gramas que
-- seja múltipla da precisão da loja (weight_step_grams, por exemplo de 10 em 10 g),
-- a partir de um mínimo (weight_min_grams, por exemplo 100 g).
--
-- O preço de cada linha passa a ser calculado direto do preço do quilo
-- (price_per_kg_cents × gramas ÷ 1000, arredondado ao centavo), sem somar arredondamentos
-- de porção em porção.

alter table products
  add column weight_min_grams integer check (weight_min_grams is null or weight_min_grams between 1 and 50000);

update products set weight_min_grams = weight_step_grams where weight_step_grams is not null;

alter table products
  add constraint products_weight_min_check check ((weight_min_grams is null) = (weight_step_grams is null));
