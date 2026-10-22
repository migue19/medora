# Resultados de verificación · Sprint 10

Fecha: 22 de octubre de 2026. Entorno: macOS, Node 24, PostgreSQL 17 local; Daily simulado en las pruebas.

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias | 16/16 |
| Pruebas de integración con PostgreSQL real (base creada desde cero) | 72/72 (69 anteriores + 3 nuevas) |
| `npm run build` (API + Next.js) | OK |
| Navegador (local) | Agenda con «Videoconsulta» e «Iniciar videoconsulta»; página de la sala; encabezados de permisos por página |
| Videollamada real con Daily | Pendiente: requiere la llave de Daily |

## Qué se entregó

- **Modalidad por cita:** presencial o videoconsulta, sólo en servicios marcados «También por videoconsulta». La elige el paciente al reservar o recepción al agendar.
- **Sala por cita en Daily:**
  - Privada, sin grabación, abierta de 15 min antes a 30 min después de la cita; al reprogramar se mueve con ella.
  - Pase personal: el paciente como invitado y el médico como anfitrión.
  - Recepción y los demás médicos no entran.
- **Enlaces que caducan:**
  - El correo de confirmación y los recordatorios llevan un enlace firmado (HMAC) que sólo describe y abre esa cita, y sólo en su ventana.
  - Cancelada o atendida, ya no abre. Pide Origin del sitio y tiene límite de consultas.
- **Sala de espera:**
  - Página `/consulta` sin instalar nada, con prueba de cámara y micrófono de Daily antes de entrar.
  - El paciente avisa que sigue en la sala cada 20 s. El médico ve «Paciente en sala de espera» en la agenda, que se actualiza sola, y el número de pacientes esperando en el título de la pestaña.
- **Consentimiento informado:** texto de 4 puntos que se acepta la primera vez. Se guardan la fecha y la versión, con una restricción en la base para que nunca falte la versión.
- **Permisos del navegador por página:**
  - Cámara y micrófono sólo en `/consulta`, y sólo para Daily.
  - Geolocalización sólo en `/directorio`.
- **Correcciones de paso:**
  - «Cerca de mí» del directorio (Sprint 8) estaba bloqueado por el encabezado de permisos en todo el sitio.
  - La conexión a la base fija la zona horaria en UTC: con un PostgreSQL en otra zona, el adaptador de Prisma leía las fechas desfasadas. Producción usa UTC, así que no se veía ahí.

## Cobertura de integración nueva

- **Modalidad:**
  - El perfil público indica qué servicios ofrecen video; no se puede pedir video en un servicio que no lo ofrece (400).
  - El correo trae el enlace a la sala y no la dirección.
  - El enlace da la información de la cita; uno alterado da 404; antes de la ventana da 409; una cita presencial no tiene sala.
- **Sala de espera:**
  - Consentimiento requerido, guardado una sola vez y no vuelve a pedirse.
  - Ventana de la sala correcta.
  - El médico ve al paciente esperando y deja de verlo sin señales de vida; la señal de vida lo reactiva.
  - Recepción y otro médico reciben 403; el médico de la cita entra como anfitrión con su nombre.
  - Atendida o fuera de ventana, la sala no abre; otro paciente no ve la cita.
- **Enlace del correo:**
  - Funciona sin cuenta, con consentimiento.
  - Sin Origin del sitio da 403.
  - Reprogramada, abre en el nuevo horario y la sala se mueve; cancelada, ya no abre.
