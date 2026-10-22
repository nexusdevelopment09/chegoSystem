# Super admin

O painel do admin (`/admin`) virou a central de comando da plataforma. Todos os números saem dos registros reais do banco. O que ainda não existe aparece como "sem dados" ou "—", nunca inventado.

## Quem pode o quê

| Papel | Pode |
|---|---|
| **Super admin** (`profiles.is_super_admin`) | Tudo, inclusive as ações globais críticas: ativar, desativar, suspender, reativar e excluir contas de loja; criar, pausar e encerrar anúncios; ocultar e restaurar avaliações; analisar denúncias; corrigir nota por erro técnico; tornar ou tirar super admin. |
| **Admin comum** | Vê todo o painel e continua com o dia a dia que já existia (aprovar loja, suporte, reembolso, clientes, entregadores, cadastros). Não faz as ações globais críticas. |

- As ações críticas conferem o super admin **no servidor** (`requireSuperAdmin`), não só escondendo botões. Uma tentativa sem permissão fica na auditoria como "negada" e a pessoa volta ao painel com um aviso.
- Quem já era admin virou super admin na migration, para ninguém perder acesso.
- O seed de demonstração tem um admin comum: **Suporte Chegô**, telefone (82) 90000-0009, senha `admin`.
- Super admin se gerencia em **Configurações → Administradores**. Ninguém altera o próprio acesso, e sempre sobra pelo menos um super admin. Criar admins continua fora do app.

## Menu

1. **Painel**:
   - lojas e empresas (ativas, inativas, suspensas, pendentes, excluídas, novas, que encerraram a conta);
   - pedidos (realizados, concluídos, cancelados, em andamento, aguardando pagamento);
   - vendas e receita da plataforma (taxas por pedido, comissões, anúncios);
   - motoboys;
   - gráficos de pedidos e de vendas.
2. **Lojas**: busca por nome, identificador, responsável ou documento; filtros de situação e de data de cadastro; ordenação; paginação. Colunas: empresa, cadastro, situação, pedidos, vendas, nota, anúncios e ocorrências. Na página da loja fica **Situação da conta**, com as ações e o histórico.
3. **Empresas**: cada empresa é o responsável (dono) com o documento das lojas dele, com as lojas, pedidos e vendas.
4. **Pedidos**: indicadores clicáveis, pedidos ao longo do tempo, horários de movimento, lojas com mais pedidos e o histórico completo. Filtros por loja, empresa, motoboy, situação, período e busca (código ou cliente; sem período escolhido, a busca vale para qualquer data).
5. **Vendas e faturamento**: total e por loja, com bruto, descontos, vendas, ticket, reembolsos, cancelados, líquido da loja, taxas e comissões do Chegô e o que a loja pagou. Também ranking, evolução e comparação com o período anterior.
6. **Motoboys**: rede do Chegô e entregadores das lojas; ativos, inativos, com o app aberto, disponíveis e em entrega; entregas concluídas e canceladas, tempo médio, quem mais entregou e atividade recente.
7. **Anúncios e impulsionamentos**: campanhas com loja, lugar, prioridade, início e fim, valor cobrado, impressões, cliques, pedidos atribuídos e vendas.
8. **Avaliações**: nota média, distribuição de 1 a 5 estrelas, notas por loja, filtros (loja, nota, data, situação), denúncias, suspeitas e o histórico de cada avaliação.
9. **Contas suspensas**: suspensas agora, agendadas e o histórico.
10. **Empresas excluídas**: encerradas pela empresa ou excluídas pelo Chegô, com motivo e taxas ainda a receber.
11. **Relatórios**: lojas cadastradas e encerradas, suspensões, reativações, desativações, crescimento líquido, retenção, motivos de encerramento e o histórico de mudanças de situação.
12. **Auditoria**: filtros por quem, área, ação, conta ou registro, resultado e período. Cada evento mostra os detalhes de antes e depois; segredos aparecem como `••••`.
13. **Configurações**.

As áreas que já existiam (Ao vivo, Clientes, Cadastro de entregadores, Suporte, Moderação, Taxas, Financeiro, Simulador, Marketing, Cadastros) continuam em **Mais**.

## Períodos

- Opções: Hoje, Ontem, Esta semana (começa na segunda), Semana passada, Este mês, Mês passado, Este ano, Ano passado e intervalo personalizado. Tudo no horário de Maceió.
- A variação compara com o período anterior equivalente. Um período em andamento compara com o mesmo trecho do anterior: hoje até agora contra ontem até a mesma hora.
- Sem base no período anterior, a variação diz isso, sem inventar um percentual.
- Links antigos (`periodo=7|30|90`, `dia=`) continuam funcionando.

## Definições dos números

- **Pedido realizado**: criado no período, em qualquer situação.
- **Vendido**: pago e não recusado, cancelado, expirado nem reembolsado por inteiro, pela data do pagamento.
- **Vendas**: o que foi pago, menos reembolsos.
- **Faturamento bruto**: produtos mais entrega, antes dos descontos.
- **Receita da plataforma**: taxas por pedido (lançamentos de taxa, R$ 0,50) + comissões (pedidos pagos pelo app) + valor das campanhas de anúncio criadas no período.
- **Líquido da loja**: vendas − taxas e comissões do Chegô.
- **Pago ao Chegô**: cobranças de taxa pagas no período. Pode diferir das taxas geradas, porque a loja paga no fechamento do expediente.
- **Motoboy com o app aberto**: visto nos últimos 5 minutos (conexão).
- **Motoboy disponível**: marcou disponibilidade no app.
- **Motoboy em entrega**: tem pedido saindo para entrega.
- As três situações dos motoboys são contadas separadamente.

## Situação da conta das lojas

- **Desativar**: a loja fica pausada, sem suspensão. Exige motivo.
- **Suspender**:
  - campos: motivo, descrição, início (agora ou agendado), fim ou tempo indeterminado, e se avisa a empresa;
  - efeito: a loja some da vitrine e não recebe pedidos novos; os pedidos em andamento continuam;
  - início agendado e fim do prazo são aplicados pelas tarefas automáticas.
- **Reativar**: encerra a suspensão e devolve a loja à situação de antes. Exige motivo.
- **Excluir** (exclusão lógica):
  - exige motivo e o nome exato da loja como confirmação;
  - recusada com pedido em andamento ou conta de mesa aberta;
  - a loja sai do ar e do painel do lojista para sempre; os funcionários são desconectados e os anúncios encerrados;
  - **pedidos, taxas e lançamentos ficam guardados**.
- **A empresa encerra a própria loja** em **Minha loja → Encerrar a loja no Chegô**: só o dono, com motivo e o nome da loja como confirmação. Conta como "empresa que excluiu a conta".
- Tudo vai para o histórico da loja (`store_status_events`) e para a auditoria.

## Anúncios

- **Lugares**:
  - destaque na página inicial;
  - primeiras posições de "Abertas agora";
  - destaque dentro de uma categoria (só a categoria da loja);
  - campanha promocional.
- **Selo e nota**: toda loja anunciada aparece com o selo **Patrocinado**. O anúncio muda só a posição; nota e avaliações continuam as reais.
- **Quando aparece**:
  - só campanhas ativas, dentro do horário, de loja ativa e não excluída;
  - maior prioridade primeiro;
  - a vitrine confere o horário a cada página, e as tarefas automáticas marcam as vencidas como encerradas.
- **Medição**:
  - impressões e cliques são contadores por dia, sem guardar quem viu;
  - o clique passa por `/anuncio/<campanha>`; cliques repetidos do mesmo endereço não contam de novo;
  - um pedido na mesma loja até 24 horas depois do clique fica atribuído à campanha (`orders.ad_campaign_id`).
- O valor cobrado é registrado na campanha; a cobrança em si é feita fora do app.
- Os destaques pagos que já existiam (`featured_until`) viraram campanhas na migration e continuam valendo.

## Avaliações

- A nota da loja é sempre a média das avaliações visíveis dos últimos 180 dias, calculada automaticamente. **Não existe ação para mudar a nota de uma loja.**
- O super admin pode:
  - ocultar o que viola as regras e restaurar o que foi ocultado por engano;
  - analisar denúncias da loja (manter ou ocultar);
  - corrigir a nota de uma avaliação por erro técnico comprovado, com motivo e confirmação.
- Cada ação guarda o valor anterior e o novo, o responsável, a data e o motivo (`review_events`), e vai para a auditoria.
- **Suspeitas** só sinalizam, nunca ocultam sozinhas. São suspeitas avaliações:
  - com link ou telefone no texto;
  - do mesmo cliente que avaliou a mesma loja 3 ou mais vezes em 30 dias;
  - de um cliente que fez 5 ou mais avaliações em 24 horas.

## Banco de dados (migration `0021_super_admin.sql`)

- `profiles.is_super_admin`.
- `stores.closed_at`, `closed_reason`, `closed_by_kind` (`empresa` ou `admin`) e `closed_by`, para a exclusão lógica.
- `store_suspensions`: motivo, descrição, início, fim, aviso à empresa, situação anterior, aplicação e reativação.
- `store_status_events`: o histórico de situação de cada loja.
- `ad_campaigns` e `ad_daily_stats`, mais `orders.ad_campaign_id`.
- `reviews.report_reason`, `report_resolved_at` e `report_resolved_by`, mais `review_events`.
- `couriers.last_seen_at`.

As tabelas novas só são lidas pelo navegador com as regras de acesso por linha (RLS). As gravações passam pelo servidor, depois de conferida a permissão.

## Testes

- Unidade: `src/lib/admin/range.test.ts` (períodos e variação).
- Integração:
  - `tests/integration/store-account.test.ts`: suspender, agendar, reativar, excluir;
  - `tests/integration/super-admin.test.ts`: números do painel contra o banco, campanhas no ar, atribuição de pedido.
- Ponta a ponta:
  - `e2e/super-admin.spec.ts`: painel, menu, suspensão, exclusão, anúncio, correção de nota, admin comum, empresa encerrando a loja;
  - `e2e/admin.spec.ts` atualizado.

## Dependências e limitações

- **Cobrança de anúncios**: o valor é registrado, mas a cobrança é feita fora do app (não há provedor de pagamento para isso).
- **"Com o app aberto"**: vem do último acesso do entregador ao app (atualizado no máximo uma vez por minuto). Não há rastreio em tempo real.
- **Empresa**: não existe um cadastro de empresa separado. Ela é o responsável e o documento informado no cadastro da loja.
- **Atualização dos números**: os gráficos e indicadores se atualizam ao abrir ou trocar o filtro (sem atualização automática na tela).
- **Visão da lista de pedidos**: a lista usa a data de criação do pedido, e a tela de vendas usa a data do pagamento. Um pedido criado perto do fim do período e pago no período seguinte aparece em períodos diferentes nas duas telas.
