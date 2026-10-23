#!/usr/bin/env bash
# Copia cifrada de los respaldos fuera del VPS (Google Drive, con rclone crypt).
# Sube los respaldos de PostgreSQL de los últimos 2 días y el .env (contiene RECORDS_ENCRYPTION_KEY),
# y borra en Drive lo que tenga más de OFFSITE_KEEP_DAYS (30).
# Configuración inicial: scripts/set-gdrive-backup.sh. Uso: scripts/offsite-backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="${OFFSITE_REMOTE:-medora-cifrado:}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/medora}"
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-30}"
FLAGS=(--drive-use-trash=false --retries 5 --low-level-retries 10 --stats 0)

rclone listremotes | grep -qx "${REMOTE}" || { echo "$(date -Is) copia externa: falta configurar (scripts/set-gdrive-backup.sh)"; exit 1; }

rclone copy "$BACKUP_DIR" "${REMOTE}db" --include 'medora-*.dump' --max-age 2d "${FLAGS[@]}"
rclone copyto .env "${REMOTE}env/env-$(date -u +%Y%m%d)" "${FLAGS[@]}"
rclone delete "${REMOTE}" --min-age "${KEEP_DAYS}d" "${FLAGS[@]}"

LAST="$(ls -1t "$BACKUP_DIR"/medora-*.dump | head -1)"
rclone check "$BACKUP_DIR" "${REMOTE}db" --include "$(basename "$LAST")" --one-way --download "${FLAGS[@]}" 2>/dev/null \
  || { echo "$(date -Is) copia externa: el último respaldo no coincide en Drive"; exit 1; }
echo "$(date -Is) copia externa OK: $(basename "$LAST") y .env en Google Drive (cifrados)"
