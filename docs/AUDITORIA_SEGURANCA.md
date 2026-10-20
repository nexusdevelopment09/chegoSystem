# Auditoria de segurança — Chegô

Feita em 18/10/2026, no ambiente de homologação local (APP_ENV=local, banco desta máquina e banco de teste `chego_test`), com usuários e lojas sintéticos. Nada foi testado contra o servidor de produção, nenhum pagamento real foi feito e nenhum dado real foi usado.

## Como foi feita

- Leitura de todas as rotas (`src/app/**/route.ts`), de todas as Server Actions (`"use server"`), das regras de acesso por linha (RLS) do banco, do login e das sessões, do upload de imagens, dos webhooks, das tarefas agendadas, das exportações em planilha, do Docker, do Caddy e dos cabeçalhos HTTP.
- `npm audit --omit=dev`: **0 vulnerabilidades** conhecidas nas dependências de produção.
- Busca de segredos no repositório: só `.env.example` e `.env.vps.example` estão versionados (sem valores reais); `.env.local` e `.env` ficam fora do git.
- Testes automatizados de tentativa de acesso indevido (cada um roda dentro de uma transação desfeita no fim):
  - `tests/integration/rls.test.ts` (13 casos, já existia) e `tests/integration/security.test.ts` (5 casos novos): isolamento entre lojas, dinheiro, papéis.
  - `tests/integration/fees.test.ts` (12 casos) e `tests/simulation/fee-sandbox.test.ts` (7 casos novos): tarifa, idempotência, fechamento e pagamento.
  - `src/lib/security.test.ts`: regressão dos achados corrigidos.

## O que já estava bem protegido (verificado)

| Área | Evidência |
|---|---|
| Autorização no servidor | Toda Server Action começa com `requireRole`, `requireStoreMember`, `requireCourier` ou `getCurrentProfile`; as do lojista confirmam no SQL que o pedido é da loja (`store_id = membership.storeId`) e as do entregador, que a entrega é dele. Esconder botão nunca é a única barreira. |
| Isolamento entre lojas | RLS ligada em **todas** as tabelas (teste "is enabled on every table"). Testado: loja A não lê pedidos, clientes, endereços, `store_private`, taxas, fechamentos nem pagamentos da loja B; não altera produto, preço "de" ou cardápio da B; atendente não vê dinheiro. |
| Dinheiro | Pelo lado do usuário ninguém altera `orders.status`, `fee_entries`, `store_closings`, `fee_payments`, `ledger_entries`, `platform_settings` (a tarifa de R$ 0,50), comissão ou o próprio papel: `permission denied`. Preços e totais são sempre recalculados no servidor (`buildQuote`). |
| Tarifa por pedido | Índice único `(order_id, kind)`: reprocessar, repetir o evento ou três chamadas simultâneas geram **uma** taxa. Cancelado, recusado, em preparo e "saiu e não chegou" não geram. Estorno é lançamento novo ligado ao original (`reverses_id`); nada é apagado. Ajuste exige motivo e autor (regra do banco) e vai para o log de auditoria. Fechamento com trava por loja: dois cliques simultâneos fecham uma vez. |
| Senhas e sessões | scrypt com sal e comparação em tempo constante; sessão em cookie `httpOnly`, `sameSite=lax`, `secure` em produção, 30 dias, token guardado só como hash; "sair de todos os aparelhos". |
| Tentativas repetidas | Limites por telefone e por IP no login, cadastro, checkout, cupom, mensagens, chamados, troca de senha. |
| Webhooks e tarefas | Assinatura HMAC com comparação em tempo constante; idempotência por `webhook_events`; `/api/tarefas` exige `x-cron-secret` (≥ 16 caracteres, tempo constante). |
| Upload | Limite de 15 MB e de 50 megapixels; a imagem é reaberta e regravada em WebP pelo `sharp` (o arquivo enviado nunca é servido como veio); nome gerado pelo servidor. `/files/...` só serve buckets conhecidos e nomes simples (sem `..`). |
| XSS | React escapa tudo; os três `dangerouslySetInnerHTML` são SVGs de QR Code gerados pela biblioteca a partir de texto do próprio sistema. Links de banner só aceitam caminhos internos (`/...`). |
| CSRF | Server Actions verificam a origem (Next); rotas JSON dependem do cookie `sameSite=lax`. |
| Infraestrutura | Banco sem porta exposta no Docker (só a rede interna); app roda como usuário `node`, não root; HTTPS pelo Caddy; `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. |
| Ferramentas de teste | `/dev`, login 0000/0000 e simulações de pagamento só funcionam com `APP_ENV=local`. |

## Achados

### Média

**M1 — Limite de tentativas por IP podia ser contornado** · *corrigido*
- Componente: `src/lib/rate-limit.ts` (`clientIp`).
- Evidência: o IP era o **primeiro** valor de `X-Forwarded-For`, que o próprio visitante pode mandar; com nginx na frente (que acrescenta ao cabeçalho), cada requisição podia fingir um IP novo.
- Impacto: força bruta de senhas distribuída por "IPs" falsos. O limite por telefone (10 tentativas a cada 10 min) continuava valendo.
- Correção: usa o **último** valor, o que o nosso proxy acrescentou (`src/lib/client-ip.ts`).
- Teste: `src/lib/security.test.ts` › "usa o endereço que o proxy acrescentou".

**M2 — Pagamento de mentira poderia valer em produção** · *corrigido*
- Componentes: `src/lib/payments/collection.ts`, `mock.ts`, `src/lib/fees/pix.ts`, `src/app/pedidos/actions.ts`.
- Evidência: com `PAYMENT_COLLECTION=app` em produção, o gateway de mentira seguiria ativo (cartão final 0000 aprova, o cliente "confirma" o Pix) e, sem `PAYMENT_WEBHOOK_SECRET`, o webhook aceitaria a assinatura com um segredo conhecido. Hoje produção usa pagamento direto à loja, então era um risco latente, não explorável na configuração atual.
- Impacto (se ativado): pedidos marcados como pagos sem pagamento.
- Correção: fora do ambiente de testes, o pagamento pelo app só liga com gateway real (senão cai no pagamento direto à loja); a simulação de pagamento e o cartão de mentira recusam fora desse modo; sem segredo configurado fora do ambiente local, nenhum webhook é aceito (segredo aleatório por processo).
- Teste: `src/lib/security.test.ts` › "pagamento de mentira nunca vale fora do ambiente de testes".

**M3 — Comandos destrutivos sem trava de ambiente** · *corrigido*
- Componente: `scripts/db.ts`.
- Evidência: `node scripts/db.ts reset` dentro do contêiner de produção apagaria o banco inteiro sem confirmação; `SEED_MODE=demo` encheria a produção com dados fictícios num banco vazio.
- Correção: `db:reset` num banco externo (o da VPS, `DB_MODE=external`) fora do ambiente local exige `CONFIRM_RESET=<nome do banco>`; o banco embutido desta máquina continua livre para os testes. O seed de demonstração é recusado com `APP_ENV=production`. A caixa de areia financeira só roda com `APP_ENV=local` e banco em `127.0.0.1`.
- Teste: executado à mão com um banco inexistente: o comando recusa antes de conectar.

### Baixa

**B1 — Fórmulas em planilhas exportadas** · *corrigido*
- Componentes: `src/lib/merchant/csv.ts`, `src/app/admin/financeiro/exportar/route.ts`.
- Evidência: uma loja que se cadastra com o nome `=HYPERLINK("http://...")` teria a fórmula executada no Excel do admin ao abrir o relatório para o contador.
- Correção: células que começam com `= + - @` ganham um apóstrofo (texto comum no Excel).
- Teste: `src/lib/security.test.ts` › "planilhas não executam fórmulas".

**B2 — Faltavam HSTS e CSP** · *corrigido parcialmente*
- `Strict-Transport-Security` (1 ano) fora do ambiente local e `Content-Security-Policy` com `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`.
- Pendente: CSP restringindo scripts exige nonce nos scripts do Next. Fica como recomendação.

### Informativa (recomendações, não corrigidas aqui)

- **I1 — Usuário do banco do app é o dono (superusuário) do PostgreSQL no Docker.** O acesso do navegador já passa pelo papel restrito `app_user` (RLS), e o banco não tem porta exposta. Recomendado: um papel próprio sem superusuário para o app.
- **I2 — Bloqueio por telefone pode ser usado para travar a conta de alguém por 10 minutos** (10 senhas erradas). Aceito: o efeito é curto e não vaza dados.
- **I3 — Backups.** Não há rotina automática. Recomendado: `docker compose exec db pg_dump -U chego chego | gzip > backup-$(date +%F).sql.gz` diário (cron na VPS) com cópia fora da VPS, e testar a restauração (`gunzip -c backup.sql.gz | docker compose exec -T db psql -U chego chego`) num banco separado.
- **I4 — Token do GitHub compartilhado na conversa.** Já orientado: revogar e gerar outro. Nenhum token fica salvo no repositório ou na configuração do git.
- **I5 — Impressoras e relatórios.** Impressoras e fila de impressão por loja, com RLS e testes de isolamento (`tests/integration/printing.test.ts`); a conexão Bluetooth fica só no aparelho (ver docs/IMPRESSAO_TERMICA.md). Relatórios filtram sempre pela loja do painel, inclusive na busca por número de pedido (`tests/integration/reports.test.ts`).

## Tarifa de R$ 0,50 — regra confirmada

- Gera taxa: pedido pago direto à loja que chega a **entregue** ou **retirado** (decisão comercial mantida: retirada também paga). Um lançamento por pedido (`order_fee`), no dia de expediente da conclusão.
- Não gera: aguardando, em preparo, pronto, saiu para entrega e não chegou, recusado, cancelado.
- Reembolso depois de concluído: estorno ligado ao original. Ajuste manual: só o admin, com motivo, autor e auditoria.
- A loja não altera a tarifa (configuração da plataforma) nem marca pedido como entregue pelo banco; marcar entregue pelo painel só aumenta a própria taxa, então não serve para fraude.
- Fechamento diário automático (dia anterior, depois das 5h) ou pela loja; cobrança Pix por fechamento; pago não some do histórico; valor diferente vai para análise; vencido gera aviso, sem bloqueio automático da loja.
