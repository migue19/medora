#!/usr/bin/env bash
# Respaldo de PostgreSQL de Tepahti (formato custom de pg_dump) con retención por días.
# Uso en el servidor, desde /opt/medora: scripts/backup-db.sh
# Variables: BACKUP_DIR (/var/backups/medora), BACKUP_KEEP_DAYS (14).
set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/medora}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/medora-$STAMP.dump"

umask 077
mkdir -p "$BACKUP_DIR"

# Las credenciales se toman del entorno del contenedor; no salen del servidor.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner' > "$FILE.partial"

# Un respaldo sólo cuenta si pg_restore puede leer su índice.
docker compose exec -T db pg_restore --list < "$FILE.partial" > /dev/null
mv "$FILE.partial" "$FILE"

find "$BACKUP_DIR" -name 'medora-*.dump' -type f -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'medora-*.partial' -type f -mmin +60 -delete

echo "$(date -Is) respaldo OK: $FILE ($(du -h "$FILE" | cut -f1))"
