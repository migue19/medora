# Resultados de verificación · Sprint 13

Fecha: 22 de octubre de 2026. Entorno: macOS, Node 24, PostgreSQL 17 local.

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias | 16/16 |
| Pruebas de integración con PostgreSQL real (base creada desde cero) | 83/83 (81 anteriores + 2 nuevas) |
| Navegador (local) | Pestaña «Reportes» con indicadores, gráfica por día con detalle al pasar el cursor, origen, cancelaciones y tabla por médico |
| Excel generado | Abierto por la vista previa de macOS: encabezado en negritas, acentos y caracteres especiales correctos |

## Qué se entregó

- **Indicadores por periodo**, con filtros de médico y sede y atajos («Este mes», «Mes pasado», «Últimos 7 días»):
  - Citas, atendidas y por atender.
  - Inasistencia: «no asistió» entre las citas con resultado.
  - Cancelaciones: tasa, quién canceló (paciente, clínica, falta de pago) y con cuánta anticipación (menos de 24 h, de 24 a 72 h, más de 72 h).
  - Ocupación de la agenda: minutos agendados entre los minutos del horario, sin días bloqueados, en total y por médico.
  - Origen: recepción, página de la clínica, widget, Google, Instagram o directorio.
  - Ingresos de citas atendidas, cobrado en línea neto de reembolsos, y pacientes nuevos o recurrentes.
  - Las definiciones se explican en la misma pestaña («¿Cómo se calcula?»).
- **Gráficas:** columnas por día de una sola serie, con eje discreto, detalle al pasar el cursor y una vista de tabla; barras de origen y de anticipación de cancelaciones; ocupación por médico. Las etiquetas van en color de texto, nunca del color de la serie.
- **Exportación** (plan Plus):
  - CSV para Excel en español (UTF-8 con BOM) y Excel `.xlsx` con una fila por cita: fecha, hora, médico, sede, paciente, teléfono, servicio, modalidad, estado, origen, precio, cobrado en línea y cancelación.
  - El CSV evita la inyección de fórmulas.
  - El `.xlsx` se genera sin dependencias externas: `exceljs` traía una versión de `uuid` con un aviso de seguridad.
- **Resumen semanal por correo** a los propietarios, los lunes a las 8:00 (centro de México):
  - Semana pasada contra la anterior: citas, atendidas, inasistencia, cancelaciones, ocupación, pacientes nuevos, ingresos y el médico con mayor ocupación.
  - Se omite si no hubo actividad. Se desactiva en «Clínica» y hay un botón «Enviarme el resumen semanal» para verlo cuando quieras.
  - El trabajo se programa una sola vez aunque haya varias instancias.

## Cobertura de integración nueva

- **Las cifras cuadran con la agenda.** Escenario de una semana: atendidas, una inasistencia, cancelaciones del paciente (48 h antes) y de la clínica (2 h antes), un apartado sin pagar, cobros en línea con reembolso parcial, un paciente con historial previo y un día bloqueado. Se comprueban:
  - Totales, tasas y ocupación (120 de 960 minutos = 12.5 %).
  - Cancelaciones por actor y anticipación; origen por canal; ingresos y cobrado neto.
  - Pacientes nuevos y recurrentes; serie diaria.
  - Los mismos conteos que muestra la agenda del panel; filtros por médico; periodo inválido.
- **Exportación y resumen:**
  - CSV con encabezado y las 7 citas, y Excel válido; sin plan Plus no se exporta, pero los indicadores sí se ven.
  - Resumen semanal con las cifras correctas, que no se envía si está desactivado; los reportes exigen sesión.
