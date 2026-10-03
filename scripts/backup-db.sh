#!/usr/bin/env bash
#
# Backup do Postgres do almo-erp.
#
# Gera um dump custom (`-Fc`) a partir de uma URL de conexão — serve tanto para
# o Neon (produção) quanto para um Postgres local. O deploy automático já usa o
# workflow `.github/workflows/backup.yml`; este script é para uso manual.
#
# Uso:
#   DATABASE_URL="postgresql://..." ./scripts/backup-db.sh
#   # ou, se `DIRECT_URL` estiver no ambiente, ele tem preferência:
#   DIRECT_URL="postgresql://..." ./scripts/backup-db.sh
#
# Restauração (sempre teste num banco descartável):
#   pg_restore -d "postgresql://.../destino" --clean --if-exists backups/almo_erp-<data>.dump

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Migrations/seed preferem a conexão direta; o dump também.
URL="${DIRECT_URL:-${DATABASE_URL:-}}"

if [[ -z "$URL" ]]; then
  echo "Defina DATABASE_URL (ou DIRECT_URL) com a string de conexão do Postgres." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/almo_erp-$STAMP.dump"

# Roda o pg_dump num container para não depender do cliente instalado no host.
docker run --rm -e PGURL="$URL" postgres:17-alpine sh -c 'pg_dump "$PGURL" -Fc' > "$FILE"

echo "backup: $FILE"

# Retenção local.
find "$BACKUP_DIR" -name 'almo_erp-*.dump' -type f -mtime "+$RETENTION_DAYS" -delete

# Quando o object storage (R2) entrar, suba o dump para lá aqui — backup que
# mora só numa máquina não é backup.
