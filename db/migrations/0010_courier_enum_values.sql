-- Rede de entregadores do Chegô: novos valores de enum.
-- Ficam em uma migration separada porque o PostgreSQL não deixa usar um valor
-- novo de enum na mesma transação em que ele foi criado.

-- Entregador da rede (do Chegô ou parceiro), que não pertence a nenhuma loja.
alter type user_role add value 'courier';

-- Conta dos entregadores nos lançamentos: o que a plataforma deve a cada um.
alter type ledger_account add value 'courier';
