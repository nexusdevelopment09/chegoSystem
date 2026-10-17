# Arquitetura

Como o Chegô é montado por dentro. Para rodar o projeto, veja o [README](../README.md). Para as regras do negócio, veja [REGRAS_DE_NEGOCIO.md](REGRAS_DE_NEGOCIO.md).

## Visão geral

O Chegô é um único aplicativo Next.js (App Router) que fala com um banco PostgreSQL. Não há outros serviços: login, fotos, tarefas agendadas e mensagens simuladas rodam dentro do próprio app.

```
Navegador (cliente, lojista, admin)
        │
        ▼
Next.js ── páginas e Server Actions (src/app)
        │        │
        │        └─ regras em src/lib (preço, pedido, pagamento, avisos)
        ▼
PostgreSQL local (porta 54329, dados em .db/)
        ▲
        └─ pasta storage/ para as fotos, servida por /files/...
```

| Peça | Escolha |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript em modo estrito |
| Estilo | Tailwind v4, com as cores e fontes da marca como tokens em `src/app/globals.css` |
| Banco | PostgreSQL 18 instalado pelo `npm install` (pacote `@embedded-postgres`), sem Docker |
| Validação | Zod em toda entrada: formulários, rotas e webhooks |
| Testes | Vitest (unitários e integração) e Playwright (navegador, em tela de celular) |

## Diferença em relação à especificação: sem Supabase

A especificação pedia Supabase local com Docker. Neste computador o Docker não liga sem ativar a virtualização na BIOS, o que exige reiniciar. Por isso o projeto usa PostgreSQL direto no Windows, e o que o Supabase daria pronto foi feito no app:

| O Supabase daria | Como está feito |
|---|---|
| Auth | Tabela `sessions` e cookie `chego_session` (`src/lib/auth/`) |
| Storage | Pasta `storage/` e a rota `/files/[...path]` (`src/lib/uploads.ts`) |
| Realtime | A tela se atualiza sozinha consultando o servidor a cada poucos segundos (`AutoRefresh`) |
| Caixa de e-mail de teste | Tabela `outbound_messages`, mostrada na página `/dev` |

Tabelas, regras de acesso e regras de negócio seguem a especificação.

## Banco de dados

- **Migrations** numeradas em `db/migrations/`. Uma migration já aplicada nunca é editada; cria-se uma nova. `scripts/db.ts` liga o banco, aplica as migrations e roda o seed.
- **Dois bancos no mesmo servidor:** `chego`, que você usa à mão, e `chego_test`, que os testes recriam. Os testes nunca mexem no primeiro.
- **Dinheiro em centavos inteiros** em todas as colunas (`*_cents integer`). Nunca número com vírgula.
- **Tipos TypeScript** do banco gerados por `npm run db:types` em `src/lib/db-types.ts`.

### Quem vê o quê (RLS)

Todas as tabelas têm regras de acesso por linha (Row Level Security). O app tem dois jeitos de falar com o banco, ambos em `src/lib/db.ts`:

| Jeito | Quando usar | O que o banco faz |
|---|---|---|
| `withUser(idDoUsuario, ...)` | Leituras e gravações simples feitas em nome de quem entrou | Aplica as regras: cada um só enxerga e altera o que é seu |
| `sql` (conexão dona do banco) | Código do servidor que já conferiu quem é o usuário e mexe em dinheiro ou status | Não aplica as regras |

As regras usam funções do banco como `current_user_id()`, `is_admin()`, `is_store_member()` e `can_view_order()`. Os testes em `tests/integration/rls.test.ts` provam, por exemplo, que um cliente não vê o pedido de outro e que um atendente não vê o financeiro.

## Login e papéis

- **Telefone e senha.** Cliente, lojista e entregador entram com o telefone e uma senha (hash scrypt em `profiles.password_hash`, regras em `src/lib/auth/password.ts`). O login por código SMS foi tirado enquanto o SMS for simulado. A equipe da plataforma entra com e-mail e senha (link "Equipe Chegô").
- **Contas.** O cliente cria a própria em `/entrar/criar-conta`. Lojista e entregador criam a senha no próprio cadastro ("Quero vender", "Quero entregar"); um telefone que já tem conta só vale se for de quem está conectado. Quem é cadastrado por outra pessoa (equipe da loja, entregador do Chegô) ou esquece a senha recebe uma senha provisória de 8 números, mostrada uma vez a quem cadastrou ou ao admin (`src/lib/auth/accounts.ts`).
- **Sessão.** O navegador guarda um cookie que scripts não conseguem ler. No banco fica só o hash do cookie, então uma tabela vazada não serve para entrar.
- **Papéis globais:** `customer`, `merchant` e `admin`. **Papéis dentro da loja:** `owner`, `attendant` e `courier`.
- **Proteção das páginas** sempre no servidor, com `requireUser`, `requireRole` e `requireStoreMember` (`src/lib/auth/session.ts`). Quem ainda não aceitou a versão atual dos termos é mandado para aceitar.

## Caminho de um pedido

**Quem recebe o dinheiro** é decidido por `PAYMENT_COLLECTION` (`src/lib/payments/collection.ts`): `store` (padrão) = o cliente paga direto à loja; `app` = paga pelo gateway (preparado, desligado). O pedido guarda `payment_collection`, então os dois tipos convivem.

1. **Sacola** (`src/lib/cart/`): fica no aparelho e, para quem entrou, também no servidor. Os preços da sacola servem só para mostrar.
2. **Cotação** (`src/lib/checkout/quote.ts`): o servidor recalcula tudo a partir do banco: preços, opções, taxa de entrega, cupom e total, e diz quais formas de pagamento valem (as que a loja aceita; sem dinheiro quando a entrega é da rede). Direto à loja não há taxa de serviço nem comissão.
3. **Criação do pedido** (`src/lib/checkout/place-order.ts`): grava o pedido com cópias dos nomes e preços e reserva o estoque. Direto à loja, na mesma transação o pedido passa a `paid` ("enviado à loja") e a loja é avisada. Pelo app, nasce `awaiting_payment` e pede o pagamento ao gateway.
4. **Pagamento pelo app** (`src/lib/payments/`): o gateway avisa pelo webhook `/api/webhooks/pagamentos`. Só esse aviso, com assinatura válida, transforma o pedido em `paid`. O mesmo aviso recebido duas vezes não duplica nada.
5. **Mudanças de status** (`src/lib/orders/transitions.ts`): a função `transitionOrder` é o único lugar que muda o status. Ela consulta a máquina de estados (`status.ts`), grava o histórico, faz a devolução de estoque e cupom e dispara os avisos. Pelo app, também faz os lançamentos e os reembolsos. Direto à loja, na conclusão lança a **taxa do Chegô** (`src/lib/fees/ledger.ts`) e, num reembolso posterior, o estorno dela.

## Taxas do Chegô

`src/lib/fees/`: `rules.ts` (funções puras: dia de expediente com hora de corte, totais do fechamento), `ledger.ts` (lançamentos por pedido, protegidos pelo índice único `(order_id, kind)`), `closing.ts` (fechamento idempotente com trava por loja, crédito levado adiante, resumo e tarefa diária) e `charges.ts` + `pix.ts` (cobrança Pix e webhook `/api/webhooks/taxas`).

| Tabela | O que guarda |
|---|---|
| `fee_entries` | Cada lançamento da conta da loja com o Chegô: taxa, estorno, crédito de cupom, ajuste, saldo levado |
| `store_closings` | Um fechamento por loja e dia de expediente, com os totais congelados |
| `fee_charges` | Cobranças Pix de um fechamento (só uma pendente por vez) |
| `fee_payments` | Pagamentos confirmados pelo provedor, uma vez por transação; `applied = false` quando não bateu |

O provedor Pix é uma interface (`FeePixProvider`). Hoje só existe o simulado, que funciona apenas com `APP_ENV=local`; sem provedor, a cobrança aparece como indisponível. O entregador da rede, nos pedidos pagos direto à loja, é pago pela loja: `courier_earnings.payer = 'store'`, com a situação "a receber", "a loja disse que pagou", "recebido" (confirmado pelo entregador) ou "contestado".

### Gateway de pagamento

O resto do sistema só conhece a interface `PaymentProvider` (`src/lib/payments/types.ts`). Hoje existe apenas o `MockPaymentProvider`, que não usa dinheiro nem rede, mas assina os avisos como um gateway de verdade. Trocar de gateway significa escrever outro provedor nessa pasta.

## Rede de entregadores

Além do entregador de cada loja (um membro da equipe dela), existe a rede do Chegô: perfis com o papel global `courier` e uma linha na tabela `couriers` (tipo `platform` ou `partner`, situação, cidade, documento, veículo). O pedido guarda `delivery_provider` (`store` ou `platform`), copiado da loja na compra, e `courier_fee_cents`. As entregas sem entregador são listadas por `listOffers` (`src/lib/couriers.ts`), pela conexão dona do banco e sem os dados do cliente; depois de pegar a entrega, o entregador lê o pedido pelas regras de acesso normais. O ganho fica em `courier_earnings` e nos lançamentos, na conta `courier`.

## Regras em funções puras

As contas que mais importam não dependem do banco nem do Next.js, e por isso têm testes unitários rápidos:

| Arquivo | O que calcula |
|---|---|
| `src/lib/catalog/pricing.ts` | Preço do item pelos grupos de opções (soma, maior valor, média, grátis até N) |
| `src/lib/catalog/selection.ts` | Validação das escolhas e as linhas "1/2 Calabresa" |
| `src/lib/catalog/availability.ts` | Se o produto pode ser pedido naquele dia e hora |
| `src/lib/catalog/weight.ts` | Venda por peso: preço da porção a partir do quilo e como a quantidade aparece ("400 g") |
| `src/lib/stores/hours.ts` | Loja aberta ou fechada, dois turnos, meia-noite, feriados |
| `src/lib/checkout/schedule.ts` | Horários que o cliente pode agendar |
| `src/lib/orders/totals.ts` | Divisão do dinheiro entre loja e plataforma |
| `src/lib/orders/status.ts` | Máquina de estados do pedido |
| `src/lib/orders/moderation.ts` | Bloqueio de telefones, links e contatos nas mensagens |
| `src/lib/coupons/validate.ts` | Regras e mensagens dos cupons |
| `src/lib/documents.ts` | Conferência e pontuação de CPF e CNPJ |

## Relógio único

Todo o código pergunta a hora para `now()` (`src/lib/clock.ts`), nunca para `new Date()`. No ambiente local a página `/dev` pode adiantar ou atrasar esse relógio, e a diferença fica no banco, de modo que todas as telas e tarefas veem a mesma hora. O fuso é o de Maceió, fixo em UTC-3 (`src/lib/time.ts`).

## Avisos

`notify()` (`src/lib/notifications/notify.ts`) grava o aviso do sino dentro do app e envia pelos outros canais:

- **Push:** de verdade, pelo padrão Web Push (chaves VAPID no `.env.local`).
- **SMS, WhatsApp e e-mail:** simulados. Ficam na tabela `outbound_messages` e aparecem na Caixa de mensagens do `/dev`.

## Tarefas agendadas

Ficam em `src/lib/tasks/run.ts` e são chamadas por `POST /api/tarefas`. No ambiente local, `src/instrumentation.ts` chama essa rota a cada minuto enquanto o `npm run dev` está ligado. Todas podem rodar duas vezes seguidas sem efeito repetido.

## Fotos

O campo de foto (`src/components/forms/ImageInput.tsx`) reduz a imagem no próprio aparelho antes de enviar. O servidor (`src/lib/uploads.ts`) aceita qualquer formato de imagem até 15 MB, confere pelo conteúdo que é mesmo uma imagem, regrava em WebP nos tamanhos necessários e, com isso, apaga os metadados. Capas, banners e logos ganham uma versão pequena, escolhida pelo navegador no celular (`WideImage`).

As fotos de produto do seed foram geradas por IA e ficam guardadas em `db/seed/photos/`, uma por nome de produto (`npm run seed:photos` gera as que faltarem, a partir das descrições em `db/seed/photo-prompts.ts`). O `db/seed/images.ts` tira delas os tamanhos que as telas usam e monta a capa de cada loja com três fotos dos produtos dela. O que não tem foto gerada cai no desenho feito pelo próprio projeto: os logos, os banners, as imagens dos segmentos e qualquer produto novo. Os testes automáticos gravam em `storage-test/`, separado do `storage/` de quem testa à mão.

## PWA

`src/app/manifest.ts` e `public/sw.js` tornam o app instalável, mostram uma página própria quando não há internet e recebem os avisos push. Páginas e dados sempre vêm da rede, para preço, estoque e status nunca aparecerem desatualizados.

## Servidor (VPS) com Docker

`docker-compose.yml` liga três contêineres: `db` (PostgreSQL 18), `app` (a imagem do `Dockerfile`, com `next start` e `APP_ENV=production`) e `caddy` (HTTPS automático, em `deploy/Caddyfile`). Só o Caddy fica exposto na internet. Ao ligar, o app roda `node scripts/db.ts bootstrap`: com `DB_MODE=external` o script não liga nenhum PostgreSQL, só usa o do `DATABASE_URL`, aplica as migrations e, se o banco estiver vazio, roda o seed escolhido por `SEED_MODE`. No servidor é `base` (`seedBase` em `db/seed/index.ts`): só configurações, termos, a cidade com o bairro Centro, as categorias, os planos e o admin do `.env`, sem nada fictício. As tarefas agendadas rodam dentro do app (`INTERNAL_TASK_RUNNER=1`, com o `CRON_SECRET`). O pagamento continua simulado (`PAYMENT_PROVIDER=mock`): o cliente confirma o pagamento na tela do pedido (`simulateMyPayment`), pelo mesmo webhook assinado. O build não consulta o banco: páginas que leem do banco sem depender da requisição chamam `connection()` para nunca serem montadas no build. Passo a passo em [DEPLOY_VPS.md](DEPLOY_VPS.md).

## Ambiente de testes

Com `APP_ENV=local` aparecem a faixa "Ambiente de testes" e a página `/dev`. Em qualquer outro ambiente `/dev` responde 404 e as ações dela se recusam a rodar. Se o banco estiver desligado, `src/proxy.ts` mostra a página "Banco de dados local desligado" em vez de fingir que funciona.

## Testes

| Tipo | Onde | O que cobre |
|---|---|---|
| Unitário | `src/**/*.test.ts` | As funções puras da tabela acima |
| Integração | `tests/integration/` | Direto no banco: regras de acesso por linha, coerência do seed e o caminho do dinheiro (webhook repetido, preço adulterado, taxa por bairro, estoque e estornos do reembolso parcial) |
| Simulação | `tests/simulation/` | Um pedido completo em cada loja ativa, do carrinho à entrega, conferindo o dinheiro (`npm run simulate`) |
| Navegador | `e2e/` | Os caminhos completos de cliente, lojista, entregador e admin, além de acessibilidade e segurança |

Cada arquivo de teste de navegador recria o banco `chego_test` antes de começar, para não depender do que outro arquivo alterou.

## Convenções

- Código, tabelas e variáveis em inglês. Interface, comentários e documentação em português.
- Componentes de tela reutilizáveis em `src/components/`, compartilhados entre cliente, lojista e admin.
- Um commit por etapa, com mensagem em português.
