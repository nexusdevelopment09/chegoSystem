# Chegô — contexto completo do sistema (para um assistente de IA)

> Este documento explica o projeto **Chegô** para um assistente de IA que vai ajudar a continuar o desenvolvimento. Leia tudo antes de sugerir código. Estado descrito: outubro de 2026.

---

## 1. O que é

**Chegô** ("Pediu, Chegô.") é um **marketplace local de delivery, similar ao iFood**, pensado para cidades pequenas do interior do Brasil (a cidade de teste é Joaquim Gomes – AL, com bairros fictícios). É um **app web + PWA** (instalável no celular), com quatro públicos:

| Público | O que faz |
|---|---|
| **Cliente** | Escolhe cidade/bairro, navega lojas, monta a sacola, paga (Pix ou cartão), acompanha o pedido, conversa com a loja, avalia, abre chamado de suporte |
| **Lojista** (dono, atendente, entregador da loja) | Recebe e aceita pedidos, gerencia cardápio, horários, cupons, área de entrega, relatórios e financeiro |
| **Entregador da rede do Chegô** (da plataforma ou parceiro autônomo) | Fica disponível, pega entregas, retira na loja, entrega com código |
| **Admin da plataforma** | Aprova lojas e entregadores, acompanha pedidos ao vivo, suporte, moderação, financeiro, marketing (banners, cupons), configurações, auditoria |

**Regra de ouro (atual):** o cliente paga **direto à loja** (Pix da loja, dinheiro ou cartão na entrega); o pedido vai para a loja na hora e o Chegô cobra da loja **R$ 0,50 por pedido concluído**, fechado por expediente e pago por Pix (`src/lib/fees/`). A regra antiga — o pedido só chega à loja **depois do pagamento aprovado** pelo app — continua no código atrás de `PAYMENT_COLLECTION=app`. Cliente e loja nunca trocam contato fora do pedido (o chat é moderado).

**Situação atual:** etapas 0 a 13 da especificação estão prontas e testadas. Roda **só localmente no Windows** do dono do projeto, com **pagamento simulado**. Não está em produção. Faltam: gateway de pagamento real (Etapa 14) e publicação (Etapa 15).

---

## 2. Stack técnica

| Peça | Escolha |
|---|---|
| Framework | **Next.js 16.4** (App Router, Turbopack), **React 19.3**, TypeScript estrito |
| Estilo | **Tailwind CSS v4**; cores e fontes da marca como tokens em `src/app/globals.css` (`bg-brand`, `brand-dark`, `text-coffee`, `font-display`, `bg-peach`) |
| Banco | **PostgreSQL 18** embutido (`@embedded-postgres/windows-x64`), porta **54329**, dados em `.db/`. **Sem Docker e sem Supabase** |
| Acesso ao banco | Biblioteca `postgres` (porsager), SQL escrito à mão com template strings. **Sem ORM** |
| Validação | **Zod 4** em toda entrada (formulários, rotas, webhooks) |
| Testes | **Vitest** (unitários + integração no banco) e **Playwright** (navegador, em tela de celular Pixel 7) |
| Outros | `sharp` (imagens → WebP), `web-push` (push real via VAPID), `qrcode`, `pdf-lib` |

> **Atenção:** o Next.js 16 tem mudanças incompatíveis com versões antigas. Por exemplo, o antigo `middleware.ts` agora se chama **`proxy.ts`**, e `params`/`searchParams`/`cookies()`/`headers()` são **assíncronos** (`await`). A documentação da versão instalada está em `node_modules/next/dist/docs/`. Não assuma APIs do Next 13/14.

Observação: no `next.config.ts`, `cacheComponents` e `partialPrefetching` estão **desligados (comentados) de propósito** no momento.

---

## 3. Por que não há Supabase

A especificação original pedia Supabase com Docker, mas o computador não liga o Docker sem mexer na BIOS. Então tudo que o Supabase daria foi feito dentro do próprio app:

| O Supabase daria | Como está feito |
|---|---|
| Auth | Tabela `sessions` + cookie httpOnly `chego_session` (só o hash do token fica no banco) — `src/lib/auth/` |
| Storage | Pasta `storage/` servida pela rota `/files/[...path]` — `src/lib/uploads.ts` |
| Realtime | Polling: o componente `AutoRefresh` chama `router.refresh()` a cada 3–15 s |
| Caixa de e-mail de teste | Tabela `outbound_messages`, mostrada em `/dev` |
| RLS | **Mantido**: Row Level Security nativo do PostgreSQL |

---

## 4. Estrutura de pastas

```
db/migrations/         SQL numerado 0001…0011 (NUNCA editar uma migration já aplicada; criar nova)
db/seed/               dados fictícios: 17 lojas, ~240 produtos, ~410 pedidos, pessoas, imagens
docs/                  ESPECIFICACAO, ARQUITETURA, REGRAS_DE_NEGOCIO, PRODUCAO, ROTEIRO_DE_TESTES, USUARIOS_DE_TESTE
e2e/                   testes Playwright
tests/integration/     testes contra o banco (RLS, pagamentos, seed)
tests/simulation/      um pedido completo em cada loja, conferindo o dinheiro
scripts/db.ts          liga/desliga/recria o banco local
src/
  app/                 páginas e rotas (App Router) — rotas em português
    (cliente)          /, /boas-vindas, /busca, /categoria/[slug], /loja/[slug], /loja/[slug]/produto/[id],
                       /carrinho, /checkout, /pedidos, /pedidos/[id], /pedidos/[id]/pagamento,
                       /pedidos/[id]/ajuda, /favoritos, /notificacoes, /perfil, /entrar, /cadastro, /termos
    lojista/           painel da loja: pedidos, cardápio (+planilha CSV, grupos), cupons, entregas,
                       avaliações, relatórios, financeiro, divulgação (cartaz/QR), minha loja
    entregador/        app do entregador da rede
    admin/             ao-vivo, pedidos, lojas, clientes, entregadores, cadastros, suporte, moderação,
                       financeiro, marketing, configurações, auditoria
    quero-vender/      cadastro de nova loja
    quero-entregar/    cadastro de entregador parceiro
    dev/               ferramentas de teste (só com APP_ENV=local)
    api/               carrinho, cotação, busca/sugestões, push, tarefas (cron), webhooks/pagamentos
  components/          componentes reutilizáveis (ui/, store/, cart/, catalog/, orders/, merchant/, layout/, forms/)
  lib/                 regras de negócio (detalhes abaixo)
  proxy.ts             mostra "Banco de dados local desligado" se o Postgres não responde
  instrumentation.ts   no ambiente local, chama POST /api/tarefas a cada minuto
public/sw.js           service worker (página offline e push)
```

### `src/lib` — onde moram as regras

| Arquivo/pasta | Responsabilidade |
|---|---|
| `db.ts` | Pool `sql` (dono do banco, **ignora RLS**) e `withUser(profileId, fn)` (aplica RLS via `set local role app_user` + `app.user_id`) |
| `auth/session.ts` | `requireUser`, `requireRole`, `requireStoreMember`, `getCurrentProfile` — proteção sempre no servidor |
| `auth/password.ts`, `auth/accounts.ts` | Login por telefone + senha (scrypt), senhas provisórias, contas criadas por cadastro ou por convite; admin com e-mail e senha |
| `clock.ts` | **`now()`** — relógio único do sistema (pode ser adiantado na página `/dev`). Nunca use `new Date()` para regra de negócio |
| `time.ts` | Fuso fixo America/Maceio (UTC-3), constantes `MINUTE_MS`, `DAY_MS`, `toLocal` |
| `catalog/pricing.ts` | Preço do item pelos grupos de opções (`sum`, `highest`, `average`, `free_up_to`) |
| `catalog/selection.ts` | Valida escolhas e gera o snapshot ("1/2 Calabresa") |
| `catalog/availability.ts` | Produto disponível naquele dia/hora |
| `stores/hours.ts` | Loja aberta/fechada (dois turnos, meia-noite, feriados) |
| `stores/queries.ts` | Listagem de lojas com a ordenação "justa" |
| `cart/` | Sacola local (localStorage) + cópia no servidor para logados |
| `checkout/quote.ts` | **Cotação no servidor**: recalcula preços, taxa de entrega, cupom, taxa de serviço, total |
| `checkout/place-order.ts` | Cria o pedido (`awaiting_payment`), reserva estoque, aplica cupom, pede pagamento |
| `checkout/schedule.ts` | Horários de agendamento |
| `orders/status.ts` | **Máquina de estados** (funções puras) |
| `orders/transitions.ts` | **`transitionOrder(tx, …)`** — o ÚNICO lugar que muda status de pedido |
| `orders/totals.ts` | Divisão do dinheiro loja × plataforma, linhas do livro-razão |
| `orders/moderation.ts` | Bloqueio de telefone/e-mail/link/"zap" no chat |
| `payments/types.ts` | Interface `PaymentProvider` |
| `payments/mock.ts` | `MockPaymentProvider` (único gateway hoje; assina webhooks como um real) |
| `payments/webhook.ts` | Trata o webhook; idempotente por `event_id` |
| `payments/refunds.ts` | Reembolso total/parcial com estorno proporcional |
| `coupons/validate.ts` | Regras de cupom e mensagens de erro |
| `couriers.ts` | Ofertas de entrega para a rede de entregadores |
| `notifications/notify.ts` | Grava aviso no sino + envia push real + SMS/WhatsApp/e-mail simulados |
| `tasks/run.ts` | Tarefas agendadas (idempotentes) |
| `rate-limit.ts` | Limite de tentativas em janela fixa, guardado no banco |
| `uploads.ts` | Recebe imagem (até 15 MB, qualquer formato), confere o conteúdo, regrava em WebP, apaga metadados |
| `documents.ts` | Valida CPF/CNPJ |
| `format.ts` | `formatCents` (R$), telefone, datas |
| `settings.ts` | Configurações da plataforma editáveis pelo admin |
| `shopping-context.ts` | Cidade/bairro escolhidos pelo cliente |

---

## 5. Modelo de dados (tabelas principais)

- **Pessoas:** `profiles` (papel global `customer | merchant | admin`, mais `courier` para a rede), `sessions`, `login_codes`, `addresses`, `favorites`, `push_subscriptions`
- **Lugares:** `cities` (prefixo do código do pedido, contador `next_order_number`, flag de manutenção), `neighborhoods` (bairros e comunidades rurais), `categories`
- **Lojas:** `stores` (status `pending | active | paused | suspended`, `delivery_provider`), `store_private` (dados sensíveis, `payment_recipient_id`), `store_members` (papel na loja: `owner | attendant | courier`), `store_hours`, `store_closures`, `store_delivery_areas` (taxa e tempo por bairro), `subscription_plans`, `store_subscriptions`, `invoices`
- **Catálogo:** `product_sections`, `products` (estoque opcional `track_stock`/`stock_qty`, `requires_age_check`, `product_type`), `product_availability`, `option_groups` (min/max, modo de preço), `options`, `product_option_groups`, `product_option_prices` (preço da opção por produto)
- **Pedidos:** `carts`, `cart_items`, `orders` (todos os valores em centavos + snapshot do endereço), `order_items`, `order_item_options` (cópias de nome/preço), `order_status_history`, `order_messages`, `blocked_message_attempts`, `reviews`
- **Cupons:** `coupons` (`fixed | percent | free_delivery`, pago por `platform | store`), `coupon_redemptions`, `referrals` (indique e ganhe)
- **Dinheiro:** `payments`, `refunds`, `webhook_events` (idempotência), `ledger_entries` (contas `store | platform | courier`, crédito/débito)
- **Entregadores:** `couriers` (`platform | partner`, `pending | active | blocked`, disponível), `courier_earnings`
- **Plataforma:** `banners`, `notifications`, `outbound_messages`, `support_tickets`, `ticket_messages`, `legal_documents` (versionados), `legal_acceptances`, `platform_settings`, `feature_flags`, `audit_logs`, `rate_limits`

**Todas as tabelas têm RLS.** Funções SQL: `current_user_id()`, `is_admin()`, `is_store_member()`, `can_view_order()`.

---

## 6. Fluxo de um pedido

1. **Sacola** (uma loja por vez) fica no aparelho; para logados, também no servidor. Preço da sacola é só para exibição.
2. **Cotação** (`quote.ts`): o servidor recalcula tudo a partir do banco. **Nada que o navegador diz sobre dinheiro é usado.**
3. **Criação** (`place-order.ts`), numa transação: reserva estoque (`stock_qty >= qtd`), consome cupom, gera código curto por cidade (`JG-0001`), grava pedido + itens + opções (cópias), histórico, apaga a sacola salva e cria o pagamento no gateway.
4. **Pagamento:** Pix (expira em 15 min, configurável) ou cartão. No mock, cartão terminado em **0000 aprova** e em **1111 recusa**. Só o **webhook assinado** muda o pedido para `paid`.
5. **Loja aceita** em até 15 min (alerta aos 8 min; recusa automática com reembolso aos 15 min).
6. **Preparo → pronto → saiu para entrega → entregue** (com **código de 4 dígitos** que o cliente informa ao entregador) ou **retirado** no balcão.

### Máquina de estados

```
awaiting_payment → paid → accepted → preparing → ready → out_for_delivery → delivered
                                                     └→ (retirada) picked_up
saídas: expired | rejected | cancelled | refunded | partially_refunded
```

| De | Para | Quem pode |
|---|---|---|
| awaiting_payment | paid, expired | sistema |
| awaiting_payment | cancelled | cliente, admin |
| paid | accepted | loja (dono/atendente) |
| paid | rejected | loja, sistema |
| paid | cancelled | cliente, admin (reembolso total) |
| accepted → preparing → ready | próximo | loja |
| ready | out_for_delivery | loja ou entregador da rede |
| ready | picked_up | loja (só retirada) |
| out_for_delivery | delivered | entregador, loja, admin |
| accepted…out_for_delivery | cancelled | só admin |
| delivered / picked_up | refunded, partially_refunded | admin (sistema no parcial) |

`expired`, `rejected` e `cancelled` devolvem o estoque reservado e o cupom. Recusa e cancelamento de pedido pago geram reembolso total automático.

---

## 7. Dinheiro (sempre em centavos inteiros)

- **Total do cliente** = subtotal − desconto + taxa de entrega + taxa de serviço (R$ 0,99, configurável)
- **Comissão** = base × % da loja (copiado no pedido). Base = subtotal **antes** do desconto da plataforma e **depois** do desconto da loja
- **Parte da plataforma** = comissão + taxa de serviço − desconto pago pela plataforma (pode ficar negativa)
- **Parte da loja** = total − parte da plataforma
- Entrega pela **rede do Chegô**: a taxa de entrega fica com a plataforma, que paga o entregador (100% da taxa por padrão). O ganho é lançado na entrega concluída.
- Cada movimento gera linhas em `ledger_entries`. Reembolsos estornam loja e plataforma na proporção da venda.
- Split automático entre loja e plataforma está previsto na interface do gateway (`split.storeRecipientId`).

Exemplo: pizza R$ 64,00, cupom R$ 10 da plataforma, entrega R$ 3, comissão 12% → cliente paga R$ 57,99; comissão R$ 7,68; plataforma −R$ 1,33; loja R$ 59,32.

---

## 8. Outras regras de negócio importantes

- **Catálogo genérico:** o mesmo motor de opções atende pizza meio a meio (maior valor ou média), açaí com complementos grátis até N, hambúrguer com adicionais, quentinha com "escolha 3". Não há código especial por loja.
- **Horários:** até dois turnos por dia, turno pode atravessar meia-noite, feriados, "abrir/fechar agora", pausa e "movimento alto" (+15/+30/+45 min).
- **Área de entrega por bairro**, cada um com taxa e tempo. Zona rural exige ponto de referência. Não há geolocalização (o cliente escolhe o bairro numa lista).
- **Categorias especiais:** bebida alcoólica (confirmação 18+), farmácia (só sem receita), quentinha (pedido até 11h), mercado (política para item em falta: ligar, substituir ou remover e reembolsar).
- **Ordem justa das lojas:** abertas primeiro → entregam no bairro (mais barata primeiro) → avaliação. Destaque pago aparece numa seção separada e identificada, sem alterar a ordem.
- **Cupons:** fixo, percentual com teto, frete grátis; limites por validade, uso, cliente, primeira compra, loja, categoria, cidade. **Indique e ganhe** (R$ 5 + R$ 5, configurável).
- **Chat cliente↔loja:** só após pagamento até 2 h depois da conclusão, com moderação automática.
- **Avaliações:** até 7 dias após a entrega, nota 1–5; nota da loja = média dos últimos 180 dias ("Nova" com menos de 5).
- **Mensalidade das lojas:** fatura mensal com vencimento no dia 10; suspensão é sempre manual pelo admin; lojas fundadoras têm período grátis.
- **Termos versionados:** nova versão obriga a aceitar de novo. LGPD: baixar dados e excluir conta (pedidos ficam anonimizados).
- **Limites de tentativas** em login, checkout, cupom, mensagens, chamados e cadastros.
- **Tarefas agendadas** (a cada minuto, via `POST /api/tarefas` protegido por `x-cron-secret` fora do ambiente local): expirar Pix, aviso de Pix expirando, alerta/recusa por falta de aceite, lembrete de avaliação, cupom de indicação, faturas, fim de banners/destaques, recálculo de notas.

---

## 9. Convenções obrigatórias

- **Código, tabelas e variáveis em inglês. Interface, comentários e documentação em português do Brasil.** Rotas da interface em português (`/lojista/cardapio`).
- **Dinheiro em centavos inteiros** (`1234` = R$ 12,34); mostrar com `formatCents`.
- **Hora sempre por `now()`** de `src/lib/clock.ts`.
- **Status do pedido só muda por `transitionOrder`** dentro de uma transação.
- **Preço sempre recalculado no servidor.**
- Usar **`withUser`** para leituras/gravações em nome do usuário (RLS); usar **`sql`** só em código de servidor que já conferiu permissão e mexe com dinheiro/status.
- Proteção de página/ação **no servidor** (`requireUser`, `requireRole`, `requireStoreMember`).
- Mudança no banco = **nova migration numerada** + `npm run db:types` (gera `src/lib/db-types.ts`).
- Componentes reutilizáveis em `src/components/`, sem duplicar entre cliente, lojista e admin.
- Acessibilidade: área de toque ≥ 44 px, nada mais largo que a tela do celular, botão branco sobre laranja usa `brand-dark` (contraste 4,5:1).
- Não inventar dados reais (marcas, lojas, endereços reais).
- Antes de considerar algo pronto: `npm run lint`, `npm run typecheck`, `npm run test:all`. Um commit por entrega, mensagem em português.
- Se algo da especificação parecer errado, **avisar e explicar antes de mudar**.

---

## 10. Como rodar (Windows, local)

```powershell
npm install
copy .env.example .env.local
npm run db:reset     # liga o banco, cria tabelas e dados de teste
npm run dev          # http://localhost:3000
```

Nos outros dias, basta `npm run db:start` e `npm run dev`. Página **`/dev`**: relógio simulado, login rápido como qualquer usuário de teste, aprovar/expirar Pix, gerar pedido aleatório, rodar tarefas agendadas, caixa de mensagens simuladas e resetar o banco. Login: telefone de teste + senha `123456`, ou admin/admin. No servidor (VPS) o app roda com `APP_ENV=production`, seed `base` (sem dados fictícios) e pagamento simulado confirmado pelo próprio cliente.

Testes: `npm test` (unitários e integração), `npm run simulate:test`, `npm run test:e2e` (sobe outra cópia do app na porta 3100 com o banco `chego_test`).

**Último resultado (14/10/2026):** lint e typecheck limpos; 120/120 testes unitários e de integração; simulação OK nas 14 lojas; 111/111 testes no navegador.

---

## 11. Riscos técnicos conhecidos (ainda não corrigidos)

Achados numa revisão de código; aparecem principalmente com gateway real e mais tráfego:

1. **Chamada ao gateway dentro da transação do pedido** (`place-order.ts` → `createOrderPayment`). Com um gateway real (1–5 s de latência), a linha do contador `cities.next_order_number` fica travada e **serializa todos os pedidos da cidade**. Se a transação falhar depois de o gateway criar a cobrança, sobra uma cobrança órfã. Solução: gravar o pedido, fazer commit, chamar o gateway fora da transação com chave de idempotência e atualizar o pagamento depois.
2. **Reembolso chama o gateway dentro da transação** (`refunds.ts`). Se houver rollback depois de o gateway devolver o dinheiro, o sistema perde o registro. Solução: reembolso "pendente", confirmado por webhook.
3. **Tarefas agendadas em sequência sem isolamento** (`tasks/run.ts`): um erro numa tarefa impede as seguintes. Solução: try/catch por tarefa + alerta.
4. **Possível deadlock na reserva de estoque:** produtos travados na ordem do carrinho. Solução: ordenar por `product_id` e repetir em caso de erro `40P01`.
5. **Push enviado antes do commit** (`notify.ts` chama `sendPush` com `void`, dentro da transação). Solução: fila de saída (outbox) processada após o commit.
6. **Polling em vez de tempo real:** cada tela recarrega a página inteira a cada 3–5 s, num pool de 10 conexões. Solução: SSE + `LISTEN/NOTIFY` do Postgres.
7. **Índices faltando:** `notifications (order_id, type)` (consultada a cada minuto pelas tarefas) e pedidos por `payment_expires_at`.
8. **Sem limpeza** de sessões vencidas, `login_codes`, `outbound_messages` e `rate_limits` antigos.
9. **Notas das lojas recalculadas a cada minuto** para todas as lojas.
10. **Avisos podem duplicar** se duas execuções das tarefas rodarem ao mesmo tempo. Solução: `pg_try_advisory_lock`.
11. **Limite por IP confia em `x-forwarded-for`**, que pode ser forjado sem um proxy confiável.

---

## 12. O que falta para ficar parecido com o iFood (backlog sugerido)

**Prioridade alta:** localização real (GPS, lat/long, distância, área por raio); rastreio do entregador no mapa (OpenStreetMap/Leaflet); gorjeta para o entregador; dinheiro na entrega com troco (o banco já tem `payment_method = 'cash'` e feature flag); cartão salvo (guardar só o token do gateway).

**Prioridade média:** página de ofertas/promoções relâmpago; "frete grátis acima de R$ X" em destaque; combos e "peça também" no carrinho; cashback ou fidelidade por loja; previsão de entrega baseada no histórico real da loja; avaliações com foto.

**Para o lojista:** pausa rápida por tempo ou só da entrega; impressão automática; painel de desempenho (tempo de aceite, cancelamentos, itens mais vendidos).

**Infraestrutura (Etapas 14–15):** gateway real em sandbox com Pix + cartão + split; SMS/WhatsApp/e-mail reais; hospedagem com Postgres gerenciado e backups; armazenamento de fotos na nuvem; agendador externo chamando `/api/tarefas`; monitoramento de erros e alerta de falha no webhook.

**Fora do escopo por enquanto** (o banco já está preparado, mas sem telas): app nativo nas lojas, classificados, roupas com tamanho/cor, serviços com agendamento, preço por pesagem, integração com caixa das lojas, carrinho com várias lojas.

---

## 13. Como me ajudar

- Respeite as convenções da seção 9 e a arquitetura existente; reutilize as funções de `src/lib` em vez de criar paralelas.
- Ao propor código, indique o caminho do arquivo e siga o estilo do código existente (SQL com a biblioteca `postgres`, Server Actions, Zod, comentários em português).
- Para mudanças no banco, proponha a nova migration (`db/migrations/0012_….sql`) e lembre de `npm run db:types`.
- Sugira os testes (unitário, integração ou e2e) que provam a mudança.
- Lembre que é Next.js 16 (`proxy.ts`, APIs assíncronas) e React 19.
