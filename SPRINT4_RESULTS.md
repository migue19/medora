# Resultados de verificación · Sprint 4

Fecha: 21 de octubre de 2026. Entorno: macOS, Node 24.20, PostgreSQL 17 local.

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias (`npm test`) | 16/16 |
| Pruebas de integración con PostgreSQL real | 41/41 (32 anteriores + 9 nuevas) |
| `npm run build` (API + Next.js) | OK |
| Flujo en navegador con la API y la web locales | OK (ver abajo) |

## Qué se entregó

- **Perfil del paciente** en «Pacientes»: datos de contacto, etiquetas, estadísticas (próximas, atendidas, inasistencias y canceladas), historial completo de citas, notas internas con autor y fecha (no se editan ni se borran), lista de espera y auditoría de la ficha. El médico sólo ve pacientes con citas suyas y sólo esas citas; no ve la auditoría.
- **Edición auditada**: recepción corrige nombre, teléfono, correo, WhatsApp y etiquetas de fichas telefónicas; cada cambio guarda el valor anterior y el nuevo. Las fichas con cuenta en línea sólo admiten etiquetas: sus datos los cambia el paciente en su perfil y se sincronizan a todas sus clínicas.
- **Búsqueda por etiqueta** además de nombre, teléfono y correo.
- **Fusión de duplicados**: mueve citas, notas y lista de espera (conserva la entrada más antigua si ambas esperaban lo mismo), une etiquetas y conserva la vinculación en línea. Se rechaza si las dos fichas tienen citas vigentes a la misma hora o cuentas en línea distintas. La ficha origen queda oculta y la auditoría guarda una copia.
- **Vincular ficha telefónica con cuenta en línea**: recepción envía un enlace al correo de la cuenta; el paciente ve la clínica, su nombre y los últimos 4 dígitos del teléfono y confirma. Si ya había reservado en línea en esa clínica, las dos fichas se fusionan. Un solo uso, vigencia de 7 días.
- **Lista de espera** por médico y servicio, con rango de fechas opcional: el paciente se anota desde la página de reservas (máximo 3 listas) o recepción lo agrega desde su ficha. Al cancelarse o reprogramarse una cita, el horario se aparta a la primera persona compatible (rango de fechas, servicio que cabe, sin otra cita a esa hora, menos de 3 citas próximas) y se le avisa por correo con un enlace para aceptar o rechazar. Si rechaza, no responde a tiempo, sale de la lista o recepción libera el apartado, pasa a la siguiente. Los pacientes sin correo aparecen en la pestaña «Lista de espera» con su apartado para que recepción los llame y agende.
- **Citas subsecuentes**: botón «Agendar subsecuente» en citas atendidas (agenda y perfil) que preselecciona médico y servicio y guarda `followUpOfId`.

## Garantías

- Mientras un apartado está vigente, el horario no aparece en la disponibilidad pública y lo rechazan las reservas en línea, las del personal y las reprogramaciones.
- PostgreSQL impide dos apartados pendientes traslapados del mismo médico y más de una oferta pendiente por persona.
- Aceptar dos veces la misma oferta, incluso con dos clics simultáneos, crea una sola cita.
- Todo el reparto ocurre bajo el mismo candado por médico que las reservas, así que no compite con ellas.

## Cobertura de integración nueva

- Perfil: estadísticas con atendida, inasistencia, cancelada y próxima; nota de recepción; edición con etiquetas normalizadas y auditoría; búsqueda por etiqueta; visibilidad del médico y 403 al editar.
- Fusión: conflicto por citas simultáneas (409), misma ficha (400), fusión correcta (citas, notas, etiquetas y correo), origen oculto y sin poder agendar.
- Vinculación: correo inexistente (404), enlace por correo, datos mostrados, fusión con la ficha en línea, un solo uso, portal con todas las citas, auditoría, ficha vinculada no editable salvo etiquetas, sincronización del perfil y 409 al pedir vincular otra vez.
- Subsecuente: rechazada si la cita no está atendida o es de otro paciente; guardada y visible en la agenda.
- Lista de espera: correo confirmado, duplicado, rango inválido, máximo 3, consultar y salir.
- Apartado y aceptación: correo al primero de la lista, horario oculto y bloqueado para pacientes y recepción, doble aceptación simultánea con una sola cita y confirmación por correo.
- Rechazo, rango de fechas vencido y vencimiento: pasa al siguiente, el que rechazó sigue en la lista y al no quedar nadie el horario vuelve a estar libre.
- Fichas telefónicas: apartado sin correo visible en el panel, recepción lo libera y agenda al siguiente.
- Reprogramar libera el horario anterior y salir de la lista libera el apartado.

## Flujo en navegador

Con un escenario armado por la API (dos fichas en lista de espera y una cita cancelada): la pestaña «Lista de espera» muestra a Don Pepe (sin correo) con el horario apartado; «No le sirve» lo pasa a Doña Luz con aviso por correo. El enlace `/lista-espera#…` muestra el horario y lo acepta. El perfil de Don Pepe muestra etiquetas, estadísticas, acciones, lista de espera y notas.

## Pendiente fuera del código

- Verificación por teléfono para vincular (requiere WhatsApp o SMS).
