# Subir o Chegô na VPS (Docker + PostgreSQL)

Este guia coloca o Chegô numa VPS (Ubuntu ou Debian) em **modo homologação**: igual ao `localhost` (código de login `123456`, página `/dev`, Pix e cartão simulados), mas no seu domínio, com HTTPS, e com **o site inteiro protegido por usuário e senha**. Ainda não é a versão para clientes de verdade; o que falta para isso está em [PRODUCAO.md](PRODUCAO.md).

Não precisa de GitHub: o projeto vai do seu computador para a VPS pelo `npm run deploy:vps`. Quando o repositório existir, veja a seção 6.

## Como fica no servidor

```
Internet ──► Caddy (portas 80 e 443, HTTPS automático, pede usuário e senha)
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
| `app` | as fotos enviadas e as do seed | `storage` |
| `caddy` | os certificados HTTPS | `caddy_data` |

Os volumes não são apagados quando você envia uma versão nova.

## 1. Preparar a VPS (uma vez só)

1. **Domínio:** no painel do domínio, crie um registro **A** apontando o domínio (ex.: `chego.seudominio.com.br`) para o IP da VPS. Espere ele propagar (`ping chego.seudominio.com.br` deve responder com o IP da VPS).
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
   - `BASIC_AUTH_USER`: o usuário que o navegador vai pedir.
   - `BASIC_AUTH_HASH`: gere com o comando abaixo e cole **entre aspas simples**:
     ```bash
     docker run --rm caddy:2 caddy hash-password --plaintext 'SUA-SENHA'
     ```
   - `POSTGRES_PASSWORD` e `PAYMENT_WEBHOOK_SECRET`: gere cada um com `openssl rand -hex 32`.

   Salve com `Ctrl+O`, `Enter`, `Ctrl+X`.

> Dica: para não digitar a senha da VPS a cada envio, crie uma chave SSH no seu computador (`ssh-keygen`) e copie a chave pública para a VPS (`type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@IP-DA-VPS "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"`).

## 2. Enviar e ligar

No seu computador, na pasta do projeto:

```powershell
npm run deploy:vps -- root@IP-DA-VPS
```

O script empacota o projeto (sem `.env.local`, `.db`, `storage` e `node_modules`), envia para `/opt/chego`, mantém o `.env` de lá e roda `docker compose up -d --build`. O primeiro build leva alguns minutos.

Na primeira vez que o banco sobe vazio, o app aplica as migrations e cria os dados de teste (as mesmas lojas, pessoas e pedidos do seu computador). Nas próximas vezes só aplica as migrations novas.

Abra `https://SEU-DOMINIO`, digite o usuário e a senha do `.env` e use o Chegô como no `localhost`:
- `https://SEU-DOMINIO/dev` para entrar como qualquer usuário de teste;
- ou telefone de teste + código `123456`;
- ou admin/admin em "Entrar com senha".

## 3. Atualizar depois de mudar o código

Rode de novo:

```powershell
npm run deploy:vps -- root@IP-DA-VPS
```

Só o app é refeito. Banco, fotos e certificados continuam.

## 4. Comandos úteis na VPS

```bash
cd /opt/chego
docker compose ps                       # o que está ligado
docker compose logs -f app              # registros do app (Ctrl+C sai)
docker compose restart app              # reinicia só o app
docker compose exec app node scripts/db.ts reset   # volta o banco aos dados de teste
docker compose exec db psql -U chego chego         # abre o banco
```

**Cópia de segurança do banco:**

```bash
docker compose exec -T db pg_dump -U chego chego | gzip > /root/chego-$(date +%F).sql.gz
```

Para fazer isso todo dia às 3h, rode `crontab -e` e acrescente:

```
0 3 * * * cd /opt/chego && docker compose exec -T db pg_dump -U chego chego | gzip > /root/chego-$(date +\%F).sql.gz && find /root -name 'chego-*.sql.gz' -mtime +14 -delete
```

## 5. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `Falta o arquivo .env` no fim do envio | Crie o `/opt/chego/.env` (passo 1.5) e envie de novo. |
| `defina ... no .env` | Falta essa variável no `.env`. |
| O navegador diz que o certificado não é seguro, ou o Caddy registra erro de ACME | O domínio ainda não aponta para a VPS, ou as portas 80 e 443 estão fechadas. Veja `docker compose logs caddy`. |
| A senha do site nunca é aceita | O `BASIC_AUTH_HASH` precisa estar entre aspas simples no `.env`. Depois de corrigir: `docker compose up -d caddy`. |
| Página "Banco de dados local desligado" | O contêiner do banco caiu: `docker compose ps` e `docker compose logs db`. |
| `scp` ou `ssh` não encontrado no Windows | Configurações → Sistema → Recursos opcionais → instale **Cliente OpenSSH**. |

## 6. Quando o repositório no GitHub existir

1. No seu computador: `git remote add origin URL-DO-REPOSITORIO` e `git push -u origin main`.
2. Pode continuar usando `npm run deploy:vps` (ele não depende do GitHub). Ou, se preferir que a VPS baixe do GitHub, troque o conteúdo de `/opt/chego` por um `git clone` do repositório, **guardando antes o `.env`**, e passe a atualizar com `git pull && docker compose up -d --build`.

Os dados não mudam em nenhum dos dois casos, porque ficam nos volumes do Docker.

## 7. Antes de abrir para clientes de verdade

O modo homologação tem atalhos de teste que **não podem** ficar abertos ao público. Trocar `APP_ENV` para `production` só depois de ter SMS e gateway de pagamento reais, e sem os dados de teste. Veja [PRODUCAO.md](PRODUCAO.md).
