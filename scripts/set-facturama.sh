#!/usr/bin/env bash
# Conecta Facturama (CFDI 4.0 de las suscripciones): pide usuario, contraseña y CP de expedición sin mostrarlos,
# comprueba con Facturama que la cuenta responde, guarda todo en .env y reinicia la API.
# Uso, como root en el VPS: /opt/medora/scripts/set-facturama.sh
set -euo pipefail
cd "$(dirname "$0")/.."

read -r -p "Usuario de Facturama: " USER_
read -rs -p "Contraseña de Facturama: " PASS; echo
read -r -p "Código postal de tu domicilio fiscal (5 dígitos): " ZIP
read -r -p "¿Cuenta de pruebas (sandbox)? [s/n]: " SB
[[ -n "$USER_" && -n "$PASS" ]] || { echo "Faltan usuario o contraseña"; exit 1; }
[[ "$ZIP" =~ ^[0-9]{5}$ ]] || { echo "El código postal debe tener 5 dígitos"; exit 1; }
SANDBOX=true; BASE=https://apisandbox.facturama.mx
[[ "$SB" =~ ^[nN] ]] && { SANDBOX=false; BASE=https://api.facturama.mx; }

# El perfil fiscal de la cuenta confirma usuario y contraseña (y muestra el RFC emisor).
CODE="$(curl -s -m 20 -o /tmp/facturama-perfil.json -w '%{http_code}' -u "$USER_:$PASS" "$BASE/TaxEntity")"
case "$CODE" in
  200) echo "Cuenta verificada: $(grep -oE '"Rfc":"[^"]*"' /tmp/facturama-perfil.json | head -1 | cut -d'"' -f4) · $(grep -oE '"(TaxName|Name)":"[^"]*"' /tmp/facturama-perfil.json | head -1 | cut -d'"' -f4)";;
  401|403) rm -f /tmp/facturama-perfil.json; echo "Facturama rechazó el usuario o la contraseña ($CODE)."; exit 1;;
  *) echo "Aviso: Facturama respondió $CODE al leer el perfil; guardo los datos de todos modos.";;
esac
rm -f /tmp/facturama-perfil.json

cp .env ".env.bak-$(date +%Y%m%d%H%M%S)"
sed -i '/^FACTURAMA_USER=/d;/^FACTURAMA_PASSWORD=/d;/^FACTURAMA_SANDBOX=/d;/^INVOICE_EXPEDITION_ZIP=/d' .env
printf "FACTURAMA_USER='%s'\nFACTURAMA_PASSWORD='%s'\nFACTURAMA_SANDBOX=%s\nINVOICE_EXPEDITION_ZIP=%s\n" "$USER_" "$PASS" "$SANDBOX" "$ZIP" >> .env
chmod 600 .env
docker compose up -d api >/dev/null 2>&1
echo "Listo: Facturama configurado (sandbox=$SANDBOX) y API reiniciada."
[ "$SANDBOX" = false ] && grep -q "^STRIPE_SECRET_KEY='\?sk_test_" .env && echo "Nota: Stripe sigue en modo de prueba; esos cobros no se facturarán hasta que cargues las llaves sk_live_."
exit 0
