#!/usr/bin/env bash
# Hook de certbot para validar por DNS (dns-01) con la API de Hostinger; el puerto 80 sigue cerrado.
# certbot lo llama con CERTBOT_DOMAIN y CERTBOT_VALIDATION:  acme-dns-hook.sh auth | cleanup
# El token vive en /root/.hostinger-dns-token (modo 600); se carga con scripts/set-hostinger-dns-token.sh.
set -euo pipefail

MODE="${1:?Uso: acme-dns-hook.sh auth|cleanup}"
TOKEN_FILE="${HOSTINGER_DNS_TOKEN_FILE:-/root/.hostinger-dns-token}"
ZONE="${ACME_DNS_ZONE:-${CERTBOT_DOMAIN#*.}}"          # tepahti.nut.com.mx → nut.com.mx
NAME="_acme-challenge.${CERTBOT_DOMAIN%."$ZONE"}"      # → _acme-challenge.tepahti
API="https://developers.hostinger.com/api/dns/v1/zones/$ZONE"

api() {
  curl -fsS -m 30 -X "$1" "$API" -H "Authorization: Bearer $(cat "$TOKEN_FILE")" \
    -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$2" >/dev/null
}

case "$MODE" in
  auth)
    api PUT "{\"overwrite\":true,\"zone\":[{\"name\":\"$NAME\",\"type\":\"TXT\",\"ttl\":300,\"records\":[{\"content\":\"$CERTBOT_VALIDATION\"}]}]}"
    # Espera (máx. 20 min) a que el valor se vea en el DNS autoritativo y en resolvers públicos.
    for _ in $(seq 1 40); do
      sleep 30
      ok=1
      for ns in $(dig +short NS "$ZONE" | head -2) 8.8.8.8 1.1.1.1; do
        dig +short TXT "$NAME.$ZONE" @"$ns" | grep -q -- "$CERTBOT_VALIDATION" || ok=0
      done
      [ "$ok" = 1 ] && exit 0
    done
    echo "El TXT $NAME.$ZONE no se propagó a tiempo" >&2; exit 1 ;;
  cleanup)
    api DELETE "{\"filters\":[{\"name\":\"$NAME\",\"type\":\"TXT\"}]}" || true ;;
  *) echo "Modo desconocido: $MODE" >&2; exit 2 ;;
esac
