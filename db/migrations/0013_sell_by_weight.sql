-- Venda por peso (gramas), para granéis de empório, mercado, peixaria...
--
-- Um produto vendido por peso é vendido em porções de N gramas (weight_step_grams),
-- com o preço do quilo (price_per_kg_cents). A "quantidade" do pedido continua um
-- número inteiro: quantas porções. Assim preço, estoque, limite por pedido e totais
-- seguem as mesmas contas dos produtos por unidade; só muda como aparece ("350 g").
--
-- price_cents passa a ser o preço de uma porção, calculado pelo servidor a partir do
-- preço do quilo (arredondado ao centavo). stock_qty e max_per_order contam porções.

alter table products
  add column weight_step_grams integer check (weight_step_grams is null or weight_step_grams between 10 and 5000),
  add column price_per_kg_cents integer check (price_per_kg_cents is null or price_per_kg_cents > 0),
  add constraint products_weight_check check ((weight_step_grams is null) = (price_per_kg_cents is null));

-- Cópia no pedido: mudar a porção do produto depois não muda como o pedido antigo aparece.
alter table order_items
  add column weight_step_grams integer check (weight_step_grams is null or weight_step_grams > 0);
