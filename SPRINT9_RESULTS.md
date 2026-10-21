# Resultados de verificación · Sprint 9

Fecha: 21 de octubre de 2026. Entorno: macOS, Node 24, PostgreSQL 17 local; Stripe simulado en las pruebas (la firma de los webhooks se verifica con el SDK real de Stripe).

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias | 16/16 |
| Pruebas de integración con PostgreSQL real (base creada desde cero) | 69/69 (65 anteriores + 4 nuevas) |
| `npm run build` (API + Next.js) | OK |
| Pantallas en navegador (panel: «Pagos» y «Clínica → Pagos en línea») | OK, sin llaves de Stripe muestra el aviso y no permite activar |
| Flujo real con Stripe | Pendiente: requiere las llaves de prueba de la cuenta de Medora |

## Qué se entregó

- **Stripe Checkout** (cuenta de Medora), en pesos:
  - Tarjeta, y OXXO y SPEI opcionales para citas con 3 días o más de anticipación.
  - SDK `stripe@22.6.2` fijo, detrás de una interfaz de proveedor: en pruebas se usa uno simulado.
- **Pago obligatorio:**
  - La reserva en línea queda «Pendiente de pago» y aparta el horario 35 min. El horario sigue bloqueado por las restricciones de exclusión de la base, porque el estado no es «Cancelada».
  - Al pagar, la cita se confirma: correo con calendario, «Pagado en línea» y recordatorios.
  - Si no paga, un trabajo la cancela con el actor «Sistema» y el horario se libera para otros pacientes y para la lista de espera. Antes de cancelar consulta Stripe, por si se perdió un webhook.
  - Reintentos de pago hasta 2 h desde la reserva. Una ficha OXXO o SPEI emitida extiende el apartado hasta 48 h, y nunca a menos de 1 h de la cita.
- **Pago opcional:** la cita queda agendada al momento y el paciente puede pagar después, desde la confirmación o desde «Mis citas».
- **Anticipo:** 20, 30, 50 o 100 % del precio que ya se calculaba por sede y médico. Cobros menores a $10 no se piden en línea (mínimo de Stripe).
- **Webhooks idempotentes:**
  - Se verifica la firma sobre el cuerpo original y cada evento se registra por id; un id repetido no se vuelve a aplicar.
  - Para las sesiones no se confía en el cuerpo del evento: se consulta el estado real en Stripe. Así el orden y los eventos repetidos no importan.
  - Un índice único parcial impide dos pagos cobrados de la misma cita.
- **Reembolsos según la política:**
  - La clínica cancela: siempre completo.
  - El paciente cancela con la anticipación configurada: completo. Después, o si no asiste, no hay reembolso, y el correo de cancelación lo indica.
  - Pago tardío sobre una cita ya cancelada, o pago duplicado: se reembolsa solo.
  - Los reembolsos se hacen en un trabajo con llave de idempotencia. Errores temporales se reintentan; los permanentes (OXXO no se reembolsa por Stripe) quedan en «Requiere atención» para marcarlos como reembolsados a mano.
  - Un reembolso hecho desde el panel de Stripe llega por `charge.refunded`.
- **Conciliación:** pestaña «Pagos» (propietario y administración) con cobrado, reembolsado y neto a transferir por periodo, el detalle de cada pago con su cita, alertas y el botón «Conciliar».
- **Pantallas:**
  - Reserva: muestra la política antes de confirmar («Apartar y pagar») y lleva a Stripe.
  - «Mis citas»: apartado con fecha límite, «Pagar y confirmar», «Soltar apartado», estado del pago y aviso de si un cancelado se reembolsaría.
  - Agenda: estado del pago, fecha límite del apartado y «Liberar apartado».
  - Clínica: configuración de pagos.
- **Configuración:** `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`. Fuera de producción se rechazan llaves `live`.
- **Corrección de paso:** la agenda ahora muestra «Desde el directorio» para las reservas del Sprint 8.

## Cobertura de integración nueva

- **Pago obligatorio:**
  - Política en el perfil público; apartado que bloquea el horario sin confirmación previa.
  - Sesión reutilizada; monto del anticipo; otro paciente no puede pagar (404).
  - Firma inválida (400); evento antes de pagar sin efecto.
  - Pago, mismo evento repetido (duplicado) y otro evento de la misma sesión sin duplicar; un solo correo de confirmación con el monto.
  - No se puede pagar dos veces (409); estado en el portal y en la agenda.
- **Vencimiento:**
  - Antes del plazo no pasa nada; después, la cita se cancela con actor «Sistema» y el horario vuelve a estar libre.
  - La sesión se cierra en Stripe y sale el correo de cancelación.
  - Un pago tardío se reembolsa completo, con su correo de reembolso.
- **Política de reembolso:**
  - El paciente cancela a tiempo: reembolso.
  - El paciente cancela tarde: sin reembolso, el correo lo indica y el portal avisa antes.
  - La clínica cancela: reembolso.
  - Un apartado se puede soltar aunque falte poco.
- **Opcional, OXXO y conciliación:**
  - OXXO y SPEI se ofrecen sólo con anticipación; una ficha emitida deja el pago «en proceso» y luego queda pagado.
  - Reembolso rechazado por Stripe queda en «Requiere atención»; al marcarlo reembolsado a mano se actualizan los totales.
  - Un reembolso desde el panel de Stripe llega por webhook.
  - La conciliación exige sesión del personal.
