# Chegô

Marketplace local (app web + PWA) que reúne as lojas da cidade num só lugar.
"Pediu, Chegô."

Este guia é para rodar o sistema **neste computador (Windows)**, só para testes, sem pagar nada e sem dinheiro de verdade. Não precisa de Docker nem de reiniciar o computador.

## Logins de teste

Abra **http://localhost:3000/dev** e clique em **Entrar como** ao lado de qualquer usuário de teste (admin, lojistas, atendentes, entregador e 10 clientes). A lista completa, com o que cada um serve para testar, está em [docs/USUARIOS_DE_TESTE.md](docs/USUARIOS_DE_TESTE.md).

O admin também entra em http://localhost:3000/entrar com usuário `admin` e senha `admin`.

## Página de ferramentas de teste (`/dev`)

Só existe no ambiente de testes. Nela você encontra:

- **Relógio simulado:** muda a data e a hora que o sistema enxerga.
- **Login rápido:** entra como qualquer usuário de teste.
- **Pagamentos pendentes:** aprova, recusa ou expira o pagamento de um pedido.
- **Caixa de mensagens:** mostra os SMS, WhatsApp, e-mails e notificações que o sistema "enviou". Nada sai de verdade.

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
| `npm run seed:images` | Gera de novo as fotos falsas de produtos, lojas e banners |
| `npm test` | Roda os testes unitários e de integração |
| `npm run test:e2e` | Roda os testes no navegador |
| `npm run test:all` | Roda todos os testes |
| `npm run lint` / `npm run typecheck` | Verifica o código |
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
docs/                  usuários de teste e outros guias
storage/               fotos de produtos, lojas e banners (geradas pelo seed)
e2e/                   testes no navegador (Playwright)
tests/integration/     testes contra o banco (regras de quem vê o quê)
scripts/
  db.ts                liga, desliga e recria o banco local
src/
  app/                 páginas e rotas (App Router)
    entrar/            login
    admin/             painel do admin
    banco-desligado/   aviso quando o banco está desligado
  components/
    brand/             <LogoIcon /> e <Logo />
    layout/            faixa "Ambiente de testes", registro do service worker
    ui/                componentes reutilizáveis (botão...)
  lib/
    auth/              senha, sessão e checagem de papel (sempre no servidor)
    db.ts              conexão com o banco
    env.ts             leitura das variáveis de ambiente
    format.ts          dinheiro (R$) e telefone
  proxy.ts             confere se o banco está ligado
public/
  icons/               ícones do PWA
  sw.js                service worker
```

## 7. Convenções

- Código, tabelas e variáveis em inglês; textos da interface em português do Brasil.
- Dinheiro sempre em **centavos inteiros** (`1234` = R$ 12,34). Use `formatCents` para mostrar.
- Cores e fontes da marca são tokens do Tailwind (`bg-brand`, `text-coffee`, `font-display`), definidos em `src/app/globals.css`.
- Botões com texto branco usam o laranja escuro (`brand-dark`), porque o branco sobre o laranja principal não atinge o contraste mínimo de 4,5:1.
- Fuso horário: `America/Maceio`.

## 8. Diferenças em relação à especificação

A especificação pedia Supabase local com Docker. Como o Docker exige ligar a virtualização na BIOS (e reiniciar), o projeto usa **PostgreSQL direto no Windows**. Por isso, login, armazenamento de fotos e tempo real são feitos dentro do próprio app, e não pelo Supabase. Tabelas, regras de negócio e testes seguem a especificação.
