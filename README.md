# Chegô

Marketplace local (app web + PWA) que reúne as lojas da cidade num só lugar.
"Pediu, Chegô."

Este guia é para rodar o sistema **neste computador (Windows)**, só para testes, sem pagar nada e sem dinheiro de verdade. Não precisa de Docker nem de reiniciar o computador.

## Logins de teste

Abra **http://localhost:3000/dev** e clique em **Entrar como** ao lado de qualquer usuário de teste (admin, lojistas, atendentes, entregadores das lojas e da rede do Chegô, e 10 clientes).

Também dá para entrar em http://localhost:3000/entrar:

- com o **telefone** de qualquer usuário de teste e o código fixo **123456**;
- como admin, em **Entrar com senha**, com usuário `admin` e senha `admin`.

A lista completa, com o que cada usuário serve para testar, está em [docs/USUARIOS_DE_TESTE.md](docs/USUARIOS_DE_TESTE.md). O passo a passo para conferir tudo à mão está em [docs/ROTEIRO_DE_TESTES.md](docs/ROTEIRO_DE_TESTES.md).

## Página de ferramentas de teste (`/dev`)

Só existe no ambiente de testes. Nela você encontra:

- **Relógio simulado:** muda a data e a hora que o sistema enxerga (para testar loja fechada, pedido atrasado, cupom vencido).
- **Login rápido:** entra como qualquer usuário de teste.
- **Pagamentos pendentes:** aprova ou expira o Pix de um pedido. No cartão, número terminado em **0000** aprova e em **1111** recusa.
- **Gerar pedido aleatório:** cria um pedido pago para a loja ter o que aceitar.
- **Rodar tarefas agendadas agora:** faz na hora o que o sistema faz sozinho a cada minuto (cancelar pedido não aceito, expirar Pix, lembretes, faturas).
- **Caixa de mensagens:** mostra os SMS, WhatsApp, e-mails e notificações que o sistema "enviou". Nada sai de verdade.
- **Resetar banco:** volta os dados de teste ao começo.

## 1. O que instalar (uma vez só)

Só o **Node.js**, versão 24 ou mais nova: https://nodejs.org

O banco de dados é um **PostgreSQL de verdade que vem junto com o projeto**. Ele é baixado pelo `npm install` e roda como um programa comum do Windows. Os dados ficam na pasta `.db` dentro do projeto.

## 2. Rodar o projeto

Abra o terminal na pasta do projeto (`C:\Users\kelvy\Desktop\Projetos\chego`).

```powershell
npm install                    # baixa as dependências (só na primeira vez)
copy .env.example .env.local   # cria o arquivo de configuração (só na primeira vez)
npm run db:reset               # liga o banco e cria as tabelas e os dados de teste
npm run dev                    # liga o app
```

Abra http://localhost:3000. No topo deve aparecer a faixa **"Ambiente de testes"**.

Nos outros dias, basta:

```powershell
npm run db:start
npm run dev
```

O banco desliga quando o computador é desligado. Se você abrir o app com o banco desligado, aparece a página **"Banco de dados local desligado"** com o comando para ligar.

## 3. Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `npm run dev` | Liga o app em http://localhost:3000 |
| `npm run db:start` | Liga o banco e aplica as migrations que faltarem |
| `npm run db:stop` | Desliga o banco (os dados ficam guardados) |
| `npm run db:reset` | Apaga tudo e recria o banco com os dados de teste |
| `npm run db:status` | Diz se o banco está ligado |
| `npm run db:types` | Gera de novo os tipos TypeScript do banco (depois de criar uma migration) |
| `npm run seed:images` | Monta de novo as imagens de produtos, lojas, banners e segmentos a partir das fotos guardadas |
| `npm run seed:photos` | Gera por IA as fotos de produto que ainda faltam (precisa de internet; leva cerca de 45 s por foto) |
| `npm test` | Roda os testes unitários e de integração |
| `npm run test:e2e` | Roda os testes no navegador |
| `npm run test:all` | Roda todos os testes |
| `npm run simulate` | Faz um pedido completo em cada loja ativa, no banco que você usa, e mostra uma tabela com o resultado |
| `npm run lint` / `npm run typecheck` | Verifica o código |
| `npm run build` e `npm run start` | Monta e liga a versão otimizada (só para medir desempenho) |
| `npm run icons` | Gera de novo os ícones do app (só se o logo mudar) |

Os testes usam um banco separado (`chego_test`), recriado a cada execução. Eles nunca mexem nos dados que você está testando à mão, e ligam o banco sozinhos se estiver desligado.

Na primeira vez que for rodar os testes de navegador, instale o navegador de teste:

```powershell
npx playwright install chromium
```

## 4. Abrir no celular (opcional)

O celular e o computador precisam estar **no mesmo Wi-Fi**.

1. Descubra o IP do computador. No terminal, rode `ipconfig` e procure **"Endereço IPv4"** no bloco do seu Wi-Fi. É algo como `192.168.0.15`.
2. Com o `npm run dev` rodando, abra no navegador do celular: `http://192.168.0.15:3000` (troque pelo seu IP).

Se não abrir, o Firewall do Windows pode estar bloqueando: Painel de Controle → Firewall do Windows Defender → "Permitir um aplicativo" → marque **Node.js** em "Privada".

## 5. Erros comuns

| Erro | Como resolver |
|---|---|
| Página "Banco de dados local desligado" | Rode `npm run db:start`. |
| Login diz "Usuário ou senha incorretos" com `admin`/`admin` | O banco está sem os dados de teste. Rode `npm run db:reset`. |
| `O banco não ligou` | Abra o arquivo `.db\postgres.log` e veja a última linha. O mais comum é a porta 54329 em uso: reinicie o terminal e tente de novo. |
| `PostgreSQL não encontrado` | Rode `npm install`. |
| `Port 3000 is in use` | Já existe um `npm run dev` aberto em outra janela. Feche a outra. |
| `Missing environment variable ...` | Falta o `.env.local`. Rode `copy .env.example .env.local`. |
| Quero começar do zero | Rode `npm run db:stop`, apague a pasta `.db` e rode `npm run db:reset`. |

## 6. Estrutura de pastas

```
db/
  migrations/          tabelas e regras do banco, numeradas (nunca editar uma já aplicada)
  seed/                dados de teste: lojas, cardápios, pessoas, pedidos e imagens
docs/                  especificação original, arquitetura, regras de negócio, usuários de teste, roteiro de testes e notas para o futuro
storage/               fotos de produtos, lojas, banners e segmentos (geradas pelo seed e pelos envios)
db/seed/photos/        fotos de produto geradas por IA, guardadas no projeto
e2e/                   testes no navegador, em tela de celular (Playwright)
tests/integration/     testes contra o banco (regras de quem vê o quê, pagamentos, estoque, reembolsos)
scripts/
  db.ts                liga, desliga e recria o banco local
src/
  app/                 páginas e rotas (App Router)
    (cliente)          página inicial, busca, loja, carrinho, checkout, pedidos, perfil...
    lojista/           painel da loja: pedidos, cardápio, cupons, relatórios, financeiro
    admin/             painel da plataforma
    dev/               ferramentas de teste
    api/               rotas chamadas pelo navegador e o webhook de pagamento
  components/          peças de tela reutilizáveis (botão, campo, cartão de loja...)
  lib/
    auth/              login, sessão e checagem de papel (sempre no servidor)
    catalog/           regras de preço e de opções dos produtos
    checkout/          cálculo do pedido e criação do pedido
    orders/            estados do pedido e a única função que muda o status
    payments/          gateway simulado, webhook e reembolsos
    notifications/     avisos no app, mensagens simuladas e push
    tasks/             tarefas agendadas
    clock.ts           o relógio do sistema (tudo que precisa da hora usa now())
    db.ts              conexão com o banco e withUser (regras de quem vê o quê)
    format.ts          dinheiro (R$), telefone e datas
  proxy.ts             confere se o banco está ligado
public/
  icons/               ícones do PWA
  sw.js                service worker (página "sem internet" e push)
```

## 7. Convenções

- Código, tabelas e variáveis em inglês; interface, comentários e documentação em português do Brasil.
- Como o sistema é montado: [docs/ARQUITETURA.md](docs/ARQUITETURA.md). O que ele faz e por quê: [docs/REGRAS_DE_NEGOCIO.md](docs/REGRAS_DE_NEGOCIO.md).
- Dinheiro sempre em **centavos inteiros** (`1234` = R$ 12,34). Use `formatCents` para mostrar.
- Cores e fontes da marca são tokens do Tailwind (`bg-brand`, `text-coffee`, `font-display`), definidos em `src/app/globals.css`.
- Botões com texto branco usam o laranja escuro (`brand-dark`), porque o branco sobre o laranja principal não atinge o contraste mínimo de 4,5:1.
- Fuso horário: `America/Maceio`.

## 8. Qualidade

- **Testes automáticos:** regras de preço, cupons, horários e estados do pedido (unitários); regras de acesso, webhook de pagamento, preço adulterado, taxa por bairro, estoque e reembolso direto no banco (integração); e os caminhos principais no navegador em tela de celular.
- **Acessibilidade:** as telas são conferidas automaticamente (contraste, nomes dos botões, rótulos dos campos), nada pode passar da largura do celular, toda área de toque tem pelo menos 44 px e o painel do lojista funciona só com o teclado.
- **Segurança:** o cookie de sessão não é lido por scripts, cada tabela tem regras de quem pode ver o quê, o webhook de pagamento só aceita avisos assinados e não processa o mesmo aviso duas vezes.

- **Desempenho em 3G simulado:** medido em 10/10/2026 no build de produção (`npm run build` e `npm run start`), em tela de celular, com rede "3G rápido" (1,6 Mbps, 150 ms de latência), processador 4x mais lento e sem nada em cache.

  | Página | Conteúdo principal na tela | Tudo carregado | Peso total |
  |---|---|---|---|
  | Início | 1,2 s | 2,2 s | 411 KB |
  | Loja com 60 produtos | 0,9 s | 1,7 s | 302 KB |
  | Produto (pizza) | 1,1 s | 1,5 s | 257 KB |
  | Busca | 0,7 s | 1,7 s | 284 KB |
  | Entrar | 0,6 s | 1,4 s | 243 KB |

  Cerca de 160 KB de cada página são o JavaScript do app, que fica guardado no aparelho depois da primeira visita. As fotos são WebP, em dois tamanhos, e só carregam quando chegam perto da tela. A medição foi feita neste computador, com as imagens desenhadas do seed; fotos de verdade pesam mais, e não foi medido em um celular real.

## 9. Diferenças em relação à especificação

- A especificação pedia Supabase local com Docker. Como o Docker exige ligar a virtualização na BIOS (e reiniciar), o projeto usa **PostgreSQL direto no Windows**. Por isso, login, armazenamento de fotos e atualização das telas são feitos dentro do próprio app, e não pelo Supabase. As telas se atualizam sozinhas consultando o servidor a cada poucos segundos.
- O único gateway de pagamento é o **simulado**. A integração com um gateway real (Etapa 14) e a publicação (Etapa 15) não foram feitas: o sistema roda só neste computador. O que falta para ir ao ar está em [docs/PRODUCAO.md](docs/PRODUCAO.md).
- A especificação deixava a frota de entregadores da plataforma para o futuro. A pedido, ela foi feita: a loja escolhe entre o próprio entregador e a rede do Chegô (entregadores da plataforma e parceiros). Veja [docs/REGRAS_DE_NEGOCIO.md](docs/REGRAS_DE_NEGOCIO.md).
- A especificação pedia imagens de teste desenhadas, sem baixar nada. A pedido, os produtos usam **fotos geradas por IA** (serviço gratuito Pollinations), guardadas em `db/seed/photos/`. Elas levam a marca "pollinations.ai" no canto, que o serviço só tira para quem tem cadastro. Logos, banners e produtos sem foto gerada continuam desenhados.
- As fotos aceitam qualquer formato de imagem até 15 MB (a especificação pedia só JPG, PNG e WebP até 5 MB), sempre regravadas em tamanho pequeno.
- A ordem dos produtos e categorias do cardápio é mudada por setas (subir e descer), e não arrastando.
- O botão "usar minha localização" não existe: o cliente escolhe o bairro na lista.
