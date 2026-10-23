#!/usr/bin/env bash
# Monitoreo de Medora en el VPS (cron cada 5 min). Revisa la API, los contenedores, la cola de trabajos,
# los respaldos, el certificado y el disco, y avisa por correo (SMTP del .env) cuando algo cambia:
# al aparecer un problema, cada 24 h mientras siga y cuando se resuelve.
# Destinatario: MONITOR_EMAIL o, si no existe, ONBOARDING_NOTIFY_EMAIL. Uso: scripts/monitor.sh [--prueba]
set -uo pipefail
cd "$(dirname "$0")/.."

env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -E "s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/"; }
DOMAIN="${MONITOR_DOMAIN:-medora.nut.com.mx}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/medora}"
STATE_DIR="${MONITOR_STATE_DIR:-/var/lib/medora-monitor}"
LOG=/var/log/medora-backup.log
mkdir -p "$STATE_DIR"

problems=()
add() { problems+=("$1"); }

# API y web, pasando por nginx como un visitante.
code="$(curl -s -m 15 -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health")"
[ "$code" = 200 ] || add "La API no responde bien: /api/health devolvió $code"
code="$(curl -s -m 20 -o /dev/null -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/")"
[ "$code" = 200 ] || add "La web no responde bien: la página de inicio devolvió $code"

for svc in db api web; do
  st="$(docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null | awk -v s="$svc" '$1==s {print $2" "$3}')"
  [[ "$st" == "running healthy" || "$st" == "running " ]] || add "Contenedor $svc: ${st:-no existe}"
done

# Cola de trabajos: fallidos definitivos en 24 h y pendientes atrasados (trabajador detenido).
q="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -AtF" " -c "
  select count(*) filter (where \"failedAt\" > now() - interval '\''24 hours'\''),
         count(*) filter (where \"completedAt\" is null and \"failedAt\" is null and \"runAt\" < now() - interval '\''15 minutes'\'')
  from \"Job\""' 2>/dev/null)"
if [ -z "$q" ]; then add "No se pudo consultar la cola de trabajos"; else
  read -r failed late <<<"$q"
  [ "$failed" = 0 ] || add "$failed trabajo(s) fallaron definitivamente en las últimas 24 h (correos, recordatorios, facturas…)"
  [ "$late" = 0 ] || add "$late trabajo(s) llevan más de 15 min atrasados: el trabajador de la cola podría estar detenido"
fi

# Respaldos: uno de menos de 26 h, y su copia externa.
last="$(find "$BACKUP_DIR" -name 'medora-*.dump' -mmin -1560 2>/dev/null | head -1)"
[ -n "$last" ] || add "No hay respaldo de la base de datos en las últimas 26 h"
if grep -qF offsite-backup.sh /etc/cron.d/medora-backup 2>/dev/null; then
  ok="$(grep 'copia externa OK' "$LOG" 2>/dev/null | tail -1 | cut -d' ' -f1)"
  if [ -z "$ok" ] || [ $(( $(date +%s) - $(date -d "$ok" +%s) )) -gt 93600 ]; then add "La copia externa a Google Drive no se ha completado en las últimas 26 h"; fi
fi

# Certificado: alerta si faltan menos de 21 días (la renovación automática empieza a los 30).
end="$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" 2>/dev/null | cut -d= -f2)"
if [ -n "$end" ]; then
  days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
  [ "$days" -ge 21 ] || add "El certificado vence en $days días y no se ha renovado"
else add "No se pudo leer el certificado de $DOMAIN"; fi

use="$(df --output=pcent / | tail -1 | tr -dc 0-9)"
[ "$use" -lt 85 ] || add "El disco está al $use %"

# ---------------------------------------------------------------- aviso por correo
send() {
  local subject="$1" body="$2" to from host port url
  to="$(env_get MONITOR_EMAIL)"; [ -n "$to" ] || to="$(env_get ONBOARDING_NOTIFY_EMAIL)"
  from="$(env_get MAIL_FROM)"; host="$(env_get SMTP_HOST)"; port="$(env_get SMTP_PORT)"
  [ -n "$to" ] && [ -n "$host" ] || { echo "$(date -Is) monitor: sin destinatario o SMTP; no se envió «$subject»"; return 1; }
  [ "${port:-465}" = 465 ] && url="smtps://$host:465" || url="smtp://$host:$port --ssl-reqd"
  local addr; addr="$(sed -E 's/.*<(.*)>.*/\1/' <<<"$from")"
  printf 'From: %s\r\nTo: %s\r\nSubject: =?UTF-8?B?%s?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nDate: %s\r\n\r\n%s\r\n' \
    "$from" "$to" "$(printf '%s' "$subject" | base64 -w0)" "$(date -R)" "$body" |
    curl -s -m 30 $url --mail-from "$addr" --mail-rcpt "$to" --user "$(env_get SMTP_USER):$(env_get SMTP_PASSWORD)" --upload-file - \
    && echo "$(date -Is) monitor: aviso enviado a $to: $subject"
}

now="$(date +%s)"
report="$(printf -- '- %s\n' "${problems[@]+"${problems[@]}"}")"
if [ "${1:-}" = --prueba ]; then
  send "Medora · prueba del monitoreo" "El monitoreo de $DOMAIN funciona y puede enviarte avisos.

Estado actual:
${report:-- Todo en orden}"
  exit
fi

sig="$(printf '%s' "${problems[*]+"${problems[*]}"}" | sed -E 's/[0-9]+/N/g' | sha256sum | cut -c1-16)"
prev_sig="$(cat "$STATE_DIR/sig" 2>/dev/null)"; prev_at="$(cat "$STATE_DIR/at" 2>/dev/null || echo 0)"
if [ ${#problems[@]} -gt 0 ]; then
  if [ "$sig" != "$prev_sig" ] || [ $((now - prev_at)) -ge 86400 ]; then
    send "⚠️ Medora: ${#problems[@]} problema(s) en $DOMAIN" "Se detectó en $(hostname) a las $(TZ=America/Mexico_City date '+%d/%m %H:%M') (Ciudad de México):

$report
Revisa con: cd /opt/medora && docker compose ps && docker compose logs --tail=100 api" \
      && { echo "$sig" > "$STATE_DIR/sig"; echo "$now" > "$STATE_DIR/at"; }
  fi
elif [ -n "$prev_sig" ]; then
  send "✅ Medora: todo en orden otra vez" "Los problemas en $DOMAIN se resolvieron a las $(TZ=America/Mexico_City date '+%d/%m %H:%M')." \
    && rm -f "$STATE_DIR/sig" "$STATE_DIR/at"
fi
