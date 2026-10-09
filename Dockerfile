# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Imagem de produção do almo-erp.
#
# Base Debian (glibc) e não Alpine: o Prisma 7 usa WASM/driver adapter e o
# musl já deu dor de cabeça o suficiente para não valer a economia de espaço.
# O runtime roda `pnpm start` (Next em modo servidor) — sem `output: standalone`
# para não depender do tracing do Prisma no bundle.
# ---------------------------------------------------------------------------

# Base **pinada por digest** (Node 24 LTS, bookworm-slim): a tag `node:24-bookworm-slim`
# é mutável, então o digest garante que a imagem de produção não muda por baixo. O
# Dependabot (`.github/dependabot.yml`, ecossistema docker) propõe o bump.
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS base
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
# `NEXT_PUBLIC_*` lido pelo **navegador** é inlinado no bundle e precisa existir
# aqui, em tempo de build. Lido só no servidor, é runtime (ver abaixo).
ARG NEXT_PUBLIC_APP_NAME=almo-erp
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
# SHA do commit, para a versão exibida (o `.git` não entra na imagem).
ARG GIT_SHA=
# Um `--build-arg` só chega ao build se o `ARG` for declarado aqui. Sem esta
# linha o valor é **silenciosamente ignorado** (o Docker avisa "not consumed",
# fácil de não ver) e o `next build` congela o vazio no bundle — era assim que a
# captura de erro do navegador ficaria morta em produção.
#
# Este é o **único** `NEXT_PUBLIC_*` que o cliente lê direto. `GOOGLE_CLIENT_ID`
# é lido no servidor e passado como prop (é runtime, não build), e `APP_URL` /
# `APP_NAME` não são lidos por ninguém hoje — só existem no schema do `env.ts`.
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV GIT_SHA=$GIT_SHA
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
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

# O entrypoint espera o banco, aplica as migrations e então sobe o Next.
# Migrar dentro do container é seguro porque a aplicação tem **1 réplica** e o
# zero-downtime está **desligado** (ver docs/DEPLOY.md). Com mais de uma réplica,
# mova a migration para um passo separado.
CMD ["sh", "/app/docker-entrypoint.sh"]
