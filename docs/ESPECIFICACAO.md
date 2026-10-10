> Texto original da especificação, como foi enviado em 09 e 10/10/2026. Guardado aqui para consulta.
> O projeto se afasta dele em alguns pontos, por decisão tomada durante o trabalho (PostgreSQL direto no
> Windows em vez de Supabase e Docker, só o gateway simulado, nada publicado). Essas diferenças estão no
> [README](../README.md#9-diferenças-em-relação-à-especificação) e em [ARQUITETURA.md](ARQUITETURA.md).

# PROMPT COMPLETO — SISTEMA CHEGÔ (versão 2)

Você é um desenvolvedor full-stack sênior e vai terminar comigo o **Chegô**, um marketplace local de delivery e compras. O projeto já existe e tem a base pronta (layout, logo, faixa "Ambiente de testes" e uma tela de admin).

**Este documento é a especificação completa do sistema.** Ele substitui o `prompt-chego.md` anterior: onde os dois forem diferentes, vale este. Leia tudo antes de escrever código. Quando algo não estiver definido aqui, **pergunte antes de inventar**.

Estou no **Windows**. Sou iniciante em Docker e em linha de comando: explique os comandos em linguagem simples.

---

## 0. Antes de tudo: auditoria do que já existe

1. Leia o projeto inteiro e me entregue um relatório curto:
   - o que já está pronto e funcionando;
   - o que está pela metade;
   - o que está diferente desta especificação;
   - o que precisa ser refeito.
2. A tela atual mostra **"Admin Chegô (sem banco)"**. Isso indica que o sistema está rodando sem banco de dados, com algum modo alternativo. **Remova qualquer modo "sem banco".** O sistema deve rodar sempre com o banco local (Supabase CLI + Docker). Se o banco não estiver no ar, mostre uma página de erro clara ("Banco de dados local desligado. Rode `npm run db:start`.") em vez de fingir que funciona.
3. Verifique se o Docker Desktop está instalado e rodando (com WSL 2 no Windows). Se não estiver, **pare** e me guie na instalação passo a passo antes de continuar.
4. Só depois da auditoria e da minha aprovação, comece a Etapa 1 (seção 14).

---

## 1. O negócio

- **O que é:** um app (web + PWA) onde o cliente compra de várias lojas da cidade, paga dentro do app e recebe em casa. A plataforma fica com uma comissão sobre cada venda e cobra uma mensalidade das lojas.
- **Cidade inicial:** Joaquim Gomes, Alagoas (cerca de 12 mil habitantes), com comunidades rurais próximas. Não há iFood nem outro app de delivery na cidade.
- **Expansão:** o sistema é **multicidade** desde o início. Cada loja pertence a uma cidade; o cliente escolhe a cidade (ou é localizado nela) e só vê as lojas que entregam onde ele está.
- **Regra de ouro:** o pedido só vai para a loja **depois do pagamento aprovado**. Cliente e loja não trocam contato antes disso. O dinheiro é dividido automaticamente (split) entre loja e plataforma pelo gateway.
- **Entrega:** no início, cada loja entrega com o próprio entregador (que é um usuário da loja no sistema). Também existe a opção de retirada no balcão.
- **O dono da plataforma também tem lojas** dentro do app. Por isso, nenhuma loja pode ter vantagem escondida (ver seção 5.4).

---

## 2. Marca

- **Nome:** Chegô (sempre com circunflexo). **Slogans:** "Pediu, Chegô." e "Tudo da cidade, numa sacola só."
- **Logo:** sacola de compras branca com carinha sorridente (dois olhos e um sorriso) dentro de um quadrado arredondado laranja. Já existe no projeto; mantenha como componentes SVG (`<LogoIcon />` e `<Logo />`).
- **Cores:** laranja `#E8611A` (principal), laranja escuro `#B4480F` (hover, links), pêssego `#FFE9D6`, fundo `#FFF8F1`, marrom café `#24160C` (texto), texto secundário `#5C4632`, branco. Verde `#1E7B4F` só para sucesso e vermelho escuro `#B42318` só para erro. Nunca vermelho como cor de marca.
- **Fontes:** Fredoka (títulos e logo) e DM Sans (resto).
- **Tom de voz:** próximo e nordestino, sem exagero. Ex.: "Seu pedido saiu! Já já chega aí.", "Eita, essa loja fechou agora.", "Oxe, faltou o endereço."
- **Acessibilidade:** contraste mínimo 4.5:1, área de toque mínima 44px, `aria-label` em botões só com ícone, navegação por teclado no painel do lojista e do admin.
- **Desempenho:** muitos clientes usam celulares simples e internet fraca. Páginas leves, imagens otimizadas (WebP, tamanhos responsivos), carregamento com esqueletos (skeletons), sem bibliotecas pesadas desnecessárias.

---

## 3. Stack técnica

- **Next.js** (App Router, versão estável mais recente) + **TypeScript strict**
- **Tailwind CSS** com os tokens da marca
- **Supabase local** (Supabase CLI + Docker): PostgreSQL, Auth, Storage, Realtime
- **Zod** para validar toda entrada (formulários, APIs, webhooks)
- **Vitest** para testes unitários e de integração; **Playwright** para testes de ponta a ponta (E2E)
- **PWA**: manifest, ícones, service worker, instalável, notificações push (Web Push com chaves VAPID)
- **Pagamento:** interface `PaymentProvider` em `lib/payments/`, com `MockPaymentProvider` (padrão no ambiente local) e o gateway real [NOME DO GATEWAY] implementado depois, em modo sandbox. Troca por variável `PAYMENT_PROVIDER`.
- **Mensagens (SMS, WhatsApp, e-mail, push):** interface `NotificationProvider` em `lib/notifications/`. No ambiente local, SMS e WhatsApp são **simulados** (gravados numa tabela e exibidos na página `/dev`); e-mail vai para o Mailpit/Inbucket do Supabase local; push funciona de verdade no `localhost`.
- **Fuso horário:** `America/Maceio`. **Moeda:** BRL (`R$ 1.234,56`).
- **Dinheiro sempre em centavos inteiros** no banco e no código (`price_cents integer`). Nunca use `float` para dinheiro. Formate só na hora de exibir.
- **Código, tabelas e variáveis em inglês. Interface 100% em português do Brasil.**
- **Git:** um commit ao final de cada etapa, mensagem em português.

---

## 4. Ambiente local de testes

1. `npm run db:start` sobe o Supabase local; `npm run db:reset` recria o banco com todas as migrations e o seed completo (seção 11); `npm run dev` roda o app aceitando acesso pela rede (`-H 0.0.0.0`), para eu testar no celular pelo IP do computador no mesmo Wi-Fi.
2. Outros scripts: `db:stop`, `db:types` (gera os tipos TypeScript do banco), `seed:images` (gera as fotos falsas), `test` (unitários + integração), `test:e2e` (Playwright), `test:all` (tudo), `lint`, `typecheck`.
3. `.env.example` documentado, com um bloco comentado das variáveis de produção para o futuro.
4. Faixa "Ambiente de testes" no topo sempre que `APP_ENV=local`.
5. **Página `/dev`** (só existe com `APP_ENV=local`; em qualquer outro ambiente retorna 404):
   - **Login rápido:** lista todos os usuários de teste com um botão "Entrar como" (admin, cada lojista, cada atendente, cada entregador, cada cliente).
   - **Pagamentos pendentes:** lista pedidos aguardando pagamento com os botões "Aprovar", "Recusar" e "Expirar".
   - **Relógio simulado:** permite definir uma data e hora falsas para o sistema (guardadas em cookie ou variável), para testar horários de lojas, horário limite das quentinhas, produtos de café da manhã, etc. Todo o código deve pegar a hora atual por uma única função (`now()`), nunca `new Date()` espalhado.
   - **Caixa de mensagens:** mostra todos os SMS, WhatsApp, e-mails e notificações que o sistema "enviou", com destinatário, texto e data.
   - **Gerar pedido aleatório** (para testar o painel do lojista recebendo pedidos).
   - **Rodar tarefas agendadas agora** (expirar Pix, lembretes, etc.; seção 9).
   - **Resetar banco** (com confirmação).
6. Login por telefone no ambiente local com **código fixo `123456`** para todos os números de teste. Nenhum SMS real.

---

## 5. Regras de negócio

### 5.1 Pedido e pagamento
1. O carrinho é de **uma loja por vez**. Ao adicionar item de outra loja: "Seu carrinho tem itens da [Loja X]. Quer esvaziar e começar um novo?"
2. O carrinho fica salvo no aparelho e, com o cliente logado, também no servidor (recupera em outro aparelho).
3. **Todo preço, desconto, taxa e total é recalculado no servidor** no checkout, a partir do banco. Nada vindo do navegador é confiável.
4. Se um preço mudou ou um item esgotou desde que o cliente montou o carrinho, avise antes de pagar e mostre o novo total.
5. Respeitar **pedido mínimo** da loja (não conta a taxa de entrega).
6. O pedido nasce `awaiting_payment`. Pix expira em **15 minutos** (configurável); pedido não pago vira `expired`.
7. Só vira `paid` pelo **webhook** do provedor de pagamento, com assinatura validada e **idempotência** (o mesmo evento recebido duas vezes não pode duplicar nada).
8. Pagamentos: **Pix** (QR Code + copia e cola + contador) e **cartão de crédito** (formulário do gateway; no mock, cartões de teste: final 0000 aprova, final 1111 recusa).
9. **Dinheiro na entrega: desligado**, mas existe a opção no banco por loja e por cliente (feature flag) para o futuro.
10. **Código do pedido** curto e legível, por cidade: `JG-0001`, `JG-0002`...
11. **Código de entrega:** cada pedido com entrega tem um código de 4 dígitos que aparece para o cliente. O entregador digita o código para marcar como entregue. Sem código, só o dono da loja ou o admin podem marcar entregue (com motivo registrado).

### 5.2 Status do pedido
```
awaiting_payment → paid → accepted → preparing → ready → out_for_delivery → delivered
                                                     └→ (retirada) ready → picked_up
saídas: expired | rejected | cancelled | refunded | partially_refunded
```
- Transições permitidas definidas numa **máquina de estados** única no código (com testes). Qualquer transição fora dela é recusada.
- Cada mudança gravada em `order_status_history` (status, autor, motivo, data).
- **Aceite da loja:** se a loja não aceitar em **8 minutos** (configurável), alerta sonoro mais forte no painel, notificação ao dono da loja e alerta ao admin. Em **15 minutos** sem resposta, o pedido é **recusado automaticamente** com reembolso total e aviso ao cliente.
- **Cancelamento pelo cliente:** permitido enquanto o status for `paid` (loja ainda não aceitou), com reembolso total automático. Depois disso, só pelo suporte.
- **Recusa pela loja:** exige motivo (lista: "Item esgotado", "Loja muito cheia", "Fora da área de entrega", "Outro") e gera reembolso total automático.
- **Tempo estimado:** tempo de preparo da loja + tempo de entrega da área. A loja pode ativar "Movimento alto: +15 / +30 / +45 min" no painel, e isso aparece para os clientes.

### 5.3 Split, comissão e financeiro
Para cada pedido pago, guarde separadamente:
- `subtotal_cents` (produtos + opções)
- `discount_cents` e quem paga o desconto (`platform` ou `store`)
- `delivery_fee_cents` (vai **inteiro para a loja**, que faz a entrega)
- `service_fee_cents` (taxa fixa por pedido, configurável pelo admin; vai **inteira para a plataforma**; pode ser zero)
- `commission_rate` (percentual da loja **no momento do pedido**) e `commission_cents = subtotal × commission_rate` (arredondar para o centavo mais próximo)
- `store_amount_cents` e `platform_amount_cents`
- `total_cents` (o que o cliente paga)

Regras:
- Desconto pago pela **plataforma** sai da parte da plataforma; pago pela **loja**, sai da parte da loja. A comissão é sempre calculada sobre o subtotal **antes** do desconto da plataforma e **depois** do desconto da loja.
- Todo movimento financeiro gera lançamentos em `ledger_entries` (crédito/débito, conta: loja ou plataforma, pedido, motivo). Reembolsos geram lançamentos de estorno.
- **Mensalidade das lojas:** planos (`subscription_plans`) com valor mensal; cada loja tem uma assinatura (`store_subscriptions`) e faturas mensais (`invoices`) pagas pelo mesmo provedor (mock no local). Fatura vencida: aviso no painel da loja após 1 dia; após 10 dias, o admin pode suspender a loja (manual, não automático). Lojas "fundadoras" podem ter meses grátis (campo `free_until`).
- **Repasses:** o gateway faz o split automático. O sistema mostra para a loja um **extrato** (vendas, comissão, taxas, reembolsos, valor líquido, data prevista do repasse) e para o admin uma **conciliação** (o que o gateway diz × o que o sistema calculou), apontando diferenças.
- **Relatório mensal de comissões por loja** (para o contador emitir nota fiscal), exportável em CSV.

### 5.4 Justiça entre lojas
- Ordenação padrão da lista de lojas: **abertas primeiro**, depois por **distância/área**, depois por **avaliação**. Lojas com **destaque pago e vigente** aparecem numa seção "Destaques" separada e identificada.
- O admin não consegue colocar uma loja no topo fora dessas regras. Toda mudança de comissão, destaque ou plano fica no `audit_logs`.
- Uma loja nunca vê dados de outra loja.

### 5.5 Contato entre cliente e loja
- Nada de telefone, chat ou WhatsApp antes do pagamento.
- Depois do pagamento: a loja vê nome, telefone e endereço do cliente; o cliente vê o nome da loja.
- **Mensagens do pedido** (chat simples entre cliente e loja), disponíveis só depois do pagamento e até 2 horas após a entrega. Moderação automática: bloquear números de telefone (com ou sem espaços, pontos, traços), e-mails, links, @ e palavras como "zap", "whats", "wpp", "pix direto", "me chama". Mensagem bloqueada não é enviada e o autor vê: "Por segurança, não é permitido trocar contatos por aqui." Tentativas ficam registradas para o admin.

### 5.6 Lojas
- Campos: nome, slug, categoria, cidade, endereço, logo, capa, descrição curta, telefone interno (só admin vê), horários por dia da semana (permite dois turnos no mesmo dia, ex.: 6h–10h e 17h–22h), feriados/fechamentos especiais, tempo de preparo, pedido mínimo, faz entrega e/ou retirada, áreas de entrega com taxa e tempo por bairro/comunidade, aceita pedido agendado (com antecedência mínima e máxima), percentual de comissão, plano de mensalidade, dados do recebedor no gateway, status (`pending`, `active`, `paused`, `suspended`), regra de preço de pizza meio a meio (seção 6.1).
- **Cadastro de loja:** a própria loja pode se cadastrar pelo site ("Quero vender no Chegô"), preenchendo dados e documentos (CPF ou CNPJ). Fica `pending` até o admin aprovar com um checklist.
- **Abrir/fechar agora** e **pausar** (ex.: "Voltamos em 30 minutos") direto no painel.
- Loja fechada aparece no fim da lista, acinzentada, com "Abre hoje às 18h" ou "Abre amanhã às 6h". Se aceitar agendamento, o cliente pode agendar mesmo com ela fechada.

### 5.7 Produtos
- Campos: nome, descrição, foto, preço, seção do cardápio, ordem, disponível/esgotado, destaque da loja, **dias e horários de disponibilidade** (ex.: café da manhã só até 10h; prato do dia só na segunda), **antecedência mínima** (ex.: cento de salgados com 24h), quantidade máxima por pedido, controle de estoque opcional (`track_stock` + `stock_qty`; esgota sozinho ao zerar), `requires_age_check`, `product_type` (`standard` agora; `variant`, `service` preparados para o futuro).
- **Grupos de opções** com: nome, obrigatório ou não, mínimo e máximo de escolhas, se permite repetir a mesma opção (ex.: 2 coxinhas), e **modo de preço**:
  - `sum`: soma o preço de cada opção (adicionais);
  - `highest`: o item custa o preço da opção mais cara escolhida (pizza meio a meio padrão);
  - `average`: o item custa a média dos preços escolhidos;
  - `free_up_to`: as N primeiras escolhas são grátis e as seguintes custam o preço da opção (complementos do açaí).
- **Grupos de opções reutilizáveis:** um grupo (ex.: "Sabores", "Bordas") pode ser ligado a vários produtos, com **preço diferente por produto** (ex.: sabor Calabresa custa um valor na pizza Média e outro na Grande). Tabelas: `option_groups`, `options`, `product_option_groups` (liga grupo ao produto com min/max/modo), `product_option_prices` (preço da opção naquele produto).
- **Observação do item:** campo de texto opcional (até 140 caracteres) em cada item.
- Ao gravar o pedido, salve **cópias** de nome, preço, opções escolhidas e preços das opções, para que mudanças futuras no cardápio não alterem pedidos antigos.

### 5.8 Regras por categoria
- **Bebidas alcoólicas:** com item `requires_age_check` no carrinho, o cliente confirma no checkout "Confirmo que tenho 18 anos ou mais". O pedido aparece para a loja e para o entregador com o aviso "**Conferir documento na entrega**". Se o cliente marcou no perfil uma data de nascimento com menos de 18 anos, o checkout é bloqueado.
- **Farmácia:** só produtos sem receita, higiene, perfumaria e cosméticos. No cadastro de produto da farmácia, aviso fixo: "Proibido cadastrar medicamentos que exigem receita." Página da farmácia mostra: "Medicamentos com receita não são vendidos pelo app."
- **Quentinhas:** horário limite de pedido para o almoço e faixa de entrega. Prato do dia por dia da semana (disponibilidade de produto por dia).
- **Peixaria e mercado:** produtos vendidos por peso são **porções fixas** (bandeja 500 g, 1 kg).
- **Mercado:** no checkout, o cliente escolhe o que fazer **se faltar um item**: "Me ligar", "Substituir por similar" ou "Remover o item e devolver o valor". Se a loja remover um item, o sistema faz **reembolso parcial** automático e avisa o cliente.
- **Suplementos e naturais:** aviso no cadastro: "Não prometa cura ou resultados de saúde na descrição."
- **Encomendas** (cento de salgados, bolos): produto com antecedência mínima obriga o pedido a ser agendado.

### 5.9 Cupons
- Criados pelo admin (pagos pela plataforma ou pela loja, conforme acordo) e pela própria loja (sempre pagos pela loja).
- Tipos: valor fixo, percentual (com teto), frete grátis.
- Regras: validade, uso total máximo, uso por cliente, valor mínimo, só primeira compra no app, lojas específicas, categorias específicas, cidades específicas.
- Mensagens claras para cada recusa: "Cupom expirado", "Pedido mínimo de R$ 30,00 para este cupom", "Este cupom é só para a primeira compra", etc.
- **Indique e ganhe:** cada cliente tem um código. Quem é indicado ganha um cupom na primeira compra; quem indicou ganha um cupom depois que o indicado conclui o primeiro pedido entregue. Valores configuráveis pelo admin.

### 5.10 Avaliações
- Liberadas após `delivered`/`picked_up`, até 7 dias. Uma por pedido: nota de 1 a 5 e comentário opcional (até 500 caracteres).
- Lembrete ao cliente 1 hora depois da entrega.
- A loja responde publicamente. O admin pode ocultar avaliações ofensivas (com motivo registrado).
- Nota da loja = média das avaliações dos últimos 180 dias. Loja com menos de 5 avaliações mostra "Nova".

### 5.11 Endereços e áreas de entrega
- Endereço: rua, número (ou "S/N"), bairro ou comunidade, **ponto de referência** (obrigatório na zona rural), complemento, cidade, localização no mapa (opcional, com botão "usar minha localização").
- A área de entrega da loja é definida **por bairro/comunidade**, com taxa e tempo próprios. (Raio em km fica como opção extra.)
- Se o endereço do cliente não está na área da loja: "Essa loja ainda não entrega em [bairro]." com opção de retirada, se houver.

### 5.12 Suporte
- Em cada pedido, o cliente tem "Preciso de ajuda", com motivos: atraso, item faltando, item errado, item danificado, cobrança, outro. Pode anexar foto.
- Abre um chamado (`support_tickets`) para o admin, que conversa com o cliente, pode acionar a loja e pode fazer **reembolso parcial ou total**.
- Status do chamado: aberto, em andamento, aguardando cliente, resolvido.

### 5.13 Privacidade (LGPD) e termos
- Termos de Uso, Termos do Lojista e Política de Privacidade **versionados**. Ao publicar nova versão, o usuário precisa aceitar de novo no próximo acesso. Aceites gravados com data e versão. (O texto final eu fornecerei; use textos provisórios marcados como "[TEXTO PROVISÓRIO]".)
- O cliente pode baixar seus dados (JSON) e excluir a conta. Ao excluir, os pedidos são mantidos para a contabilidade, mas os dados pessoais são anonimizados.

---

## 6. Detalhes dos fluxos de produto mais importantes

### 6.1 Pizza com escolha de sabores (montador de pizza)
Na página do produto da pizzaria, o cliente escolhe o **tamanho** (cada tamanho é um produto) e depois os **sabores**:

| Tamanho | Fatias | Sabores permitidos |
|---|---|---|
| Broto | 4 | 1 |
| Média | 6 | até 2 |
| **Grande** | 8 | **até 2** |
| Família | 12 | até 3 |

- Os sabores aparecem separados em **Tradicionais**, **Especiais** e **Doces**, cada um com o preço naquele tamanho.
- **Regra de preço** configurável por loja: **maior valor entre os sabores** (padrão) ou **média dos sabores**. A regra aparece escrita para o cliente: "Pizza com 2 sabores: cobramos o valor do sabor mais caro."
- **Desenho da pizza:** um círculo dividido em partes iguais ao número de sabores escolhidos, cada parte com o nome do sabor. Atualiza ao vivo enquanto o cliente escolhe.
- **Borda** (uma só para a pizza toda, opcional): sem borda, catupiry, cheddar, chocolate. Preço da borda varia por tamanho.
- **Observação** ("sem cebola", "bem assada").
- No carrinho, no pedido e na impressão térmica aparece assim:
  ```
  1x Pizza Grande (8 fatias)
     1/2 Calabresa
     1/2 Carne de Sol com Queijo Coalho
     Borda: Catupiry
     Obs: sem cebola
  ```
- O mesmo motor (grupos de opções com modo de preço) deve servir para açaí, hambúrguer e quentinhas, sem código especial por loja.

### 6.2 Açaí
Tamanho (300, 500, 700 ml) → base (açaí puro, açaí com banana, cupuaçu) → **complementos grátis até 4** (modo `free_up_to`; a partir do 5º, cada um custa R$ 1,00) → adicionais pagos → "Complementos por cima ou em camadas".

### 6.3 Hambúrguer
Ponto da carne (obrigatório, uma escolha) → adicionais pagos → "Retirar ingredientes" (grátis, várias escolhas) → "Transformar em combo?" (batata + refrigerante lata, preço extra).

### 6.4 Quentinha
Prato do dia (muda por dia da semana) → tamanho (P ou G) → **acompanhamentos: escolha 3** (obrigatório, exatamente 3) → proteína extra (opcional, paga). Pedidos para o almoço até **11h**, com entrega entre 11h30 e 13h30. Depois das 11h, aparece: "Os pedidos de hoje já fecharam. Quer agendar para amanhã?"

---

## 7. Telas

### 7.1 Cliente (mobile primeiro; também funciona bem no computador)
1. **Boas-vindas** (primeiro acesso): escolher cidade, permissão de localização opcional, botão "Instalar o app" (PWA).
2. **Início:** endereço atual no topo (troca rápida), busca, ícones de categorias, banners, "Destaques", "Pedir de novo" (últimas lojas), "Abertas agora", "Novidades na cidade".
3. **Busca:** por loja e por produto, com sugestões enquanto digita, buscas recentes e filtros (abertas agora, categoria, entrega grátis, retirada, melhor avaliadas). Resultado vazio com sugestão.
4. **Categoria:** lojas da categoria com os mesmos filtros.
5. **Loja:** capa, logo, nota, tempo e taxa de entrega para o endereço atual, pedido mínimo, aberto/fechado/pausada, aviso de "movimento alto", botão favoritar, compartilhar (link para WhatsApp), menu de seções fixo ao rolar, produtos esgotados acinzentados no fim da seção, avaliações e informações (horários, áreas atendidas).
6. **Produto:** foto grande, descrição, grupos de opções com indicação "Obrigatório" e contador "2 de 3", total atualizando ao vivo, observação, quantidade, botão "Adicionar • R$ 49,00" desabilitado enquanto faltar escolha obrigatória (com o motivo).
7. **Carrinho:** itens com opções, editar, remover, quantidade, observação geral, cupom, resumo (subtotal, desconto, entrega, taxa de serviço, total), aviso de pedido mínimo com quanto falta.
8. **Checkout:** entrega ou retirada, endereço, "agora" ou "agendar" (dias e horários válidos para a loja), o que fazer se faltar item (mercado), confirmação de idade (bebidas), forma de pagamento, resumo final, aceite dos termos se houver nova versão.
9. **Pagamento Pix:** QR Code, copia e cola com botão copiar, contador regressivo, atualização automática ao aprovar, opção de trocar para cartão.
10. **Acompanhar pedido:** linha do tempo em tempo real, tempo estimado, código de entrega, mensagens com a loja, "Preciso de ajuda", cancelar (quando permitido), detalhes e recibo.
11. **Meus pedidos:** em andamento e anteriores, "Pedir de novo" (refaz o carrinho com o que ainda estiver disponível e avisa o que mudou), avaliar.
12. **Favoritos.**
13. **Notificações** (sino com contador).
14. **Perfil:** nome, telefone, e-mail, data de nascimento (opcional), endereços, código de indicação, cupons disponíveis, preferências de notificação, termos, baixar meus dados, excluir conta, sair.
15. **Entrar/cadastrar:** telefone → código → nome → aceite dos termos.
16. **Páginas públicas:** `/loja/[slug]` com imagem de prévia para o link aparecer bonito no WhatsApp; "Quero vender no Chegô"; termos; política; ajuda (perguntas frequentes).
17. **Estados especiais em todas as telas:** carregando (skeleton), vazio, erro com "Tentar de novo", sem internet ("Você está sem internet. Assim que voltar, a gente continua.").

### 7.2 Lojista (precisa funcionar muito bem no celular **e** no computador do balcão)
Papéis dentro da loja: **dono** (tudo), **atendente** (pedidos e cardápio, sem financeiro), **entregador** (só as próprias entregas).

1. **Pedidos (tela principal):** colunas Novos / Em preparo / Prontos / Em entrega / Concluídos hoje. Novo pedido toca **alerta sonoro repetido** até alguém aceitar ou recusar, e mostra notificação do navegador. Contador do tempo para aceitar. Ver detalhes, aceitar (com tempo de preparo sugerido e editável), recusar (com motivo), avançar status, atribuir entregador, **imprimir** (layout para impressora térmica de 58 mm e 80 mm, com opção de imprimir automaticamente ao aceitar), remover item em falta (gera reembolso parcial), mensagens com o cliente.
2. **Entregador:** "Minhas entregas" com endereço, ponto de referência, botão "Abrir no mapa" (Google Maps/Waze), telefone do cliente, valor do pedido, aviso de conferir documento quando houver bebida, campo para digitar o código de entrega.
3. **Cardápio:** seções com reordenação (arrastar), produtos (criar, editar, duplicar, ativar/desativar, marcar esgotado com um toque), fotos, grupos de opções reutilizáveis, preços por produto, disponibilidade por dia/horário, estoque. **Importar/exportar produtos por planilha CSV** (essencial para o mercado e a farmácia). **Reajuste de preços em lote** (ex.: +5% na seção Pizzas).
4. **Minha loja:** dados, logo e capa, horários e feriados, abrir/fechar/pausar, movimento alto, áreas de entrega e taxas, tempo de preparo, pedido mínimo, agendamento, regra de preço da pizza meio a meio, impressora, usuários da loja (convidar por telefone, definir papel, remover).
5. **Cupons da loja.**
6. **Avaliações:** ver e responder.
7. **Relatórios:** vendas por dia/semana/mês, número de pedidos, ticket médio, produtos mais vendidos, horários de pico, taxa de cancelamento/recusa, tempo médio de aceite e de preparo. Exportar CSV.
8. **Financeiro:** extrato por pedido (bruto, comissão, taxas, reembolsos, líquido), repasses previstos e feitos, faturas da mensalidade (pagar pelo app).
9. **Material de divulgação:** baixar o **QR Code da loja** (leva para `/loja/[slug]`) e um cartaz simples "Peça também pelo Chegô" em PDF para imprimir.

### 7.3 Admin
1. **Painel geral:** pedidos hoje/semana/mês, faturamento total (GMV), receita da plataforma (comissões + taxas de serviço + mensalidades), ticket médio, clientes novos, **taxa de recompra em 30 dias**, cancelamentos e recusas, tempo médio de aceite e de entrega, lojas abertas agora. Gráficos simples. Filtro por cidade e período.
2. **Pedidos em andamento ao vivo:** alerta para pedido sem aceite, atrasado ou com problema de pagamento.
3. **Lojas:** lista com filtros, aprovar (checklist: dados, documentos, cardápio com pelo menos 5 produtos com foto, horários, área de entrega, recebedor no gateway), pausar, suspender (com motivo), editar comissão, plano e meses grátis, destaque com data de fim, **"Ver como esta loja"** (somente leitura, registrado no log).
4. **Pedidos:** busca por código/cliente/loja, detalhes completos, histórico, pagamentos, reembolso total ou parcial (com motivo), alterar status em caso excepcional (com motivo).
5. **Clientes:** lista, histórico, bloquear/desbloquear (com motivo), liberar dinheiro na entrega no futuro.
6. **Suporte:** fila de chamados com prioridade e tempo de espera.
7. **Moderação:** avaliações denunciadas, tentativas bloqueadas de troca de contato.
8. **Financeiro:** comissões por loja e período, faturas de mensalidade (pagas, abertas, vencidas), conciliação com o gateway, relatório mensal para o contador (CSV).
9. **Marketing:** banners (imagem, link, cidade, período), cupons, indicação, destaques.
10. **Cadastros:** cidades, bairros e comunidades, categorias (ícone, ordem, ativa), planos de mensalidade.
11. **Configurações:** taxa de serviço, comissão padrão, tempos de aceite e recusa automática, expiração do Pix, valores da indicação, feature flags (dinheiro na entrega, chat, cartão), modo manutenção (por cidade).
12. **Termos:** publicar nova versão dos termos e política.
13. **Log de auditoria:** quem fez o quê e quando, com filtros.

---

## 8. Notificações

Toda notificação é registrada em `notifications` (in-app) e, quando for o caso, enviada pelos canais configurados. No local, SMS/WhatsApp aparecem na caixa de mensagens do `/dev`.

| Evento | Quem recebe | Canais |
|---|---|---|
| Pedido pago (novo pedido) | Loja (dono e atendentes) | Som no painel, push, in-app |
| Pedido sem aceite em 8 min | Dono da loja, admin | Push, SMS, in-app |
| Pedido aceito / em preparo / pronto / saiu / entregue | Cliente | Push, in-app |
| Pedido recusado ou cancelado + reembolso | Cliente | Push, SMS, in-app |
| Pix vai expirar em 3 min | Cliente | Push, in-app |
| Item removido + reembolso parcial | Cliente | Push, in-app |
| Nova mensagem no pedido | Cliente ou loja | Push, in-app |
| Lembrete de avaliação | Cliente | Push, in-app |
| Resposta no suporte | Cliente | Push, in-app, e-mail |
| Loja aprovada / suspensa | Dono da loja | SMS, e-mail, in-app |
| Fatura gerada / vencendo / vencida | Dono da loja | E-mail, in-app |
| Cupom de indicação liberado | Cliente | Push, in-app |

O cliente pode desligar notificações promocionais, mas não as do pedido.

---

## 9. Tarefas agendadas
No local, rodam por uma rota interna chamada de minuto em minuto pelo `npm run dev` (ou manualmente pelo `/dev`). Em produção, serão agendadas na nuvem. Todas são idempotentes:
- Expirar pedidos Pix não pagos.
- Aviso de Pix perto de expirar.
- Alerta e recusa automática de pedidos sem aceite.
- Lembrete de avaliação.
- Liberar cupom de indicação.
- Gerar faturas mensais e marcar faturas vencidas.
- Encerrar destaques e banners vencidos.
- Encerrar mensagens de pedidos 2h após a entrega.
- Recalcular notas das lojas.

---

## 10. Modelo de dados (mínimo esperado)
`cities`, `neighborhoods` (com `is_rural`), `profiles` (papel global: customer | merchant | admin; data de nascimento; bloqueio; código de indicação), `addresses`, `categories`, `stores`, `store_members` (owner | attendant | courier), `store_hours`, `store_closures`, `store_delivery_areas`, `subscription_plans`, `store_subscriptions`, `invoices`, `product_sections`, `products`, `product_availability`, `option_groups`, `options`, `product_option_groups`, `product_option_prices`, `carts`, `cart_items`, `orders`, `order_items`, `order_item_options`, `order_status_history`, `order_messages`, `blocked_message_attempts`, `payments`, `refunds`, `webhook_events`, `ledger_entries`, `coupons`, `coupon_redemptions`, `referrals`, `reviews`, `favorites`, `banners`, `notifications`, `push_subscriptions`, `outbound_messages`, `support_tickets`, `ticket_messages`, `legal_documents`, `legal_acceptances`, `platform_settings`, `feature_flags`, `audit_logs`.

- **RLS em todas as tabelas**, com testes automáticos provando que: cliente não vê pedido de outro cliente; atendente de uma loja não vê outra loja; entregador só vê as próprias entregas; atendente não vê financeiro; ninguém além do admin vê `audit_logs`.
- Operações que mexem em dinheiro e status rodam **no servidor**, em transações, com a chave de serviço; nunca direto do navegador.
- Índices para as consultas mais usadas (pedidos por loja e status, lojas por cidade e categoria, busca de produtos por nome com `pg_trgm`).
- Migrations numeradas, nunca editar uma migration já aplicada; criar nova.

---

## 11. Dados de teste (seed) — completos e realistas

Todos os nomes de lojas e pessoas são **fictícios**. Todos os telefones de teste usam o código `123456`. Crie também o arquivo `docs/USUARIOS_DE_TESTE.md` com a tabela de logins.

### 11.1 Cidades e áreas
- **Joaquim Gomes – AL** (ativa). Bairros fictícios: Centro, Vila Nova, Alto do Cruzeiro, Conjunto Esperança, Loteamento Bela Vista. Comunidades rurais fictícias: Sítio Riacho Fundo, Povoado Lagoa Seca, Sítio Mata Verde. (Vou trocar pelos nomes reais depois.)
- **Cidade Vizinha Teste – AL** (inativa), com 2 bairros e 1 loja, para testar o multicidade.
- Taxas de exemplo: Centro R$ 3,00 (20–35 min); demais bairros R$ 4,00 a R$ 6,00 (30–45 min); comunidades rurais R$ 8,00 a R$ 12,00 (45–70 min). Nem toda loja atende a zona rural.

### 11.2 Usuários
- **Admin:** Admin Chegô, `+55 82 90000-0000`.
- **Lojistas:** um dono para cada loja (`+55 82 91000-00XX`), mais na Pizzaria Forno de Barro um **atendente** e um **entregador**, e no Mercado Boa Compra um **atendente**.
- **Clientes (10), cada um para testar uma situação:**
  1. Ana Clara Souza — Centro, cliente frequente (muitos pedidos, favoritos, avaliações).
  2. Bruno Henrique Lima — Vila Nova, pedidos variados.
  3. Carla Mendes — Sítio Riacho Fundo (zona rural), com ponto de referência.
  4. Diego Alves — **cliente novo, nenhum pedido** (testar cupom de primeira compra e indicação).
  5. Eduarda Santos — tem um pedido `awaiting_payment` com Pix aberto.
  6. Felipe Rocha — tem um pedido em andamento (`out_for_delivery`).
  7. Gabriela Nunes — tem um chamado de suporte aberto.
  8. Henrique Costa — **cliente bloqueado** (não consegue fazer pedido).
  9. Isabela Ferreira — data de nascimento com **17 anos** (bloqueio de bebida alcoólica).
  10. João Pedro Barros — Povoado Lagoa Seca, tem pedido recusado com reembolso.

### 11.3 Lojas (14 ativas + 1 pendente + 1 suspensa + 1 na cidade vizinha)
| # | Loja (fictícia) | Categoria | Horário | Observações |
|---|---|---|---|---|
| 1 | Pizzaria Forno de Barro | Restaurantes | Ter–Dom 18h–23h30 | Montador de pizza, regra "maior valor" |
| 2 | Casa da Lasanha | Restaurantes | Todos os dias 11h–14h e 18h–22h | Dois turnos |
| 3 | Quentinha da Dona Lia | Restaurantes | Seg–Sáb 9h–14h | Pedidos até 11h, prato do dia |
| 4 | Sushi Maré | Restaurantes | Qua–Dom 18h–23h | Fechado seg e ter |
| 5 | Peixaria Águas Claras | Restaurantes | Ter–Dom 7h–17h | Porções fixas, só retirada aos domingos |
| 6 | Brasa Burger | Lanches | Todos os dias 18h–00h | Atravessa a meia-noite (testar) |
| 7 | Delícias da Vó | Lanches | Seg–Sáb 8h–19h | Encomendas com 24h de antecedência |
| 8 | Padaria Pão Quentinho | Café da manhã | Todos os dias 5h30–11h e 15h–20h | Itens de café só até 10h |
| 9 | Açaí Tropical | Açaí e sobremesas | Todos os dias 14h–23h | Complementos `free_up_to` |
| 10 | Depósito Gelada Já | Bebidas | Todos os dias 9h–02h | Verificação de idade, atende zona rural |
| 11 | Mercado Boa Compra | Mercado | Seg–Sáb 7h–20h, Dom 7h–12h | ~60 produtos, estoque, substituição |
| 12 | Farmácia Saúde Mais | Farmácia | Todos os dias 7h–22h | Só itens sem receita, estoque |
| 13 | Empório Vida Verde | Saudável | Seg–Sáb 8h–18h | Porções a granel |
| 14 | Força Total Suplementos | Saudável | Seg–Sáb 9h–19h | Sabores como opção |
| 15 | Espetinho do Zé | Lanches | — | **Pendente** de aprovação (testar fluxo do admin) |
| 16 | Pastelaria Sabor Antigo | Lanches | — | **Suspensa** por fatura vencida (não aparece para clientes) |
| 17 | Lanchonete Ponto Certo | Lanches | — | Na **Cidade Vizinha Teste** (não aparece em Joaquim Gomes) |

Comissões de exemplo variadas (8%, 10%, 12%), uma loja fundadora com mensalidade grátis até daqui a 3 meses, uma com destaque pago vigente.

### 11.4 Cardápios (preços fictícios em R$)

**1. Pizzaria Forno de Barro**
- Pizza Broto (4 fatias, 1 sabor), Média (6 fatias, até 2), **Grande (8 fatias, até 2)**, Família (12 fatias, até 3).
- **Sabores e preços por tamanho (Broto / Média / Grande / Família):**
  - *Tradicionais* (25 / 35 / 45 / 60): Mussarela, Calabresa, Portuguesa, Frango com Catupiry, Margherita, Napolitana, Milho com Bacon, Atum.
  - *Especiais* (32 / 44 / 56 / 74): Carne de Sol com Queijo Coalho, Charque com Cebola Roxa, Camarão, Quatro Queijos, Calabresa Especial com Cheddar.
  - *Doces* (27 / 37 / 47 / 62): Chocolate com Morango, Banana com Canela, Romeu e Julieta, Prestígio.
- **Bordas (Broto / Média / Grande / Família):** Catupiry ou Cheddar (5 / 7 / 8 / 10), Chocolate (6 / 8 / 9 / 11).
- Bebidas: Refrigerante 2 L (12,00), Refrigerante lata (6,00), Suco natural 500 ml (8,00), Água (3,00).
- Combo: Pizza Grande 2 sabores tradicionais + Refrigerante 2 L (52,00).
- Sabor "Camarão" marcado como **esgotado** (testar).

**2. Casa da Lasanha:** Lasanha Bolonhesa, Frango com Catupiry, Quatro Queijos, Carne de Sol — individual (22,00 a 28,00) e família, serve 4 (65,00 a 80,00). Opção "Pronta para comer / Congelada". Bebidas.

**3. Quentinha da Dona Lia**
- Prato do dia por dia: Seg Frango guisado, Ter Carne de sol acebolada, Qua Feijoada, Qui Peixe frito, Sex Galinha caipira, Sáb Churrasco misto.
- Tamanho P (15,00) ou G (20,00). **Acompanhamentos — escolha exatamente 3:** arroz branco, feijão, macarrão, farofa, salada, vinagrete, purê, baião de dois.
- Proteína extra (+6,00). Marmita Fitness (frango grelhado, arroz integral, legumes) 22,00. Suco do dia 5,00.

**4. Sushi Maré:** Combo 15 peças (45,00), Combo 30 peças (79,00), Combo 50 peças (125,00), Temaki salmão (26,00), Hot roll 10 peças (28,00). Opções: "Enviar hashi? Sim/Não", molho tarê extra (+2,00), sem cebolinha.

**5. Peixaria Águas Claras:** Tilápia inteira — bandeja 1 kg (28,00), Filé de tilápia 500 g (25,00), Camarão limpo 500 g (45,00), Sardinha 1 kg (18,00), Postas de cavala 1 kg (38,00). Opção "Como preparar: inteiro / limpo / em postas / filetado" (grátis). Peixe frito pronto, porção (30,00).

**6. Brasa Burger**
- Brasa Clássico (22,00), Brasa Bacon (26,00), Brasa Duplo (32,00), Brasa Nordestino com queijo coalho e manteiga de garrafa (29,00), Frango Crispy (24,00), Veggie (24,00).
- Ponto da carne (obrigatório): ao ponto, bem passado. Adicionais: bacon (+4,00), cheddar (+3,00), ovo (+2,00), carne extra (+8,00), queijo coalho (+4,00). Retirar: cebola, tomate, alface, picles, molho. Combo: batata média + refrigerante lata (+10,00).
- Porções: batata frita (15,00), batata com cheddar e bacon (24,00), anéis de cebola (18,00). Milkshake 400 ml (16,00; sabores).

**7. Delícias da Vó:** Salgados avulsos (coxinha, risole, pastel, bolinha de queijo, enroladinho) 5,00 cada; **Cento de salgadinhos** (90,00; escolha até 4 sabores; encomenda com 24h); Bolo no pote (12,00; sabores); Fatia de bolo (8,00); **Cento de brigadeiro** (110,00; encomenda 24h); Torta de frango fatia (9,00).

**8. Padaria Pão Quentinho**
- Pão francês — unidade (0,80) e saco com 10 (7,50); Pão doce (2,50); Bolo de milho fatia (5,00).
- **Café da manhã (só até 10h):** Cuscuz com ovo (10,00), Cuscuz com charque (14,00), Tapioca (8,00 + recheios: queijo coalho, frango, coco com leite condensado, manteiga), Café com leite (4,00), **Kit café da manhã para 2** (32,00).

**9. Açaí Tropical**
- Copo 300 ml (12,00), 500 ml (16,00), 700 ml (20,00). Base: açaí puro, açaí com banana, cupuaçu.
- **Complementos grátis até 4** (depois +1,00 cada): granola, leite em pó, banana, paçoca, amendoim, flocos de arroz, confete, jujuba.
- Adicionais pagos: creme de avelã (+4,00), leite condensado (+2,00), morango (+3,00), kiwi (+3,00), bis (+3,00), creme de ninho (+4,00).
- "Complementos por cima ou em camadas". Barca de açaí 1 L (35,00).

**10. Depósito Gelada Já** (marcas genéricas, sem nomes comerciais reais)
- Cerveja pilsen lata 350 ml (4,50), long neck (7,00), caixa com 12 latas (48,00), Refrigerante 2 L (10,00), Água 500 ml (2,50), Água de coco 1 L (9,00), Energético 250 ml (9,00), Gelo 5 kg (10,00), Carvão 3 kg (18,00).
- Opção "Gelada / Natural". Bebidas alcoólicas com `requires_age_check`.

**11. Mercado Boa Compra** (~60 produtos, com estoque; vários com estoque baixo e 3 com estoque zerado)
- Seções: Hortifrúti (tomate 1 kg, cebola 1 kg, banana prata dúzia, batata 1 kg, alface unidade...), Mercearia (arroz 1 kg, feijão carioca 1 kg, açúcar 1 kg, café 250 g, flocão de milho 500 g, óleo 900 ml, macarrão 500 g, sal 1 kg, farinha de mandioca 1 kg...), Carnes (bandejas: frango 1 kg, carne moída 500 g, linguiça 500 g), Laticínios (leite 1 L, manteiga 200 g, queijo coalho 500 g, iogurte), Padaria, Bebidas não alcoólicas, Limpeza (sabão em pó, detergente, água sanitária, desinfetante), Higiene (sabonete, creme dental, papel higiênico 4 rolos, desodorante).

**12. Farmácia Saúde Mais** (só itens sem receita, com estoque): analgésico dipirona 500 mg 10 comprimidos, paracetamol 750 mg 10 comprimidos, antiácido, soro fisiológico 500 ml, sais de reidratação, curativo, álcool 70%, protetor solar FPS 50, repelente, fralda infantil pacote M e G, absorvente, escova de dentes, fio dental, termômetro digital, preservativo.

**13. Empório Vida Verde:** granola 250 g, castanha de caju 200 g, amendoim torrado 250 g, mix de castanhas 200 g, chá de camomila, chá de erva-doce, mel 300 g, farinha de linhaça 250 g, aveia 500 g, pasta de amendoim 500 g.

**14. Força Total Suplementos:** Whey protein 900 g (149,00; sabores chocolate, baunilha, morango), Creatina 300 g (99,00), Pré-treino 300 g (89,00; sabores), Barra de proteína (9,00; sabores), Coqueteleira (25,00).

### 11.5 Fotos falsas (sem baixar nada da internet)
- Crie o script `npm run seed:images` que **gera imagens ilustrativas localmente** (SVG convertido para WebP com a biblioteca `sharp`):
  - **Produtos:** fundo na cor da categoria com um desenho vetorial simples do tipo de produto (pizza, hambúrguer, copo de açaí, garrafa, sacola de mercado, caixa de remédio, peixe, pão, marmita, sushi, bolo, pote) e o nome do produto. Tamanhos 800×800 e 400×400.
  - **Logos das lojas:** círculo com as iniciais e cor própria de cada loja.
  - **Capas das lojas:** 1200×400 com padrão geométrico e nome da loja.
  - **Banners:** 3 banners (1200×500) de exemplo: "Primeira compra com R$ 10 off", "Sexta da pizza", "Açaí em dobro no domingo".
- As imagens são enviadas para o Storage local (buckets `products`, `stores`, `banners`) durante o seed.
- Alguns produtos ficam **sem foto** de propósito, para testar o visual sem imagem.
- Depois, as lojas trocarão pelas fotos reais pelo painel.

### 11.6 Histórico e situações prontas
- **Cerca de 400 pedidos nos últimos 90 dias**, com distribuição realista: pizza, hambúrguer e açaí à noite e nos fins de semana; quentinha no almoço dos dias úteis; padaria de manhã; mercado espalhado. A maioria `delivered`, com alguns `cancelled`, `rejected`, `refunded`, `partially_refunded` e `expired`.
- Avaliações em cerca de 60% dos pedidos entregues (notas variadas, algumas com resposta da loja, uma ocultada pelo admin).
- Pedidos **ao vivo** para teste: um `awaiting_payment` (Eduarda), um `paid` esperando aceite na Pizzaria (para tocar o alerta), um `preparing` no Brasa Burger, um `out_for_delivery` (Felipe), um agendado para amanhã na Delícias da Vó.
- **Cupons:** `PRIMEIRA` (R$ 10,00 off na primeira compra, mínimo R$ 30,00, plataforma paga), `FRETEGRATIS` (frete grátis acima de R$ 50,00, plataforma paga), `PIZZA10` (10% na Pizzaria Forno de Barro, loja paga, teto R$ 15,00), `VELHO` (expirado), `ESGOTOU` (limite de uso atingido).
- Mensagens de pedido, uma tentativa bloqueada de troca de telefone, um chamado de suporte aberto (Gabriela), faturas pagas, uma em aberto e uma vencida (Pastelaria, suspensa), notificações lidas e não lidas.

---

## 12. Segurança
- Chaves secretas só no servidor; `.env.local` fora do Git.
- RLS em tudo, com testes (seção 10).
- Rate limit em login, envio de código, checkout, cupom, mensagens e abertura de chamado.
- Validação de assinatura e idempotência em todos os webhooks.
- Upload de imagens: só JPG/PNG/WebP, até 5 MB, redimensionar e comprimir no servidor, remover metadados (EXIF).
- Escapar todo texto exibido (avaliações, mensagens, nomes) contra injeção de código.
- Sessões com expiração; logout em todos os aparelhos no perfil.
- Ações sensíveis do admin e do lojista registradas em `audit_logs`.
- Erros técnicos registrados no servidor; o usuário vê só mensagens amigáveis.

---

## 13. Testes (obrigatórios, todos devem passar ao fim de cada etapa)

### 13.1 Unitários (Vitest)
- Cálculo de preço de item com cada modo de grupo (`sum`, `highest`, `average`, `free_up_to`), incluindo **pizza Grande meio a meio** (Calabresa 45,00 + Carne de Sol 56,00 = **56,00** na regra "maior valor" e **50,50** na regra "média"), borda e observação.
- Cálculo do pedido: subtotal, desconto da loja, desconto da plataforma, entrega, taxa de serviço, comissão, valores da loja e da plataforma, arredondamentos em centavos.
- Validação de cupons (todas as regras e mensagens).
- Máquina de estados do pedido (todas as transições válidas e inválidas).
- Horários: loja aberta/fechada, dois turnos, horário que atravessa meia-noite, feriado, pausa.
- Disponibilidade de produto por dia e horário, antecedência mínima, horário limite da quentinha.
- Moderação de mensagens (telefones em vários formatos, links, palavras proibidas, falsos positivos como "R$ 25,90").
- Área de entrega e taxa por bairro.

### 13.2 Integração (contra o banco local)
- Policies de RLS (cada papel só vê o que pode).
- Webhook de pagamento recebido duas vezes não duplica nada.
- Checkout recusa preço adulterado pelo navegador.
- Reembolso parcial gera os lançamentos corretos no `ledger_entries`.
- Estoque baixa na compra e volta no cancelamento.

### 13.3 Ponta a ponta (Playwright, no navegador, com celular simulado)
1. Cliente novo se cadastra, monta **Pizza Grande com 2 sabores** e borda, usa `PRIMEIRA`, paga com Pix (mock aprova) e acompanha.
2. Lojista da pizzaria ouve o alerta, aceita, avança status, atribui entregador; entregador conclui com o código de entrega; cliente avalia.
3. Loja recusa pedido → cliente recebe reembolso e notificação.
4. Pedido sem aceite por 15 minutos (relógio simulado) → recusa automática.
5. Cliente de 17 anos tenta comprar cerveja → bloqueado.
6. Quentinha depois das 11h (relógio simulado) → só permite agendar para amanhã.
7. Cliente da zona rural paga a taxa correta; loja que não atende a comunidade mostra o aviso.
8. Mercado remove item em falta → reembolso parcial.
9. Cliente tenta mandar telefone no chat → mensagem bloqueada.
10. Cliente abre chamado → admin reembolsa parcialmente.
11. Nova loja se cadastra → admin aprova → loja aparece para os clientes.
12. Admin muda comissão → pedidos novos usam a nova taxa e os antigos não mudam.
13. "Pedir de novo" com um item que esgotou → aviso correto.
14. Cliente bloqueado não consegue finalizar pedido.

### 13.4 Roteiro de testes manuais
Crie `docs/ROTEIRO_DE_TESTES.md`: uma lista de verificação em português simples, para eu clicar e conferir cada funcionalidade (cliente, lojista, entregador, admin), com o usuário de teste a usar em cada item e o resultado esperado.

---

## 14. Etapas (uma por vez; ao fim de cada uma: resumo, arquivos alterados, como testar, resultado dos testes, commit, e **pare para eu aprovar**)

0. **Auditoria** (seção 0) e banco local funcionando, sem modo "sem banco".
1. **Banco completo:** todas as migrations da seção 10, RLS com testes, tipos gerados.
2. **Seed completo + imagens falsas + página `/dev`** (login rápido, relógio simulado, caixa de mensagens, pagamentos pendentes).
3. **Autenticação e papéis:** telefone + código, cadastro, termos versionados, papéis globais e da loja, proteção de rotas, cliente bloqueado.
4. **Motor de catálogo:** grupos de opções reutilizáveis, modos de preço, preços por produto, disponibilidade, estoque, montador de pizza com desenho dos sabores. Com todos os testes unitários de preço.
5. **Vitrine do cliente:** boas-vindas, início, busca, categorias, loja, produto, favoritos, páginas públicas de loja com prévia para WhatsApp.
6. **Carrinho e checkout:** carrinho salvo, conflito de lojas, áreas e taxas, agendamento, cupons, indicação, idade, substituição no mercado, recálculo no servidor.
7. **Pagamentos:** mock completo (Pix, cartão, aprovação, recusa, expiração, reembolso total e parcial), split, ledger, webhooks idempotentes.
8. **Painel do lojista — operação:** pedidos em tempo real com alerta sonoro, aceite/recusa, status, impressão térmica, entregador com código de entrega, remoção de item em falta, movimento alto, abrir/fechar/pausar.
9. **Painel do lojista — gestão:** cardápio completo, importação CSV, reajuste em lote, loja, usuários, cupons, avaliações, relatórios, financeiro, faturas, QR Code e cartaz.
10. **Experiência pós-compra:** acompanhamento em tempo real, mensagens moderadas, suporte, avaliações, pedir de novo, notificações (in-app, push, e-mail, simuladas) e preferências.
11. **Admin completo:** todas as telas da seção 7.3.
12. **Tarefas agendadas** (seção 9) e cadastro de novas lojas ("Quero vender no Chegô").
13. **Testes E2E completos**, roteiro de testes manuais, revisão de acessibilidade, desempenho (testar com rede 3G simulada) e segurança.
14. **Integração com o gateway real em modo sandbox** (webhook via túnel), mantendo o mock como padrão local.
15. **Roteiro de produção** (`docs/PRODUCAO.md`): Supabase na nuvem, migrations, SMS real, gateway em produção, Vercel, domínio, agendamento das tarefas, backups. **Não publique nada sem minha autorização.**

## 15. Fora do escopo agora (deixar o banco preparado, sem telas)
App nativo nas lojas da Apple/Google, classificados (veículos e usados), roupas e calçados com tamanhos e cores, serviços com agendamento (ensaios fotográficos), frota de entregadores da própria plataforma, preço por pesagem, cashback e programa de pontos, integração com sistemas de caixa das lojas, pedido com várias lojas no mesmo carrinho.

---

## 16. Regras de trabalho
- Nunca quebre o que já funciona. Rode `npm run test:all`, `lint` e `typecheck` antes de dizer que uma etapa terminou. Etapa com teste falhando **não está pronta**.
- Não invente dados reais (nomes de lojas reais, marcas comerciais, endereços reais).
- Componentes reutilizáveis; nada de código duplicado entre cliente, lojista e admin.
- Comentários e documentação em português; código em inglês.
- Mantenha atualizados: README.md (como rodar do zero no Windows), docs/ARQUITETURA.md, docs/REGRAS_DE_NEGOCIO.md, docs/USUARIOS_DE_TESTE.md, docs/ROTEIRO_DE_TESTES.md.
- Se perceber que algo desta especificação está errado ou pode ser melhor, me avise e explique antes de mudar.
