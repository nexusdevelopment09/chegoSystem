# Usuários de teste

Todos os nomes de pessoas e lojas são fictícios. Estes usuários são criados pelo `npm run db:reset`.

## Como entrar

O jeito mais rápido é a página **http://localhost:3000/dev**: na seção "Login rápido", clique em **Entrar como** ao lado do usuário.

O admin também entra em http://localhost:3000/entrar com usuário `admin` e senha `admin`.

O login por telefone, com o código fixo **`123456`** para todos os números abaixo, entra na Etapa 3.

## Admin

| Nome | Telefone |
|---|---|
| Admin Chegô | (82) 90000-0000 |

## Clientes

Cada cliente existe para testar uma situação.

| # | Nome | Telefone | Bairro | Para testar |
|---|---|---|---|---|
| 1 | Ana Clara Souza | (82) 94000-0001 | Centro | Cliente frequente: muitos pedidos, favoritos, avaliações, um pedido em preparo e uma encomenda agendada para amanhã. |
| 2 | Bruno Henrique Lima | (82) 94000-0002 | Vila Nova | Pedidos variados. Tem um pedido pago esperando aceite na pizzaria. |
| 3 | Carla Mendes | (82) 94000-0003 | Sítio Riacho Fundo | Zona rural, com ponto de referência. |
| 4 | Diego Alves | (82) 94000-0004 | Alto do Cruzeiro | Cliente novo, sem nenhum pedido (cupom de primeira compra e indicação). |
| 5 | Eduarda Santos | (82) 94000-0005 | Conjunto Esperança | Tem um pedido aguardando pagamento, com Pix aberto. |
| 6 | Felipe Rocha | (82) 94000-0006 | Centro | Tem um pedido saindo para entrega, com mensagens trocadas com a loja. |
| 7 | Gabriela Nunes | (82) 94000-0007 | Loteamento Bela Vista | Tem um chamado de suporte aberto (item faltando). |
| 8 | Henrique Costa | (82) 94000-0008 | Vila Nova | Cliente bloqueado: não consegue fazer pedido. |
| 9 | Isabela Ferreira | (82) 94000-0009 | Centro | Tem 17 anos: não pode comprar bebida alcoólica. |
| 10 | João Pedro Barros | (82) 94000-0010 | Povoado Lagoa Seca | Zona rural. Tem um pedido recusado com reembolso. |

## Lojas e seus usuários

Cada loja tem um dono. A Pizzaria Forno de Barro e o Mercado Boa Compra têm também outros papéis.

| # | Loja | Dono | Telefone do dono | Situação |
|---|---|---|---|---|
| 1 | Pizzaria Forno de Barro | Marcos Antônio Tavares | (82) 91000-0001 | Ativa, com destaque pago. Comissão 12%. |
| 2 | Casa da Lasanha | Luciana Prado | (82) 91000-0002 | Ativa, dois turnos. |
| 3 | Quentinha da Dona Lia | Maria Lia Correia | (82) 91000-0003 | Ativa, pedidos até 11h, prato do dia. |
| 4 | Sushi Maré | Renato Yamada | (82) 91000-0004 | Ativa, fechada segunda e terça. |
| 5 | Peixaria Águas Claras | Sebastião Marinho | (82) 91000-0005 | Ativa, só retirada aos domingos. |
| 6 | Brasa Burger | Thiago Bezerra | (82) 91000-0006 | Ativa, fecha à meia-noite. |
| 7 | Delícias da Vó | Dona Zefinha Moura | (82) 91000-0007 | Ativa, encomendas com 24 horas. |
| 8 | Padaria Pão Quentinho | Paulo Sérgio Leite | (82) 91000-0008 | Ativa, loja fundadora (mensalidade grátis por 3 meses). |
| 9 | Açaí Tropical | Camila Duarte | (82) 91000-0009 | Ativa, complementos grátis até 4. |
| 10 | Depósito Gelada Já | Wellington Farias | (82) 91000-0010 | Ativa, bebida alcoólica, atende a zona rural. |
| 11 | Mercado Boa Compra | Rosângela Batista | (82) 91000-0011 | Ativa, com estoque e fatura em aberto. |
| 12 | Farmácia Saúde Mais | Dr. Fábio Queiroz | (82) 91000-0012 | Ativa, só itens sem receita. |
| 13 | Empório Vida Verde | Larissa Pontes | (82) 91000-0013 | Ativa. |
| 14 | Força Total Suplementos | Rafael Guedes | (82) 91000-0014 | Ativa. |
| 15 | Espetinho do Zé | José Cícero Lins | (82) 91000-0015 | **Pendente** de aprovação. |
| 16 | Pastelaria Sabor Antigo | Edvaldo Nascimento | (82) 91000-0016 | **Suspensa** por fatura vencida. |
| 17 | Lanchonete Ponto Certo | Sandra Melo | (82) 91000-0017 | Na Cidade Vizinha Teste (não aparece em Joaquim Gomes). |

### Outros papéis

| Nome | Telefone | Loja | Papel |
|---|---|---|---|
| Juliana Peixoto | (82) 92000-0001 | Pizzaria Forno de Barro | Atendente (pedidos e cardápio, sem financeiro) |
| Robson Entregas | (82) 93000-0001 | Pizzaria Forno de Barro | Entregador (só as próprias entregas) |
| Cícero Vieira | (82) 92000-0002 | Mercado Boa Compra | Atendente |

## Cupons

| Código | O que faz | Para testar |
|---|---|---|
| `PRIMEIRA` | R$ 10,00 de desconto, mínimo de R$ 30,00, só na primeira compra. Pago pela plataforma. | Use com o Diego (cliente novo). |
| `FRETEGRATIS` | Frete grátis acima de R$ 50,00. Pago pela plataforma. | |
| `PIZZA10` | 10% na Pizzaria Forno de Barro, até R$ 15,00. Pago pela loja. | |
| `VELHO` | Expirado. | Deve dizer "Cupom expirado". |
| `ESGOTOU` | Limite de 5 usos já atingido. | Deve recusar. |
| `INDICA-ANA100` | R$ 5,00, cupom pessoal da Ana por ter indicado o Bruno. | Só a Ana consegue usar. |

## Áreas de entrega

| Bairro ou comunidade | Taxa | Tempo |
|---|---|---|
| Centro | R$ 3,00 | 20 a 35 min |
| Vila Nova | R$ 4,00 | 30 a 45 min |
| Alto do Cruzeiro, Conjunto Esperança | R$ 5,00 | 30 a 45 min |
| Loteamento Bela Vista | R$ 6,00 | 30 a 45 min |
| Sítio Riacho Fundo (rural) | R$ 8,00 | 45 a 70 min |
| Povoado Lagoa Seca (rural) | R$ 10,00 | 45 a 70 min |
| Sítio Mata Verde (rural) | R$ 12,00 | 45 a 70 min |

Só atendem toda a zona rural: Depósito Gelada Já, Mercado Boa Compra e Farmácia Saúde Mais. A Pizzaria Forno de Barro atende só o Sítio Riacho Fundo. As outras lojas entregam apenas nos bairros da cidade.
