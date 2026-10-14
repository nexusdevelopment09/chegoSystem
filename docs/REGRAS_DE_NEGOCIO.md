# Regras de negócio

As regras que o sistema aplica hoje, em linguagem simples. Cada seção aponta o arquivo onde a regra mora, para quem for alterar. Os valores marcados como "configurável" são mudados pelo admin em **Configurações**.

## 1. Regra de ouro

O pedido só chega à loja **depois do pagamento aprovado**. Antes disso, a loja não vê o pedido nem os dados do cliente, e cliente e loja não trocam contato.

## 2. Sacola e checkout

- A sacola é de **uma loja por vez**. Ao adicionar item de outra loja, o app oferece esvaziar e começar de novo.
- A sacola fica no aparelho e, para quem entrou, também no servidor.
- **Todo preço, desconto, taxa e total é recalculado no servidor**, a partir do banco. O que o navegador envia só diz o que foi escolhido.
- Se um preço mudou ou um item esgotou desde que entrou na sacola, o cliente é avisado antes de pagar.
- O **pedido mínimo** da loja não conta a taxa de entrega.
- Cliente bloqueado consegue navegar, mas não consegue fechar pedido.

Onde: `src/lib/checkout/quote.ts` e `src/lib/checkout/place-order.ts`.

## 3. Pagamento

| Regra | Valor |
|---|---|
| Prazo do Pix | 15 minutos (configurável) |
| Aviso de Pix perto de expirar | 3 minutos antes |
| Cartão de teste que aprova | número terminado em 0000 |
| Cartão de teste que recusa | número terminado em 1111 |
| Dinheiro na entrega | desligado (existe no banco, para o futuro) |

- O pedido nasce `awaiting_payment` e só vira `paid` pelo aviso do gateway (webhook), com assinatura conferida.
- O mesmo aviso recebido duas vezes não duplica nada.
- Pagamento aprovado depois que o pedido expirou ou foi cancelado é devolvido na hora.
- Código do pedido curto, por cidade: `JG-0001`, `JG-0002`...

Onde: `src/lib/payments/`.

## 4. Status do pedido

```
awaiting_payment → paid → accepted → preparing → ready → out_for_delivery → delivered
                                                     └→ (retirada) picked_up
saídas: expired | rejected | cancelled | refunded | partially_refunded
```

| De | Para | Quem pode |
|---|---|---|
| Aguardando pagamento | Pago, Expirado | Sistema |
| Aguardando pagamento | Cancelado | Cliente, admin |
| Pago | Aceito | Dono ou atendente |
| Pago | Recusado | Dono ou atendente, sistema (recusa automática) |
| Pago | Cancelado | Cliente, admin |
| Aceito | Em preparo | Dono ou atendente |
| Em preparo | Pronto | Dono ou atendente |
| Pronto | Saiu para entrega (entrega) ou Retirado (retirada) | Dono ou atendente |
| Saiu para entrega | Entregue | Entregador, dono ou atendente, admin |
| Aceito até Saiu para entrega | Cancelado | Só o admin |
| Entregue ou Retirado | Reembolsado, Reembolsado em parte | Admin (e o sistema, no reembolso parcial) |

Qualquer mudança fora desta tabela é recusada. Toda mudança fica no histórico do pedido, com autor, motivo e data.

**Prazos do aceite (configuráveis):**

- **8 minutos** sem aceite: alerta sonoro mais forte no painel, aviso ao dono da loja e ao admin.
- **15 minutos** sem aceite: recusa automática, reembolso total e aviso ao cliente.

**Cancelamento e recusa:**

- O cliente cancela sozinho enquanto a loja não aceitou, com reembolso total. Depois disso, só pelo suporte.
- A loja recusa informando um motivo, e o cliente recebe reembolso total.
- Pedido expirado, recusado ou cancelado devolve o estoque reservado e libera o cupom.

**Entrega:** cada pedido com entrega tem um **código de 4 dígitos** que o cliente mostra. O entregador digita o código para marcar como entregue. Sem o código, só o dono da loja ou o admin marcam, e com motivo registrado.

**Tempo estimado:** preparo da loja + entrega no bairro. A loja pode ligar "movimento alto" (+15, +30 ou +45 minutos), e o cliente vê.

Onde: `src/lib/orders/status.ts` (a tabela) e `src/lib/orders/transitions.ts` (o que acontece em cada mudança).

## 5. Divisão do dinheiro

Para cada pedido pago o sistema guarda, em centavos:

| Campo | O que é | Para quem vai |
|---|---|---|
| Subtotal | Produtos e opções | Loja, menos a comissão |
| Taxa de entrega | Do bairro do cliente | Inteira para a loja |
| Taxa de serviço | R$ 0,99 por pedido (configurável, pode ser zero) | Inteira para a plataforma |
| Comissão | Percentual da loja **no momento do pedido** | Plataforma |
| Desconto | Do cupom | Sai de quem paga o cupom |

**Contas:**

- Total que o cliente paga = subtotal − desconto + entrega + taxa de serviço.
- Comissão = base × percentual da loja, arredondada ao centavo. A base é o subtotal **antes** do desconto pago pela plataforma e **depois** do desconto pago pela loja.
- Parte da plataforma = comissão + taxa de serviço − desconto pago pela plataforma.
- Parte da loja = total − parte da plataforma.

**Exemplo** (pizza de R$ 64,00, cupom `PRIMEIRA` de R$ 10,00 pago pela plataforma, entrega de R$ 3,00, comissão de 12%):

| Linha | Valor |
|---|---|
| Subtotal | R$ 64,00 |
| Desconto | − R$ 10,00 |
| Entrega | R$ 3,00 |
| Taxa de serviço | R$ 0,99 |
| **Total do cliente** | **R$ 57,99** |
| Comissão (12% de R$ 64,00) | R$ 7,68 |
| Parte da plataforma (7,68 + 0,99 − 10,00) | − R$ 1,33 |
| Parte da loja | R$ 59,32 |

Neste exemplo a plataforma fica no negativo porque bancou o cupom: a loja recebe como se não houvesse desconto.

**Mudança de comissão:** vale para os pedidos novos. Os antigos mantêm o percentual copiado quando foram feitos.

**Lançamentos:** todo movimento gera linhas em `ledger_entries` (crédito ou débito, da loja ou da plataforma). Reembolsos geram estornos, tirados da loja e da plataforma na mesma proporção da venda.

**Reembolso parcial:** quando a loja remove um item em falta, o valor daquele item volta para o cliente e o pedido segue. O admin também pode reembolsar em parte ou por inteiro, com motivo. Nunca se devolve mais do que ainda falta reembolsar.

Onde: `src/lib/orders/totals.ts` e `src/lib/payments/refunds.ts`.

### Entrega pela rede do Chegô

A loja escolhe, em **Minha loja**, quem faz as entregas dela:

| Opção | Quem entrega | Para quem vai a taxa de entrega |
|---|---|---|
| Meu entregador (padrão) | A equipe da própria loja | Inteira para a loja |
| Entregadores do Chegô | Um entregador da rede: do próprio Chegô ou parceiro autônomo | Fica do lado da plataforma, que paga o entregador |

- A escolha é copiada para o pedido na hora da compra. Mudar depois não altera os pedidos já feitos.
- O cliente paga o mesmo valor nos dois casos.
- O entregador ganha uma parte da taxa de entrega do bairro: **100% por padrão** (configurável pelo admin; o resto fica com a plataforma).
- O ganho é registrado quando a entrega é concluída: sai da conta da plataforma e entra na conta do entregador nos lançamentos. O admin marca o repasse em **Entregadores**; o pagamento em si é feito fora do sistema.
- Se o pedido for reembolsado depois de entregue, o entregador mantém o ganho: ele fez a entrega.

**Exemplo** (mesmo pedido de R$ 64,00 com entrega de R$ 3,00, comissão de 12%, sem cupom):

| Linha | Loja entrega | Rede do Chegô entrega |
|---|---|---|
| Total do cliente | R$ 67,99 | R$ 67,99 |
| Parte da loja | R$ 59,32 | R$ 56,32 |
| Parte da plataforma | R$ 8,67 | R$ 11,67 |
| Ganho do entregador (sai da plataforma) | — | R$ 3,00 |
| O que sobra para a plataforma | R$ 8,67 | R$ 8,67 |

Onde: `src/lib/orders/totals.ts` (divisão) e `src/lib/orders/transitions.ts` (ganho na entrega).

### Como funciona a rede de entregadores

- Entregador **do Chegô** é cadastrado pelo admin e já entra aprovado. Entregador **parceiro** se cadastra em "Quero entregar", com CPF ou CNPJ, e fica em análise até o admin aprovar.
- Só recebe ofertas quem está aprovado e marcou "Ficar disponível".
- A entrega é oferecida assim que a loja aceita o pedido. A oferta mostra a loja, o bairro de destino e o ganho. **O nome, o telefone e o endereço do cliente só aparecem para o entregador que retirou o pedido.**
- Quem clica primeiro em "Pegar entrega" leva. Cada entregador carrega no máximo **2 entregas** ao mesmo tempo.
- Antes de retirar o pedido ele pode desistir, e a entrega volta para a fila. É o entregador que marca "Retirei o pedido" na loja; a loja não tem o botão "Saiu para entrega" nesses pedidos.
- A entrega é concluída com o código de 4 dígitos do cliente.
- Pedido pronto há mais de 5 minutos sem entregador aparece como alerta em **Ao vivo**, e o admin pode definir o entregador no pedido.
- O admin pode bloquear um entregador, com motivo. As entregas que ele ainda não retirou voltam para a fila.

Onde: `src/lib/couriers.ts`, `src/app/entregador/` e `src/app/admin/entregadores/`.

## 6. Mensalidade das lojas

- Cada loja tem um plano com valor mensal e uma fatura por mês, paga pelo app.
- A fatura vence no dia 10. Um dia depois do vencimento passa a "vencida" e o dono é avisado.
- **Suspender a loja é sempre decisão do admin**, nunca automático.
- Lojas fundadoras não geram fatura enquanto durar o período grátis.
- A loja vê o extrato por pedido (bruto, comissão, taxas, reembolsos, líquido). O admin vê a conciliação com o gateway e baixa o relatório mensal de comissões em CSV para o contador.

## 7. Justiça entre lojas

- Ordem padrão da lista: **abertas primeiro**, depois as que entregam no bairro do cliente (mais barata primeiro), depois pela avaliação.
- Destaque pago aparece em uma seção "Destaques" separada e identificada, e não muda a ordem da lista.
- O admin não tem como colocar uma loja no topo fora dessas regras.
- Mudanças de comissão, plano e destaque ficam no log de auditoria.
- Uma loja nunca vê dados de outra.

Onde: `src/lib/stores/queries.ts`.

## 8. Lojas

- Situações: `pending` (aguardando aprovação), `active`, `paused` e `suspended`. Só as ativas e pausadas de uma cidade ativa aparecem para os clientes.
- A loja se cadastra em "Quero vender no Chegô" e fica pendente. O admin aprova marcando todos os itens do checklist: dados, documentos, cardápio com pelo menos 5 produtos com foto, horários, área de entrega e recebedor no gateway.
- Horários por dia da semana, com até **dois turnos** no mesmo dia. Um turno pode atravessar a meia-noite. Feriados e fechamentos especiais são por dias inteiros.
- A loja pode abrir ou fechar agora e pausar por alguns minutos, direto no painel.
- Loja fechada aparece no fim da lista, em cinza, com "Abre hoje às 18h" ou "Abre amanhã às 6h".

Onde: `src/lib/stores/hours.ts`.

## 9. Produtos e opções

Um produto pode ter grupos de opções. Cada grupo tem mínimo e máximo de escolhas e um **modo de preço**:

| Modo | Como cobra | Exemplo |
|---|---|---|
| `sum` | Soma o preço de cada opção | Adicionais do hambúrguer |
| `highest` | Cobra a opção mais cara | Pizza meio a meio (padrão) |
| `average` | Cobra a média das opções | Pizza meio a meio, se a loja preferir |
| `free_up_to` | As N primeiras são grátis; as seguintes pagam | Complementos do açaí |

**Exemplo da pizza Grande:** Calabresa (R$ 45,00) com Carne de Sol (R$ 56,00) custa **R$ 56,00** na regra "maior valor" e **R$ 50,50** na regra "média". A regra da loja aparece escrita para o cliente.

- Um grupo pode ser ligado a vários produtos, com **preço diferente em cada um** (o sabor custa um valor na Média e outro na Grande).
- O mesmo motor serve pizza, açaí, hambúrguer e quentinha, sem código especial por loja.
- Produto pode ter dias e horários de disponibilidade (café da manhã só até 10h), antecedência mínima (encomenda com 24 horas), quantidade máxima por pedido e estoque controlado, que esgota sozinho ao zerar.
- O pedido guarda **cópias** de nomes, opções e preços. Mudar o cardápio depois não altera pedidos antigos.

Onde: `src/lib/catalog/`.

## 10. Regras por categoria

| Categoria | Regra |
|---|---|
| Bebida alcoólica | O cliente confirma ter 18 anos ou mais. Com data de nascimento de menor de idade no perfil, o checkout é bloqueado. Loja e entregador veem "Conferir documento na entrega". |
| Farmácia | Só itens sem receita. Há aviso fixo no cadastro de produto e na página da loja. |
| Quentinha | Pedidos para o almoço até 11h, com entrega entre 11h30 e 13h30. Depois das 11h, só agendando para outro dia. |
| Mercado | No checkout o cliente escolhe o que fazer se faltar um item: ligar, substituir ou remover e devolver o valor. |
| Peixaria e mercado | Produtos por peso são porções fixas (bandeja de 500 g, 1 kg). |
| Encomendas | Produto com antecedência mínima obriga a agendar. |
| Suplementos e naturais | Aviso no cadastro: não prometer cura nem resultado de saúde. |

## 11. Cupons

- O admin cria cupons pagos pela plataforma ou pela loja. A loja cria os próprios, sempre pagos por ela e válidos só nela.
- Tipos: valor fixo, percentual (com teto) e frete grátis.
- Limites possíveis: validade, uso total, uso por cliente, pedido mínimo, só primeira compra, lojas, categorias e cidades específicas.
- Cada recusa tem a sua mensagem: "Cupom expirado", "Este cupom é só para a primeira compra" etc.
- **Indique e ganhe:** o indicado usa o código do amigo na primeira compra e ganha R$ 5,00. Quando esse primeiro pedido é entregue, quem indicou ganha um cupom de R$ 5,00. Os dois valores são configuráveis.

Onde: `src/lib/coupons/validate.ts`.

## 12. Mensagens entre cliente e loja

- Só existem depois do pagamento e até **2 horas** depois de o pedido ser concluído.
- São bloqueados: telefones (com espaços, pontos, traços ou por extenso), e-mails, links, @ e expressões como "zap", "whats", "pix direto", "me chama".
- Valores como "R$ 25,90" não são confundidos com telefone.
- A mensagem bloqueada não é enviada, o autor vê "Por segurança, não é permitido trocar contatos por aqui." e a tentativa fica registrada para o admin.

Onde: `src/lib/orders/moderation.ts`.

## 13. Avaliações

- Liberadas depois de entregue ou retirado, por até 7 dias (configurável). Uma por pedido: nota de 1 a 5 e comentário opcional.
- O cliente recebe um lembrete 1 hora depois da entrega.
- A loja responde publicamente e pode denunciar. O admin pode ocultar, com motivo.
- Nota da loja = média das avaliações visíveis dos últimos 180 dias. Com menos de 5 avaliações, aparece "Nova".

## 14. Endereços e entrega

- A área de entrega da loja é por **bairro ou comunidade**, cada um com taxa e tempo próprios.
- Na zona rural o ponto de referência é obrigatório.
- Se a loja não entrega no bairro do cliente, o app avisa e oferece retirada, quando houver.

## 15. Suporte

- Em cada pedido o cliente tem "Preciso de ajuda", com motivo e foto opcional. Um chamado aberto por pedido.
- O admin conversa com o cliente, pode acionar a loja e pode reembolsar em parte ou por inteiro.
- Situações do chamado: aberto, em andamento, aguardando cliente, resolvido.

## 16. Privacidade e termos

- Termos de Uso, Termos do Lojista e Política de Privacidade são versionados. Publicada uma nova versão, todos precisam aceitar de novo no próximo acesso. Os textos atuais são provisórios.
- O cliente pode baixar os seus dados e excluir a conta. Na exclusão os pedidos ficam para a contabilidade, mas os dados pessoais são anonimizados.

## 16-B. Documentos e fotos

- **CPF ou CNPJ:** nos cadastros de loja e de entregador a pessoa escolhe o tipo, o campo ajusta o tamanho e a pontuação, e o sistema confere os dígitos verificadores. Número inventado é recusado.
- **Fotos sempre por envio de arquivo**, nunca por endereço (URL). Vale qualquer formato de imagem (JPG, PNG, WebP, GIF, AVIF, TIFF, SVG...), com até 15 MB.
- A foto é reduzida no próprio aparelho antes de enviar e regravada no servidor em WebP, nos tamanhos que as telas usam. O arquivo original nunca é servido.
- Metadados da foto (como a localização do GPS) são apagados.
- Capas, banners e logos têm uma versão pequena, que o celular baixa no lugar da grande.

Onde: `src/lib/documents.ts`, `src/lib/uploads.ts` e `src/components/forms/`.

## 17. Limites de tentativas

| Ação | Limite |
|---|---|
| Login com telefone e senha | 10 por telefone e 30 por endereço IP a cada 10 minutos |
| Login da equipe (e-mail e senha) | 10 por conta a cada 10 minutos |
| Criar conta de cliente | 10 por endereço IP por hora |
| Trocar senha | 10 por conta a cada 10 minutos |
| Fechar pedido | 10 por cliente a cada 10 minutos |
| Testar cupom | 40 a cada 10 minutos |
| Mensagens no pedido | 30 a cada 5 minutos |
| Abrir chamado | 5 por hora |
| Cadastro de loja | 5 por hora |
| Cadastro de entregador | 5 por hora |

Onde: `src/lib/rate-limit.ts`.

## 18. Tarefas automáticas

Rodam a cada minuto e podem ser repetidas sem efeito dobrado:

- expirar pedidos com Pix não pago e avisar quando o Pix está perto de expirar;
- alertar e recusar pedidos sem aceite;
- lembrar da avaliação;
- liberar o cupom de indicação;
- gerar faturas mensais e marcar as vencidas;
- encerrar destaques e banners vencidos;
- recalcular as notas das lojas.

Onde: `src/lib/tasks/run.ts`.
