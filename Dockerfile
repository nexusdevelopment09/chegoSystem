# Imagem do app Chegô para o servidor (VPS). O banco roda em outro contêiner
# (veja docker-compose.yml). Passo a passo em docs/DEPLOY_VPS.md.

# 1. Dependências (inclui as de desenvolvimento: o build precisa do Tailwind e do TypeScript).
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2. Build do Next.js. Não precisa do banco: nenhuma página consulta o banco no build.
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# APP_ENV e a chave pública do push entram no código do navegador, por isso são fixados no build.
ARG APP_ENV=local
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=
ENV APP_ENV=$APP_ENV \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    DATABASE_URL=postgres://build@127.0.0.1:1/build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 3. Execução. Fica com o projeto inteiro porque scripts/db.ts (migrations, seed e o
# "Resetar banco" do /dev) usa o código-fonte e as fotos do seed.
FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=America/Maceio
COPY --from=build --chown=node:node /app ./
RUN mkdir -p storage && chown node:node storage
USER node
EXPOSE 3000
# Aplica as migrations que faltarem (e o seed, se o banco estiver vazio) e liga o app.
CMD ["sh", "-c", "node scripts/db.ts bootstrap && exec node_modules/.bin/next start"]
