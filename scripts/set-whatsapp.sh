#!/usr/bin/env bash
# Conecta WhatsApp Business (Cloud API de Meta) a Tepahti: guarda el token y el ID del número en .env sin mostrarlos,
# comprueba con Meta que el número responde y reinicia la API. Uso, como root en el VPS: scripts/set-whatsapp.sh
set -euo pipefail
cd "$(dirname "$0")/.."

read -rs -p "Token permanente de WhatsApp (usuario del sistema): " TOKEN; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
read -r -p "ID del número de teléfono (Phone number ID): " PHONE_ID
PHONE_ID="$(printf '%s' "$PHONE_ID" | tr -d '[:space:]')"
[[ "$PHONE_ID" =~ ^[0-9]{10,20}$ ]] || { echo "El ID del número son sólo dígitos (lo ves en WhatsApp → Configuración de la API)."; exit 1; }

INFO="$(curl -s -m 20 "https://graph.facebook.com/v25.0/$PHONE_ID?fields=display_phone_number,verified_name,quality_rating" -H "Authorization: Bearer $TOKEN")"
echo "$INFO" | grep -q '"display_phone_number"' || { echo "Meta no aceptó el token o el ID del número:"; echo "$INFO" | sed -E 's/"access_token":"[^"]*"//'; exit 1; }
echo "Número verificado: $(echo "$INFO" | sed -E 's/.*"display_phone_number":"([^"]*)".*/\1/') · $(echo "$INFO" | sed -E 's/.*"verified_name":"([^"]*)".*/\1/')"

cp .env ".env.bak-$(date +%Y%m%d%H%M%S)"
sed -i '/^WHATSAPP_TOKEN=/d;/^WHATSAPP_PHONE_NUMBER_ID=/d' .env
printf "WHATSAPP_TOKEN='%s'\nWHATSAPP_PHONE_NUMBER_ID=%s\n" "$TOKEN" "$PHONE_ID" >> .env
chmod 600 .env
docker compose up -d api >/dev/null 2>&1
echo "Listo: WhatsApp conectado y API reiniciada. Activa «También por WhatsApp» en Clínica → Recordatorios."
