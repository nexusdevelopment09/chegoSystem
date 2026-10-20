-- Item da conta de mesa guarda as escolhas (sabores, tamanho, adicionais) do mesmo jeito que o
-- pedido do app: a cópia com nome, modo de preço, quantidade e preço de cada opção. Ao fechar a
-- conta, viram as opções do pedido (e as fichas técnicas por sabor funcionam igual).
alter table table_bill_items
  add column options jsonb not null default '[]',
  add column lines text[] not null default '{}';
