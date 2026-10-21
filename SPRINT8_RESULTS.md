# Resultados de verificación · Sprint 8

Fecha: 21 de octubre de 2026. Entorno: macOS, Node 24, PostgreSQL 17 local; producción en medora.nut.com.mx.

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas de integración con PostgreSQL real (base creada desde cero con todas las migraciones) | 65/65 (61 anteriores + 4 nuevas) |
| `npm run build` (API + Next.js) | OK |
| Lighthouse 13.5 en `https://medora.nut.com.mx/directorio` | Rendimiento 97 · Accesibilidad 100 · Buenas prácticas 100 · SEO 100 |
| Flujo en navegador (escritorio y móvil 375 px) | OK (ver abajo) |
| Despliegue | Respaldo previo, migración aplicada, 0 avisos de Compose |

## Qué se entregó

- **Directorio público** en `/directorio`: sólo médicos activos de clínicas que activan «Aparecer en el directorio», con reservas en línea, un servicio activo y horario en una sede activa.
- **Búsqueda**: un texto que coincide con una especialidad o un padecimiento del catálogo (o un sinónimo: «pediatra», «presión alta», «cardiólogo») se busca como tal. El resto se busca por palabras en nombre, especialidad, padecimientos y nombre de la clínica, con tolerancia a errores de dedo (`pg_trgm`, índice GIN).
- **Filtros**: ciudad, colonia, aseguradora, precio máximo (con el precio real resuelto por sede y médico), videoconsulta, disponibilidad (hoy, hoy o mañana, esta semana) y «Cerca de mí» (radio de 2 a 50 km). Orden por relevancia, próxima disponibilidad, precio, calificación o distancia.
- **Catálogo**: 36 especialidades y 66 padecimientos con sinónimos, y la relación padecimiento → especialidades que lo atienden. Al buscar un padecimiento aparecen primero los médicos que lo declaran y después los de las especialidades que lo tratan.
- **Indexación en la base**: disparadores de PostgreSQL deducen la especialidad del catálogo, los padecimientos y el texto de búsqueda en cualquier alta o edición de un médico (panel, alta de clínicas o script).
- **Resultados**: foto, especialidad, cédula, clínica, zona, distancia, calificación, precio «desde», videoconsulta y la próxima disponibilidad con hasta 4 horarios. Cada horario abre la página del médico con el servicio, la sede y la hora ya elegidos, directo en «Confirma tu cita». La reserva queda con canal `directorio`.
- **SEO**: páginas indexables `/directorio/{especialidad}` y `/directorio/{especialidad}/{ciudad}`, con canonical y `ItemList` de schema.org, incluidas en `sitemap.xml`. Las búsquedas con filtros llevan `noindex, follow`.
- **Panel**:
  - Sedes: colonia, ciudad, estado, CP y coordenadas (se toman solas de un enlace largo de Google Maps).
  - Servicios: casilla «También por videoconsulta».
  - Configuración: participación en el directorio.
  - Médicos: sugerencias del catálogo para la especialidad y un aviso si queda fuera del catálogo.
- **Alta de clínicas**:
  - Nuevo: opción «Aparecer en el directorio» y videoconsulta por servicio.
  - Corregido: la importación guardaba sólo la dirección y perdía colonia, ciudad y CP. Ahora los guarda en su campo y toma las coordenadas del mapa.
- **Límite de consultas**: el servidor web reenvía la IP del visitante (que nginx fija), así que el límite de consultas es por persona y no se comparte entre todos.

## Cobertura de integración nueva

- **Visibilidad**: clínica no participante, reservas desactivadas, médico inactivo o sin horario quedan fuera. También se probó el resumen de especialidades, ciudades y combinaciones.
- **Catálogo**:
  - Se deduce la especialidad desde un sinónimo con acento, y una especialidad fuera del catálogo queda marcada así en el panel.
  - Se deducen los padecimientos declarados, y al editarlos se reindexa.
  - Búsqueda por sinónimo y por padecimiento, con prioridad para quien lo declara y respaldo por especialidad.
  - Texto con errores de dedo y por nombre de la clínica; especialidad inexistente; sugerencias.
- **Filtros**:
  - Ciudad, colonia, aseguradora y videoconsulta.
  - Precio máximo con precio especial por médico, y orden por precio.
  - Servicio principal más económico.
  - Distancia y radio; coordenadas tomadas del enlace del mapa.
  - Validación de coordenadas (400).
- **Disponibilidad**:
  - Orden por próxima cita y filtro «esta semana» (un médico con vacaciones queda fuera).
  - Horarios en hora local con su sede.
  - Una reserva con canal `directorio` retira ese horario del directorio.
  - «Hoy o mañana».

## Flujo en navegador

Probado en local:

1. Buscar «pediatra» muestra «Pediatría».
2. Al elegir las 10:30, se abre la página del médico con el servicio, la sede y la hora marcados, y baja sola a «Confirma tu cita».

También en local:

- «presión alta» se interpreta como Hipertensión.
- La página «Cardiología en Ciudad de México» muestra la lista ordenada por disponibilidad.
- En móvil (375 px) no hay desplazamiento horizontal.

En producción:

- La API responde y `/directorio/no-existe` da 404.
- El directorio está vacío porque ninguna clínica ha activado su participación.
