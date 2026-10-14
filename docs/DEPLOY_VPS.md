# Subir o Chegô na VPS (Docker + PostgreSQL)

Este guia coloca o Chegô numa VPS (Ubuntu ou Debian), no seu domínio, com HTTPS e **aberto ao público**, para testes com lojas, entregadores e clientes reais:

- **Sem nenhum dado fictício.** O banco começa só com a cidade (Joaquim Gomes, bairro Centro), as categorias, os planos, os termos provisórios e o seu usuário de admin.
- **Login por telefone e senha.** Cliente cria a conta em "Criar minha conta"; lojista em "Quero vender no Chegô"; entregador em "Quero entregar". Não existe página `/dev` nem código fixo.
- **Pagamento ainda simulado.** Nenhum dinheiro é cobrado pelo app: na tela de pagamento o cliente toca em **Simular pagamento aprovado** e o pedido segue para a loja.

O que falta para cobrar de verdade está em [PRODUCAO.md](PRODUCAO.md).

Não precisa de GitHub: o projeto vai do seu computador para a VPS pelo `npm run deploy:vps`. Também dá para clonar do repositório (seção 6).

## Como fica no servidor

```
Internet ──► Caddy (portas 80 e 443, HTTPS automático)
                │
                ▼
             app (Next.js, porta 3000, só dentro do Docker)
                │
                ▼
             db (PostgreSQL 18, só dentro do Docker)
```

| Contêiner | O que guarda | Volume |
|---|---|---|
| `db` | o banco | `pgdata` |
| `app` | as fotos enviadas pelas lojas | `storage` |
| `caddy` | os certificados HTTPS | `caddy_data` |

Os volumes não são apagados quando você envia uma versão nova.

## 1. Preparar a VPS (uma vez só)

1. **Domínio:** no painel do domínio, crie um registro **A** apontando o domínio (ex.: `chego.seudominio.com.br`) para o IP da VPS. Espere propagar (`ping chego.seudominio.com.br` deve responder com o IP da VPS).
2. **Entrar na VPS** pelo PowerShell do seu computador:
   ```powershell
   ssh root@IP-DA-VPS
   ```
3. **Instalar o Docker** (já vem com o `docker compose`):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
4. **Liberar as portas** (se o firewall `ufw` estiver ligado; confira também o firewall do painel da hospedagem):
   ```bash
   ufw allow OpenSSH && ufw allow 80 && ufw allow 443
   ```
5. **Criar a pasta e o `.env`:**
   ```bash
   mkdir -p /opt/chego && cd /opt/chego
   nano .env
   ```
   Cole o conteúdo de [`.env.vps.example`](../.env.vps.example) e preencha:
   - `DOMAIN`: o seu domínio.
   - `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`: a sua conta de admin (senha com pelo menos 10 caracteres). Ela é criada na primeira vez que o banco sobe.
   - `POSTGRES_PASSWORD`, `PAYMENT_WEBHOOK_SECRET` e `CRON_SECRET`: gere cada um com `openssl rand -hex 32`.

   Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

> Dica: para não digitar a senha da VPS a cada envio, crie uma chave SSH no seu computador (`ssh-keygen`) e copie a chave pública para a VPS (`type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@IP-DA-VPS "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"`).

## 2. Enviar e ligar

No seu computador, na pasta do projeto:

```powershell
npm run deploy:vps -- root@IP-DA-VPS
```

O script empacota o projeto (sem `.env.local`, `.db`, `storage` e `node_modules`), envia para `/opt/chego`, mantém o `.env` de lá e roda `docker compose up -d --build`. O primeiro build leva alguns minutos.

## 3. Primeiros passos no ar

1. Abra `https://SEU-DOMINIO/entrar/senha` (ou o link **Equipe Chegô** no rodapé da entrada) e entre com o `ADMIN_EMAIL` e o `ADMIN_PASSWORD`.
2. Em **Admin → Cadastros**, cadastre os **bairros e comunidades reais** de Joaquim Gomes (o banco começa só com o Centro). Sem isso, a loja e o cliente só conseguem escolher o Centro.
3. Passe o endereço para as lojas: elas se cadastram em **Quero vender no Chegô** (com telefone e senha), montam o cardápio e você aprova em **Admin → Lojas**.
4. Entregadores parceiros se cadastram em **Quero entregar** e você aprova em **Admin → Entregadores**. Entregadores do próprio Chegô você cadastra ali mesmo; o sistema mostra uma senha provisória para repassar.
5. Clientes criam a conta na própria entrada do app.

**Esqueceu a senha?** Não há SMS ainda, então a pessoa pede ao suporte: no admin, abra o cliente (Clientes), a loja (Lojas → equipe) ou o entregador e clique em **Gerar senha nova**. A senha provisória aparece na tela; a pessoa troca depois em **Meu perfil → Senha**.

## 4. Atualizar depois de mudar o código

Rode de novo:

```powershell
npm run deploy:vps -- root@IP-DA-VPS
```

Só o app é refeito. Banco, fotos e certificados continuam.

## 5. Comandos úteis na VPS

```bash
cd /opt/chego
docker compose ps                       # o que está ligado
docker compose logs -f app              # registros do app (Ctrl+C sai)
docker compose restart app              # reinicia só o app
docker compose exec db psql -U chego chego         # abre o banco
```

**Já subiu antes com os dados de teste?** Para apagar tudo e recomeçar só com a base (isso apaga lojas, pessoas e pedidos que estiverem lá):

```bash
docker compose exec app node scripts/db.ts reset
```

**Cópia de segurança do banco:**

```bash
docker compose exec -T db pg_dump -U chego chego | gzip > /root/chego-$(date +%F).sql.gz
```

Para fazer isso todo dia às 3h, rode `crontab -e` e acrescente:

```
0 3 * * * cd /opt/chego && docker compose exec -T db pg_dump -U chego chego | gzip > /root/chego-$(date +\%F).sql.gz && find /root -name 'chego-*.sql.gz' -mtime +14 -delete
```

## 6. Usando o repositório do GitHub

O código está em `https://github.com/nexusdevelopment09/chegoSystem`. Para a VPS baixar de lá em vez de receber pelo `deploy:vps`:

```bash
cd /opt && cp chego/.env /root/chego.env      # guarda o .env, se a pasta já existir
rm -rf /opt/chego && git clone https://github.com/nexusdevelopment09/chegoSystem.git /opt/chego
cp /root/chego.env /opt/chego/.env && cd /opt/chego && docker compose up -d --build
```

Depois, para atualizar: `cd /opt/chego && git pull && docker compose up -d --build`. Se o repositório for privado, a VPS precisa de uma deploy key ou de um token próprio para clonar. Os dados não mudam em nenhum dos dois caminhos, porque ficam nos volumes do Docker.

## 7. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `Falta o arquivo .env` no fim do envio | Crie o `/opt/chego/.env` (passo 1.5) e envie de novo. |
| `defina ... no .env` | Falta essa variável no `.env`. |
| `SEED_MODE=base precisa de ADMIN_EMAIL...` nos registros do app | Preencha `ADMIN_EMAIL` e `ADMIN_PASSWORD` (pelo menos 10 caracteres) e rode `docker compose up -d`. |
| O navegador diz que o certificado não é seguro, ou o Caddy registra erro de ACME | O domínio ainda não aponta para a VPS, ou as portas 80 e 443 estão fechadas. Veja `docker compose logs caddy`. |
| Pedidos Pix não expiram e lojas não recebem a recusa automática | As tarefas agendadas não estão rodando: confira o `CRON_SECRET` no `.env` (pelo menos 16 caracteres) e `docker compose logs app`. |
| `scp` ou `ssh` não encontrado no Windows | Configurações → Sistema → Recursos opcionais → instale **Cliente OpenSSH**. |
