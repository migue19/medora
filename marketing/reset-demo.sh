#!/usr/bin/env bash
# Recrea la base local medora_dev con la clínica demo (Clínica Aurora). La API local debe estar detenida o se reconecta sola.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"
URL=postgresql://postgres@127.0.0.1:55432/medora_dev
docker exec medora-dev sh -c 'dropdb -U postgres --force medora_dev && createdb -U postgres medora_dev'
DATABASE_URL=$URL npx prisma migrate deploy >/dev/null
rm -rf dist-test && npx tsc -p tsconfig.json --outDir dist-test
DEMO_DATABASE_URL=$URL node dist-test/test/demo/demo-seed.js 2>&1 | grep -v '^\[Nest\]\|Deprecation\|trace-deprecation'
# La web local guarda en disco las páginas públicas: después de recrear la demo hay que borrarlas y reiniciar la web.
rm -rf ../web/.next/cache/fetch-cache
