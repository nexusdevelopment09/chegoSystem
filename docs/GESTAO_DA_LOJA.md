# Gestão da loja

Estoque, validade, reposição, mesas e balcão, funcionários e permissões, entregadores da loja, auditoria, resumo do dia e compra sem conta. As regras de dinheiro não mudaram: a loja continua pagando ao Chegô **R$ 0,50 por pedido concluído**, inclusive nas vendas de mesa e balcão.

## Telas

| Tela | Endereço | Permissão |
|---|---|---|
| Resumo do dia | `/lojista/painel` | `dashboard.ver` |
| Estoque | `/lojista/estoque` (+ `/[id]`, `validade`, `alertas`, `movimentacoes`, `reposicao`) | `estoque.ver` e as de cada ação |
| Ficha técnica (receita) | dentro do produto do cardápio | `estoque.ajustar` |
| Mesas e balcão | `/lojista/mesas`, `/lojista/mesas/conta/[id]` | `vendas.presenciais`, `mesas.gerenciar` |
| Relatórios, balancete, anual | `/lojista/relatorios`, `/balancete`, `/anual` | `relatorios.ver` (valores: `financeiro.ver`; exportar: `relatorios.exportar`) |
| Funcionários | `/lojista/equipe` | `equipe.gerenciar` (permissões: `equipe.permissoes`) |
| Entregadores da loja | `/lojista/entregadores` | `entregadores.ver` / `entregadores.gerenciar` |
| Auditoria | `/lojista/auditoria` | `auditoria.ver` |
| Aceitar convite | `/convite/[token]` | quem recebeu o link |
| Pedido sem conta | `/acompanhar/[token]` | quem tem o link |

`/lojista` continua abrindo em **Pedidos** (entregador: **Entregas**). Sem permissão, a pessoa volta para `/lojista?negado=1`, vê o aviso "Você não tem acesso a essa área" e a tentativa fica na auditoria.

## Permissões

- O **dono** tem todas e não pode perdê-las.
- **Atendente** começa com: resumo, pedidos (ver, mudar situação, cancelar), dados do cliente, cardápio (ver e editar, **sem preços**), estoque (ver, movimentar, validade), mesas e vendas presenciais, ver entregadores.
- **Entregador da loja** começa sem nenhuma; só pode receber `pedidos.ver` e `entregadores.ver`.
- Regras de quem dá permissão (`checkGrant`): precisa de `equipe.permissoes`; ninguém altera as próprias permissões nem as do dono; ninguém dá uma permissão que não tem.
- Toda ação no servidor confere a permissão (`requirePermission`); esconder o botão é só conforto.
- Lista completa: `src/lib/merchant/permissions.ts`.

## Funcionários e convites

- O convite gera um link de **uso único**, válido por **7 dias**. Só o hash do token vai para o banco.
- Com telefone informado, só esse telefone aceita o convite.
- Aceitar cria a conta (nome, telefone, senha) ou usa a conta já aberta, numa transação com trava: dois cliques não criam dois vínculos.
- Desativar um funcionário bloqueia o acesso na hora (as funções de acesso do banco exigem vínculo ativo). Entregador desativado perde as entregas em aberto atribuídas a ele.
- "Encerrar sessões" desconecta o funcionário de todos os aparelhos.

## Estoque

- **Item de estoque**: produto do cardápio (ligado ao produto, os saldos andam juntos) ou insumo. Unidades: un, kg, g, l, ml, pacote, caixa.
- **Movimentações** (nunca apagadas): compra, venda, produção, perda, vencido, ajuste, devolução, transferência. Cada uma guarda o saldo depois dela, quem fez, o motivo e o pedido ou conta ligada.
- **Lotes e validade**: a saída consome os lotes por validade (o que vence antes sai antes) e **venda nunca usa lote vencido**. Avisos em 30, 15, 7 e 3 dias (configurável).
- **Alertas**: estoque baixo (abaixo do mínimo), vencendo, vencido e "conferir" (consumo estimado maior que o saldo). Um alerta aberto por item, tipo e lote.
- **Integração com pedidos**:
  - pedido feito → baixa do produto vendido;
  - recusado, cancelado ou expirado → devolução;
  - aceito → consumo dos insumos da ficha técnica.
  - Meio a meio conta cada sabor como fração.
  - Tudo é idempotente: repetir não baixa duas vezes.
- **Reposição inteligente**: média de saída dos últimos 7 e 30 dias, tendência, dias até acabar, estoque de segurança e prazo do fornecedor. O resultado é a sugestão de compra, que vira uma **lista de compras**: criada → aprovada → recebida (dá entrada e cria lotes) ou cancelada.

## Mesas e balcão

- Uma mesa só tem uma conta aberta por vez. **Balcão** é uma conta sem mesa.
- Os itens usam o mesmo motor de preços e escolhas do app (sabores, tamanhos). O estoque é reservado na hora, e cancelar o item devolve.
- Os pagamentos podem ser parciais, em Pix, cartão ou dinheiro. Só o dinheiro pode passar do total (gera troco).
- **Fechar** exige a conta paga e cria um pedido do canal `mesa` ou `balcao`, já concluído (`picked_up`), com a taxa de R$ 0,50. Dois cliques em "Fechar" ao mesmo tempo: um fecha e o outro é recusado.
- Os relatórios separam as modalidades: Entrega, Retirada, Mesa e Balcão.

## Relatórios

- Uma consulta só (`loadReportOrders`) alimenta os cartões, os gráficos e a lista, e os números batem entre si.
- Comparação com o período anterior equivalente.
- Bloco financeiro: bruto, descontos, estornos, taxa do Chegô e receita líquida operacional (vendas − taxas; não é lucro). Custo e margem estimados aparecem quando os itens do estoque têm custo cadastrado.
- **Balancete** do período, com exportação.
- **Relatório anual**:
  - meses lado a lado por ano;
  - anos sem dados aparecem como "sem dados";
  - um ano incompleto é comparado até o mesmo dia;
  - top produtos, formas de pagamento e canais;
  - exportação em CSV.
- As exportações não levam dados pessoais do cliente.

## Auditoria

- Fica registrado:
  - entrada e saída do sistema, inclusive a tentativa com senha errada numa conta que existe;
  - acesso negado;
  - cada mudança de situação de um pedido (quem, ou qual processo, de onde para onde);
  - produto criado, editado e preço alterado (antes e depois);
  - estoque, mesas, equipe, permissões, configurações da loja, cupons.
- Os eventos **não podem ser alterados nem apagados**: um gatilho no banco impede. Apagar só pela rotina de retenção, que se identifica. Anonimizar a pessoa (excluir conta) é permitido.
- A loja vê os próprios eventos e as entradas e saídas de quem é ou foi da equipe, nunca os de outra loja.
- Filtros: quem, área, resultado, período, pedido ou registro.
- Campos com nome de senha, token, hash ou código aparecem como `••••`.

## Resumo do dia

Mostra vendido hoje (com a comparação com ontem até o mesmo horário), pedidos em andamento, mais vendidos, estoque baixo, validade, reposição sugerida, mesas abertas e entregadores ativos. Cada bloco só aparece com a permissão daquela área: o atendente não vê faturamento.

## Compra sem conta

- No checkout, o visitante informa nome, telefone e o endereço digitado. Nada fica salvo além do pedido.
- Só vale pagando **direto à loja**. Pagar pelo app continua exigindo conta.
- O pedido nasce com `customer_id` nulo e um token de acompanhamento (só o hash fica no banco). O visitante vai para `/acompanhar/<token>` e pode cancelar enquanto a loja não aceitar.
- **Cupom, chat, avaliação e chamados exigem conta.** A loja vê o pedido marcado como "sem conta" e fala com o cliente pelo telefone.
- Limites: 6 pedidos por IP e 4 por telefone, por hora.

## Banco de dados

Migrations novas (nunca editar as já aplicadas):

| Migration | O que faz |
|---|---|
| `0015_subcategories_and_offers.sql` | subcategorias por segmento, preço "de" das ofertas |
| `0016_thermal_printers.sql` | impressoras e fila de impressão |
| `0017_store_management.sql` | pedidos sem conta e canal de venda, permissões e convites, colunas e imutabilidade da auditoria, estoque (itens, lotes, movimentações, fichas técnicas, alertas, listas de compras), mesas e contas |
| `0018_audit_anonymize.sql` | a auditoria aceita só anonimizar a pessoa |
| `0019_active_members.sql` | as funções de acesso exigem vínculo ativo; o dono é sempre ativo |
| `0020_bill_item_options.sql` | escolhas (sabores, tamanhos) nos itens da conta |

As tabelas novas só podem ser lidas pelo navegador, com as regras de acesso por linha (RLS). As gravações passam sempre pelo servidor, depois de conferir a permissão.

## Testes

- Unidade:
  - `src/lib/inventory/rules.test.ts`
  - `src/lib/tables/rules.test.ts`
  - `src/lib/merchant/permissions.test.ts`
  - `src/lib/merchant/report-rules.test.ts`
- Integração:
  - `tests/integration/inventory.test.ts`
  - `tests/integration/tables.test.ts`
  - `tests/integration/audit.test.ts`
  - `tests/integration/guest-checkout.test.ts`
  - `tests/integration/reports.test.ts`
- Ponta a ponta:
  - `e2e/management.spec.ts` (resumo, auditoria, acesso negado, preço auditado)
  - `e2e/operations.spec.ts` (convite, estoque, mesa, anual e balancete)
  - `e2e/checkout.spec.ts` (compra sem conta)

## Limitações conhecidas

- Visitante não usa cupom (o telefone digitado não prova quem é a pessoa).
- O resumo do dia recarrega ao abrir a página; não atualiza sozinho.
- O custo do relatório é estimado pelas saídas de estoque × custo cadastrado; só entram os pedidos com custo conhecido.
