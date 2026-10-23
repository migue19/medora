#!/usr/bin/env bash
# Guarda el token de la API de Hostinger para renovar el certificado por DNS (una vez, como root en el VPS),
# cambia la renovación de medora.nut.com.mx a los hooks automáticos y la prueba en seco.
# Crea el token en hPanel → Perfil → API. No lo pegues en ningún chat.
set -euo pipefail
cd "$(dirname "$0")/.."

CERT="${CERT_NAME:-medora.nut.com.mx}"
ZONE="${ACME_DNS_ZONE:-${CERT#*.}}"
TOKEN_FILE=/root/.hostinger-dns-token
CONF="/etc/letsencrypt/renewal/$CERT.conf"

printf 'Pega el token de la API de Hostinger y presiona Enter: '
read -rs TOKEN; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
code="$(curl -s -m 30 -o /dev/null -w '%{http_code}' "https://developers.hostinger.com/api/dns/v1/zones/$ZONE" \
  -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json')"
[ "$code" = 200 ] || { echo "Hostinger respondió $code al leer la zona $ZONE: revisa el token."; exit 1; }

umask 077
printf '%s' "$TOKEN" > "$TOKEN_FILE"

HOOK="$PWD/scripts/acme-dns-hook.sh"
cp "$CONF" "$CONF.bak-$(date +%Y%m%d%H%M%S)"
sed -i '/^manual_auth_hook/d;/^manual_cleanup_hook/d' "$CONF"
sed -i "/^authenticator = manual/a manual_auth_hook = $HOOK auth\nmanual_cleanup_hook = $HOOK cleanup" "$CONF"

echo "Probando la renovación en seco (tarda unos minutos mientras el DNS se propaga)…"
certbot renew --cert-name "$CERT" --dry-run 2>&1 | tail -3
