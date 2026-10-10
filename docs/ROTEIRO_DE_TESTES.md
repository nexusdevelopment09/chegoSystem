# Roteiro de testes manuais

Use este roteiro para conferir o Chegô à mão, no navegador. Marque cada item com um `x` quando o resultado for o esperado.

## Antes de começar

1. No terminal, na pasta do projeto, rode `npm run db:reset` (recria os dados de teste) e depois `npm run dev`.
2. Abra **http://localhost:3000/dev**. Deixe esta página aberta numa aba: ela é a sua "caixa de ferramentas".
3. Para trocar de usuário, volte ao `/dev` e clique em **Entrar como** ao lado do nome.
4. Para testar como no celular, aperte `F12` no navegador e clique no ícone de celular (ou abra pelo celular, veja o README).

Nada aqui usa dinheiro de verdade nem envia mensagem de verdade. Os "SMS", "WhatsApp" e "e-mails" aparecem na **Caixa de mensagens** do `/dev`.

**Pagamentos de teste**

| Forma | Como aprovar | Como recusar |
|---|---|---|
| Pix | No `/dev`, em pagamentos pendentes, clique em **Simular pagamento aprovado** | Clique em **Simular expiração** |
| Cartão | Use um número de cartão terminado em **0000** | Use um número terminado em **1111** |

**Relógio:** muitas lojas só abrem em certos horários. Se a loja aparecer fechada, mude a hora no relógio simulado do `/dev` (por exemplo, sexta às 20h) e, ao terminar, clique em **Voltar ao horário real**.

---

## 1. Visitante (sem entrar)

| ✔ | O que fazer | Resultado esperado |
|---|---|---|
| [ ] | Abra http://localhost:3000 numa janela anônima | Aparece a tela de boas-vindas pedindo o bairro |
| [ ] | Escolha o bairro **Centro** e clique em **Ver as lojas** | Aparece a página inicial com "Abertas agora" e as lojas fechadas no fim, em cinza |
| [ ] | Procure por `pizza` na busca | Aparecem lojas e produtos com pizza |
| [ ] | Procure por `xyzabc` | Aparece "Oxe, não achamos nada…" |
| [ ] | Abra a **Pizzaria Forno de Barro** | Aparecem cardápio, horários, taxa de entrega e avaliações |
| [ ] | Troque o bairro para **Sítio Mata Verde** | Lojas que não entregam lá avisam que não atendem esse bairro |
| [ ] | Coloque um produto na sacola e clique em **Continuar** | O app pede para entrar antes de fechar o pedido |
| [ ] | Abra `/lojista` e `/admin` | Você é mandado para a tela de entrar |

## 2. Cadastro e login

| ✔ | O que fazer | Resultado esperado |
|---|---|---|
| [ ] | Em `/entrar`, digite um telefone novo, por exemplo `(82) 95555-0001`, e clique em **Receber código** | Pede o código. No `/dev`, a Caixa de mensagens mostra o SMS |
| [ ] | Digite o código `123456` | Vai para o cadastro (nome, data de nascimento) |
| [ ] | Preencha e clique em **Criar minha conta** | Aparecem os termos; depois de **Aceitar e continuar**, você entra |
| [ ] | Digite um código errado mais de 10 vezes | O app bloqueia novas tentativas por 10 minutos |
| [ ] | Em `/entrar`, clique em **Entrar com senha** e use `admin` / `admin` | Entra no painel do admin |

## 3. Cliente: fazer um pedido

Entre como **Ana Clara Souza**. Deixe o relógio em uma sexta às 20h.

| ✔ | O que fazer | Resultado esperado |
|---|---|---|
| [ ] | Na Pizzaria Forno de Barro, abra **Pizza Grande (8 fatias)** e escolha dois sabores | O preço muda conforme a regra da loja e o desenho da pizza mostra as metades |
| [ ] | Tente adicionar sem escolher o que é obrigatório | O botão não deixa e mostra o que falta |
| [ ] | Adicione à sacola e abra a sacola | Itens, subtotal, taxa de entrega, taxa de serviço e total batem |
| [ ] | Digite o cupom `VELHO` e clique em **Aplicar** | "Cupom expirado" |
| [ ] | Digite o cupom `PIZZA10` | Desconto de 10%, no máximo R$ 15,00 |
| [ ] | Com a sacola de uma loja, tente adicionar produto de outra loja | O app avisa que a sacola é de outra loja e oferece **Esvaziar e adicionar** |
| [ ] | Clique em **Continuar**, escolha o endereço e **Pix**, e clique em **Fazer pedido** | Aparece o QR Code do Pix com o tempo para pagar. O pedido ainda **não** aparece para a loja |
| [ ] | No `/dev`, clique em **Simular pagamento aprovado** | A tela do pedido muda sozinha para "pago, aguardando a loja" |
| [ ] | Faça outro pedido com cartão terminado em **1111** | "Pagamento recusado", e dá para tentar de novo |
| [ ] | Faça outro pedido com cartão terminado em **0000** | Pedido pago na hora |
| [ ] | Faça um pedido com Pix e, no `/dev`, clique em **Simular expiração** | O pedido é cancelado e o estoque e o cupom voltam |

**Situações especiais**

| ✔ | Usuário | O que fazer | Resultado esperado |
|---|---|---|---|
| [ ] | Diego Alves | Pedido acima de R$ 30,00 com cupom `PRIMEIRA` | R$ 10,00 de desconto |
| [ ] | Ana Clara Souza | Cupom `PRIMEIRA` | Recusa: só vale na primeira compra |
| [ ] | Henrique Costa | Tente fechar um pedido | Recusa: conta bloqueada |
| [ ] | Isabela Ferreira | No Depósito Gelada Já, tente comprar cerveja | Recusa: menor de 18 anos |
| [ ] | Carla Mendes | Peça numa loja que não atende a zona rural | Avisa que a loja não entrega no bairro dela |
| [ ] | Qualquer cliente | Na Delícias da Vó, peça uma encomenda | Só deixa agendar com pelo menos 24 horas |
| [ ] | Qualquer cliente | Mude o relógio para 3h da manhã e tente pedir | Loja fechada: não deixa pedir |

## 4. Cliente: depois da compra

| ✔ | O que fazer | Resultado esperado |
|---|---|---|
| [ ] | Em **Pedidos**, abra um pedido em andamento | Linha do tempo com cada etapa e o horário |
| [ ] | Mande uma mensagem para a loja no pedido | A mensagem aparece para a loja. Telefones e links são escondidos |
| [ ] | Cancele um pedido que a loja ainda não aceitou (**Cancelar pedido**) | Cancelado, com reembolso total |
| [ ] | Num pedido entregue, envie uma avaliação (**Enviar avaliação**) | A nota aparece na página da loja |
| [ ] | Num pedido entregue, clique em **Pedir de novo** | A sacola é montada com os mesmos itens, com os preços de hoje |
| [ ] | Num pedido, clique em **Preciso de ajuda** e depois **Abrir chamado** | O chamado aparece para o admin em Suporte |
| [ ] | Favorite uma loja e abra **Favoritos** | A loja aparece na lista |
| [ ] | Abra o sino no topo | Aparecem os avisos do pedido; **Marcar todas como lidas** zera o contador |
| [ ] | Em **Perfil**, mude o nome, adicione e remova um endereço | Salva e aparece no checkout |
| [ ] | Em **Perfil**, clique em **Baixar meus dados** | Baixa um arquivo com tudo o que o app sabe sobre você |
| [ ] | Crie uma conta nova só para isso e clique em **Excluir minha conta para sempre** | A conta some; os pedidos antigos ficam sem os dados pessoais |

## 5. Lojista (dono)

Entre como **Marcos Antônio Tavares** (Pizzaria Forno de Barro). Antes, faça um pedido pago como cliente, ou clique em **Gerar pedido aleatório** no `/dev`.

| ✔ | O que fazer | Resultado esperado |
|---|---|---|
| [ ] | Abra **Pedidos** | O pedido pago aparece com alerta e contagem regressiva para aceitar |
| [ ] | Clique em **Aceitar** | O cliente recebe o aviso; o pedido vai para a próxima coluna |
| [ ] | **Começar o preparo** → **Marcar como pronto** → **Saiu para entrega** | Cada passo aparece na linha do tempo do cliente |
| [ ] | Em outro pedido, clique em **Recusar**, escolha o motivo e **Confirmar recusa e reembolsar** | Pedido recusado e reembolso total para o cliente |
| [ ] | Deixe um pedido pago sem aceitar e, no `/dev`, adiante o relógio e clique em **Rodar tarefas agendadas agora** | O pedido é cancelado sozinho, com reembolso |
| [ ] | Clique em **Fechar agora** | A loja aparece fechada para os clientes. **Seguir os horários** volta ao normal |
| [ ] | Clique em **+30 min** | O tempo de entrega mostrado ao cliente aumenta |
| [ ] | Em **Cardápio**, marque um produto como esgotado | O cliente vê "esgotado" e não consegue pedir |
| [ ] | Crie um produto novo com foto (**Novo produto** → **Criar produto**) | Aparece no cardápio da loja |
| [ ] | Em **Cardápio → Grupos**, crie um grupo de opções e ligue a um produto | As opções aparecem na página do produto |
| [ ] | Em **Cardápio → Planilha**, baixe a planilha, mude um preço e importe | O preço muda; linhas com erro são apontadas sem estragar o resto |
| [ ] | Em **Minha loja**, mude horários e áreas de entrega | A página da loja mostra os novos horários e taxas |
| [ ] | Em **Minha loja**, convide uma pessoa para a equipe | A pessoa entra na equipe e passa a entrar no app com o telefone dela e o código `123456` |
| [ ] | Em **Cupons**, crie um cupom | Dá para usar na sacola, só nesta loja |
| [ ] | Em **Avaliações**, responda uma avaliação | A resposta aparece na página da loja |
| [ ] | Em **Relatórios**, veja os mais vendidos e baixe o CSV | Os números batem com os pedidos |
| [ ] | Em **Financeiro**, abra o extrato | Cada pedido mostra venda, comissão, taxa e o que a loja recebe |
| [ ] | Em **Divulgação**, baixe o QR Code e o cartaz | Baixa a imagem e o PDF com o endereço da loja |

## 6. Atendente e entregador

| ✔ | Usuário | O que fazer | Resultado esperado |
|---|---|---|---|
| [ ] | Juliana Peixoto (atendente) | Abra **Pedidos** e **Cardápio** | Funcionam normalmente |
| [ ] | Juliana Peixoto | Abra `/lojista/financeiro` e `/lojista/cupons` | Não tem acesso |
| [ ] | Robson Entregas (entregador) | Entre no app | Vê só **Minhas entregas**, com endereço e **Abrir no mapa** |
| [ ] | Robson Entregas | Num pedido que saiu para entrega, clique em **Entreguei** | O pedido fica como entregue para o cliente e a loja |
| [ ] | Robson Entregas | Abra `/lojista/cardapio` | Não tem acesso |

## 7. Admin

Entre como **Admin Chegô**.

| ✔ | O que fazer | Resultado esperado |
|---|---|---|
| [ ] | Abra o **Painel** | Vendas por dia, pedidos, lojas ativas e o aviso de loja esperando aprovação |
| [ ] | Em **Ao vivo**, veja os alertas | Pedidos atrasados e esperando aceite aparecem em destaque |
| [ ] | Em **Lojas**, abra **Espetinho do Zé** e clique em **Aprovar e colocar no ar** | A loja passa a aparecer para os clientes |
| [ ] | Numa loja, mude a comissão e clique em **Salvar condições** | Os próximos pedidos usam a nova comissão; os antigos não mudam |
| [ ] | Numa loja, clique em **Ver como esta loja** | Você vê o painel do lojista. Fica registrado na Auditoria |
| [ ] | Em **Pedidos**, abra um pedido pago e clique em **Reembolsar** | Reembolso feito; a divisão entre loja e plataforma é desfeita |
| [ ] | Em **Clientes**, clique em **Bloquear** num cliente | Ele não consegue mais pedir. **Desbloquear** desfaz |
| [ ] | Em **Suporte**, responda o chamado da Gabriela Nunes | A cliente recebe a resposta |
| [ ] | Em **Moderação**, clique em **Ocultar avaliação** | A avaliação some da página da loja e a nota é recalculada |
| [ ] | Em **Financeiro**, confira a conciliação | "Tudo confere" e dá para baixar o relatório do contador (CSV) |
| [ ] | Em **Marketing**, publique um banner e crie um cupom | O banner aparece na página inicial; o cupom funciona na sacola |
| [ ] | Em **Cadastros**, desative um bairro | Ele some da lista de bairros dos clientes |
| [ ] | Em **Cadastros**, ligue a manutenção de Joaquim Gomes | Os clientes veem o aviso e não conseguem pedir |
| [ ] | Em **Configurações**, publique uma nova versão dos termos | Todo mundo precisa aceitar de novo ao entrar |
| [ ] | Em **Auditoria** | Tudo o que você fez acima aparece na lista, com data e hora |

## 8. Quem vê o quê (segurança)

| ✔ | O que fazer | Resultado esperado |
|---|---|---|
| [ ] | Como Ana, copie o endereço de um pedido (`/pedidos/...`). Entre como Bruno e cole | "Oxe, essa página não existe." |
| [ ] | Como Marcos (pizzaria), tente abrir um pedido de outra loja | Não aparece |
| [ ] | Como cliente, abra `/admin` e `/lojista` | Você é mandado de volta para a sua área |
| [ ] | Sem entrar, abra `/lojista/relatorios/exportar` | Vai para a tela de entrar |

## 9. Celular, instalação e sem internet

| ✔ | O que fazer | Resultado esperado |
|---|---|---|
| [ ] | Abra o app no celular (veja o README) ou no modo celular do navegador | Nada passa da largura da tela; os botões são fáceis de tocar |
| [ ] | No Chrome, toque em **Instalar o app** (ou "Adicionar à tela inicial") | O Chegô abre como um aplicativo, com o ícone da marca |
| [ ] | Com o app aberto, desligue o Wi-Fi e tente abrir outra página | Aparece a página "sem internet" do Chegô |
| [ ] | Em **Perfil**, clique em **Ligar notificações neste aparelho** | Ao mudar o status de um pedido, chega uma notificação no aparelho |
| [ ] | Navegue no painel do lojista só com a tecla `Tab` | Dá para ver onde está o foco e acionar tudo com `Enter` |

## 10. Banco desligado

| ✔ | O que fazer | Resultado esperado |
|---|---|---|
| [ ] | Rode `npm run db:stop` e recarregue o app | Página "Banco de dados local desligado" com o comando para ligar |
| [ ] | Rode `npm run db:start` e recarregue | O app volta ao normal, com os dados que estavam lá |

---

Achou algo diferente do esperado? Anote o usuário, a página, o que você fez e o que apareceu. Com essas quatro informações dá para reproduzir e corrigir.
