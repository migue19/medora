#!/usr/bin/env bash
# Configura la copia externa de respaldos en Google Drive (una sola vez, como root en el VPS).
#  1. En tu Mac:  brew install rclone && rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"
#     (abre el navegador; el permiso es sólo sobre los archivos que cree rclone, no sobre tu Drive completo)
#  2. Copia el bloque {"access_token":...} que imprime y pégalo aquí cuando lo pida (no se muestra).
# Crea la contraseña de cifrado en /root/medora-offsite-password: respáldala, sin ella las copias no se pueden abrir.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v rclone >/dev/null || apt-get install -y rclone >/dev/null

printf 'Pega el token de Google Drive y presiona Enter: '
read -rs TOKEN; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
# Las versiones recientes de rclone imprimen el token en base64 ({"token":"{...}"}).
if [[ "$TOKEN" != \{* ]]; then
  TOKEN="$(python3 -c 'import sys,base64,json; s=sys.argv[1].replace("-","+").replace("_","/"); s+="="*(-len(s)%4); print(json.loads(base64.b64decode(s))["token"])' "$TOKEN" 2>/dev/null || true)"
fi
[[ "$TOKEN" == \{*access_token*refresh_token*\} ]] || { echo "Eso no parece el token de rclone ({\"access_token\":...})."; exit 1; }

umask 077
PWFILE=/root/medora-offsite-password
[ -s "$PWFILE" ] || head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40 > "$PWFILE"

rclone config create medora-gdrive drive scope=drive.file token="$TOKEN" --non-interactive >/dev/null
rclone config create medora-cifrado crypt remote=medora-gdrive:medora-respaldos \
  password="$(rclone obscure "$(cat "$PWFILE")")" filename_encryption=standard --non-interactive >/dev/null

LINE='30 9 * * * root /opt/medora/scripts/offsite-backup.sh >> /var/log/medora-backup.log 2>&1'
grep -qF offsite-backup.sh /etc/cron.d/medora-backup || echo "$LINE" >> /etc/cron.d/medora-backup

scripts/offsite-backup.sh
echo "Listo. Copia diaria a las 03:30 (Ciudad de México). Respalda la contraseña con: cat $PWFILE"
