# Resultados de verificación · Sprint 5

Fecha: 21 de octubre de 2026. Entorno: macOS, Node 24.20, PostgreSQL 17 local.

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias (`npm test`) | 16/16 |
| Pruebas de integración con PostgreSQL real | 47/47 (41 anteriores + 6 nuevas) |
| `npm run build` (API + Next.js) | OK |
| Migración sobre una base con datos (desarrollo) | OK: «Sede principal» creada y citas y horarios asignados |
| Flujo en navegador con la API y la web locales | OK (ver abajo) |

## Qué se entregó

- **Sedes**: nombre, dirección, teléfono, enlace de mapa (sólo `https://`), horario de atención por día y orden. No se puede desactivar una sede con horarios de médicos o citas próximas, ni reducir su horario dejando fuera a un médico.
- **Consultorios** por sede. Cada bloque del horario semanal de un médico pertenece a una sede y, opcionalmente, a un consultorio. La cita toma la sede y el consultorio del bloque en que cae, también al reprogramarse.
- **Sin choques de consultorio**: PostgreSQL impide asignar un consultorio a dos bloques traslapados (de cualquier médico) y dos citas vigentes en el mismo consultorio. Si el horario cambia y queda una cita antigua en ese consultorio, la disponibilidad la descuenta y recepción recibe un mensaje claro.
- **Perfil profesional**: formación, certificaciones de consejo, idiomas, padecimientos que atiende y aseguradoras (listas limpias y sin duplicados), más foto. La foto se reduce en el navegador (máx. 600 px, JPEG); el servidor revisa el tipo real por su firma de bytes y el tamaño, y la sirve con caché inmutable.
- **Precios** por sede, por médico o por médico en una sede; gana el más específico. El precio se congela en la cita. La página pública muestra el precio de cada sede y «desde» cuando varía.
- **Tipo de visita**: servicios sólo de primera vez o sólo subsecuentes, según las citas atendidas con ese médico. Se exige en reservas en línea y en la lista de espera; el personal puede agendar cualquiera.
- **Web**: sedes y consultorios en «Clínica»; sede y consultorio por bloque en el horario; perfil profesional y foto en «Médicos»; precios especiales y tipo de visita en «Servicios»; sede y consultorio en la agenda, con filtro por sede. En la página de reservas: tarjetas de sede con horario agrupado («Lun–Vie 08:00–20:00») y mapa, foto y perfil del médico, elección de sede y precio por sede. En «Mis citas», la sede con dirección y mapa.
- Correos, recordatorios, enlaces de confirmación y ofertas de lista de espera usan la dirección y el teléfono de la sede de la cita.

## Cobertura de integración nueva

- Dos sedes con horarios distintos: perfil público, horarios por sede y filtro, sede y consultorio en la cita, dirección de la sede en el correo, reprogramación a otra sede, agenda filtrada por sede y portal del paciente.
- Validaciones: bloque fuera del horario de la sede, consultorio de otra sede, consultorio traslapado entre médicos (409), consultorio distinto permitido, reducir el horario de la sede o desactivar sede o consultorio en uso (409) y horario de sede traslapado (400).
- Consultorio con cita existente tras cambiar horarios: no aparece en la disponibilidad, recepción recibe 409 con el nombre del consultorio y la inserción directa en la base es rechazada.
- Precios: validación de alcance y duplicados, precio por sede en el perfil público, precio congelado en citas de cada sede.
- Tipo de visita: subsecuente sin historial (409), primera vez con historial (409) y los casos válidos.
- Perfil y foto: listas normalizadas, elemento demasiado largo (400), archivo que no es imagen (400), archivo demasiado grande (413), subida, entrega con tipo y caché correctos, foto en el perfil público y borrado.

## Flujo en navegador

Con dos sedes (Centro de lunes a viernes, Norte martes y jueves con precio especial):

- **Página de reservas**: muestra las tarjetas de sede con horario agrupado y mapa, el perfil profesional desplegable y el precio «desde $500.00». Al elegir la sede Norte aparecen sólo los jueves a $650.00.
- **Panel**: la tarjeta del médico resume los bloques con su sede, el editor tiene selectores de sede y consultorio por bloque, y «Clínica» muestra sedes, consultorios y horarios.

La subida de foto no se probó en el navegador (la herramienta no permite elegir archivos); está cubierta por la prueba de integración.
