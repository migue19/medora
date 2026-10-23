#!/usr/bin/env bash
# Verificación completa con un PostgreSQL 17 temporal en Docker.
# No toca otras bases ni contenedores: crea uno propio y lo elimina al terminar.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker >/dev/null || { echo "Se requiere Docker"; exit 1; }
NAME="medora-verify-$$"
PW="$(node -e "console.log(require('crypto').randomBytes(18).toString('hex'))")"
PORT="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
mkdir -p work

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ PostgreSQL temporal en 127.0.0.1:$PORT"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=medora_test \
  -p "127.0.0.1:$PORT:5432" postgres:17.9-bookworm >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -d medora_test >/dev/null 2>&1 && break
  sleep 1
done

export TEST_DATABASE_URL="postgresql://postgres:$PW@127.0.0.1:$PORT/medora_test"
export DATABASE_URL="$TEST_DATABASE_URL"

echo "→ Prisma generate y migraciones"
npm run db:generate >work/verify.log 2>&1
npm run db:migrate >>work/verify.log 2>&1
echo "→ Typecheck"
npm run build -w @medora/api >>work/verify.log 2>&1
npm run typecheck >>work/verify.log 2>&1
echo "→ Pruebas unitarias"
npm test 2>&1 | tee -a work/verify.log | grep -E "^(# |ℹ )(pass|fail)"
echo "→ Pruebas de integración"
npm run test:integration 2>&1 | tee -a work/verify.log | grep -E "^(# |ℹ )(pass|fail)"
echo "→ Build de producción"
npm run build >>work/verify.log 2>&1
echo "✓ Verificación completa. Log: work/verify.log"
