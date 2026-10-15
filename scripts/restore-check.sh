#!/usr/bin/env bash
# Prueba de restauración: carga un respaldo en un PostgreSQL temporal y cuenta registros.
# No toca la base de producción: el contenedor es propio, sin puertos publicados, y se elimina al terminar.
# Uso: scripts/restore-check.sh [archivo.dump]   (por defecto, el más reciente de BACKUP_DIR)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/medora}"
FILE="${1:-$(ls -1t "$BACKUP_DIR"/medora-*.dump 2>/dev/null | head -1)}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "No hay respaldo para probar"; exit 1; }

NAME="medora-restore-check-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --rm --name "$NAME" --network none -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" \
  -e POSTGRES_DB=restore postgres:17.9-bookworm >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -d restore >/dev/null 2>&1 && break
  sleep 1
done

docker exec -i "$NAME" pg_restore -U postgres -d restore --no-owner --exit-on-error < "$FILE"

echo "Restaurado: $FILE"
docker exec "$NAME" psql -U postgres -d restore -At -F ' ' -c "
  SELECT 'Clinic', count(*) FROM \"Clinic\"
  UNION ALL SELECT 'User', count(*) FROM \"User\"
  UNION ALL SELECT 'Doctor', count(*) FROM \"Doctor\"
  UNION ALL SELECT 'PatientAccount', count(*) FROM \"PatientAccount\"
  UNION ALL SELECT 'Appointment', count(*) FROM \"Appointment\"
  UNION ALL SELECT '_prisma_migrations', count(*) FROM _prisma_migrations"
