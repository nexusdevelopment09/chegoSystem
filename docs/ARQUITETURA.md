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

- **Telefone e código.** O código vai por SMS simulado; no ambiente local é sempre `123456`. A equipe da plataforma também entra com usuário e senha.
- **Sessão.** O navegador guarda um cookie que scripts não conseguem ler. No banco fica só o hash do cookie, então uma tabela vazada não serve para entrar.
- **Papéis globais:** `customer`, `merchant` e `admin`. **Papéis dentro da loja:** `owner`, `attendant` e `courier`.
- **Proteção das páginas** sempre no servidor, com `requireUser`, `requireRole` e `requireStoreMember` (`src/lib/auth/session.ts`). Quem ainda não aceitou a versão atual dos termos é mandado para aceitar.

## Caminho de um pedido

1. **Sacola** (`src/lib/cart/`): fica no aparelho e, para quem entrou, também no servidor. Os preços da sacola servem só para mostrar.
2. **Cotação** (`src/lib/checkout/quote.ts`): o servidor recalcula tudo a partir do banco: preços, opções, taxa de entrega, cupom, taxa de serviço e total.
3. **Criação do pedido** (`src/lib/checkout/place-order.ts`): grava o pedido como `awaiting_payment`, com cópias dos nomes e preços, reserva o estoque e pede o pagamento ao gateway.
4. **Pagamento** (`src/lib/payments/`): o gateway avisa pelo webhook `/api/webhooks/pagamentos`. Só esse aviso, com assinatura válida, transforma o pedido em `paid`. O mesmo aviso recebido duas vezes não duplica nada.
5. **Mudanças de status** (`src/lib/orders/transitions.ts`): a função `transitionOrder` é o único lugar que muda o status. Ela consulta a máquina de estados (`status.ts`), grava o histórico, faz os lançamentos financeiros, os reembolsos, a devolução de estoque e cupom, e dispara os avisos.

### Gateway de pagamento

O resto do sistema só conhece a interface `PaymentProvider` (`src/lib/payments/types.ts`). Hoje existe apenas o `MockPaymentProvider`, que não usa dinheiro nem rede, mas assina os avisos como um gateway de verdade. Trocar de gateway significa escrever outro provedor nessa pasta.

## Regras em funções puras

As contas que mais importam não dependem do banco nem do Next.js, e por isso têm testes unitários rápidos:

| Arquivo | O que calcula |
|---|---|
| `src/lib/catalog/pricing.ts` | Preço do item pelos grupos de opções (soma, maior valor, média, grátis até N) |
| `src/lib/catalog/selection.ts` | Validação das escolhas e as linhas "1/2 Calabresa" |
| `src/lib/catalog/availability.ts` | Se o produto pode ser pedido naquele dia e hora |
| `src/lib/stores/hours.ts` | Loja aberta ou fechada, dois turnos, meia-noite, feriados |
| `src/lib/checkout/schedule.ts` | Horários que o cliente pode agendar |
| `src/lib/orders/totals.ts` | Divisão do dinheiro entre loja e plataforma |
| `src/lib/orders/status.ts` | Máquina de estados do pedido |
| `src/lib/orders/moderation.ts` | Bloqueio de telefones, links e contatos nas mensagens |
| `src/lib/coupons/validate.ts` | Regras e mensagens dos cupons |

## Relógio único

Todo o código pergunta a hora para `now()` (`src/lib/clock.ts`), nunca para `new Date()`. No ambiente local a página `/dev` pode adiantar ou atrasar esse relógio, e a diferença fica no banco, de modo que todas as telas e tarefas veem a mesma hora. O fuso é o de Maceió, fixo em UTC-3 (`src/lib/time.ts`).

## Avisos

`notify()` (`src/lib/notifications/notify.ts`) grava o aviso do sino dentro do app e envia pelos outros canais:

- **Push:** de verdade, pelo padrão Web Push (chaves VAPID no `.env.local`).
- **SMS, WhatsApp e e-mail:** simulados. Ficam na tabela `outbound_messages` e aparecem na Caixa de mensagens do `/dev`.

## Tarefas agendadas

Ficam em `src/lib/tasks/run.ts` e são chamadas por `POST /api/tarefas`. No ambiente local, `src/instrumentation.ts` chama essa rota a cada minuto enquanto o `npm run dev` está ligado. Todas podem rodar duas vezes seguidas sem efeito repetido.

## Fotos

O envio (`src/lib/uploads.ts`) confere o tipo real do arquivo e o limite de 5 MB, regrava em WebP nos tamanhos necessários e, com isso, apaga os metadados da foto. As fotos do seed são desenhadas pelo próprio projeto (`db/seed/images.ts`), sem baixar nada.

## PWA

`src/app/manifest.ts` e `public/sw.js` tornam o app instalável, mostram uma página própria quando não há internet e recebem os avisos push. Páginas e dados sempre vêm da rede, para preço, estoque e status nunca aparecerem desatualizados.

## Ambiente de testes

Com `APP_ENV=local` aparecem a faixa "Ambiente de testes" e a página `/dev`. Em qualquer outro ambiente `/dev` responde 404 e as ações dela se recusam a rodar. Se o banco estiver desligado, `src/proxy.ts` mostra a página "Banco de dados local desligado" em vez de fingir que funciona.

## Testes

| Tipo | Onde | O que cobre |
|---|---|---|
| Unitário | `src/**/*.test.ts` | As funções puras da tabela acima |
| Integração | `tests/integration/` | Regras de acesso por linha e a coerência do seed, direto no banco |
| Navegador | `e2e/` | Os caminhos completos de cliente, lojista, entregador e admin, além de acessibilidade e segurança |

Cada arquivo de teste de navegador recria o banco `chego_test` antes de começar, para não depender do que outro arquivo alterou.

## Convenções

- Código, tabelas e variáveis em inglês. Interface, comentários e documentação em português.
- Componentes de tela reutilizáveis em `src/components/`, compartilhados entre cliente, lojista e admin.
- Um commit por etapa, com mensagem em português.
