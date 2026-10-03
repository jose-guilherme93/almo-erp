#!/bin/sh
#
# Entrypoint de produção do almo-erp.
#
# 1. Espera o Postgres aceitar conexão e aplica as migrations (`prisma migrate
#    deploy` é idempotente). No Dokploy o banco é um **serviço separado**, então
#    o container do app pode subir antes de o banco estar pronto (por exemplo,
#    quando a VPS reinicia). Em vez de crash-loopar, tentamos algumas vezes.
# 2. Sobe o Next.
#
# Só é seguro migrar aqui porque a aplicação tem **1 réplica** e o zero-downtime
# está **desligado** (ver docs/DEPLOY.md). Com mais de uma réplica, mova a
# migration para um passo separado — senão duas instâncias migram juntas.
#
# Ajuste (opcional, via env): DB_WAIT_ATTEMPTS (padrão 30) e
# DB_WAIT_DELAY_SECONDS (padrão 2) — ou seja, ~60s por padrão.

set -eu

attempts="${DB_WAIT_ATTEMPTS:-30}"
delay="${DB_WAIT_DELAY_SECONDS:-2}"

i=1
while true; do
  if pnpm db:deploy; then
    break
  fi

  if [ "$i" -ge "$attempts" ]; then
    echo "entrypoint: banco indisponível após ${attempts} tentativas; abortando." >&2
    exit 1
  fi

  echo "entrypoint: banco indisponível (tentativa ${i}/${attempts}); aguardando ${delay}s…" >&2
  i=$((i + 1))
  sleep "$delay"
done

exec pnpm start
