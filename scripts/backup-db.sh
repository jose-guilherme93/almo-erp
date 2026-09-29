#!/usr/bin/env bash
#
# Backup do Postgres do almo-erp.
#
# Roda no host, via cron. Gera um dump custom (`-Fc`) no diretório de backups,
# aplica retenção local e — se `RCLONE_REMOTE` estiver definido — copia o
# arquivo para um destino remoto (Cloudflare R2, Backblaze B2, S3...).
#
# Exemplo de crontab (todo dia às 3h):
#   0 3 * * * cd /opt/almo-erp && ./scripts/backup-db.sh >> /var/log/almo-erp-backup.log 2>&1
#
# Restauração (testada? sempre teste):
#   docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
#     pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < backups/almo_erp-<data>.dump

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

cd "$(dirname "$0")/.."

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Arquivo de ambiente não encontrado: $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/almo_erp-$STAMP.dump"

# O `pg_dump` roda dentro do container, então herda POSTGRES_USER/POSTGRES_DB.
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$FILE"

echo "backup: $FILE"

# Retenção local.
find "$BACKUP_DIR" -name 'almo_erp-*.dump' -type f -mtime "+$RETENTION_DAYS" -delete

if [[ -n "${RCLONE_REMOTE:-}" ]]; then
  rclone copy "$FILE" "$RCLONE_REMOTE"
  echo "backup copiado para $RCLONE_REMOTE"
fi
