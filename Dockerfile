# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Imagem de produção do almo-erp.
#
# Base Debian (glibc) e não Alpine: o Prisma 7 usa WASM/driver adapter e o
# musl já deu dor de cabeça o suficiente para não valer a economia de espaço.
# O runtime roda `pnpm start` (Next em modo servidor) — sem `output: standalone`
# para não depender do tracing do Prisma no bundle.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- Dependências ---------------------------------------------------------
# `--ignore-scripts` porque o `postinstall` roda `prisma generate`, que precisa
# do schema — copiado só no estágio de build.
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---- Build ----------------------------------------------------------------
FROM base AS build
# `NEXT_PUBLIC_*` é inlinado no bundle: precisa existir em tempo de build.
ARG NEXT_PUBLIC_APP_NAME=almo-erp
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# O env é validado ao importar o Prisma; no build não há banco, só um placeholder.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

# ---- Runtime --------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV UPLOAD_DIR=/data/uploads

# Mantemos o projeto completo + node_modules: além de servir o Next, a imagem
# precisa do CLI do Prisma para `db:deploy` e `db:seed`.
COPY --from=build /app ./

RUN mkdir -p /data/uploads && chown -R node:node /app /data/uploads

USER node
EXPOSE 3000

# Migrations ANTES de servir: `prisma migrate deploy` é idempotente e roda
# dentro do container. Isso é seguro porque no Dokploy a aplicação tem **1
# réplica** e o zero-downtime está **desligado** (ver docs/DEPLOY.md).
# Se um dia houver mais de uma réplica, mova a migration para um passo separado
# (serviço `migrate` no Docker Compose) — senão duas instâncias migram juntas.
CMD ["sh", "-c", "pnpm db:deploy && pnpm start"]
