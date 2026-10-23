# Evaluación: ¿app móvil nativa?

**Recomendación:** por ahora, seguir con la PWA (Medora instalada desde el navegador) y no publicar una app nativa. Conviene revisarlo cuando se cumpla alguno de los disparadores de abajo.

## Qué cubre hoy la PWA

| Necesidad | PWA de Medora |
|---|---|
| Instalar en el teléfono con icono propio | Sí (Android: «Instalar app»; iPhone: Compartir → «Agregar a inicio») |
| Avisos al personal (cita nueva, cancelación, paciente en la sala) | Sí, con Web Push. En iPhone requiere iOS 16.4 o posterior y la app agregada a inicio |
| Videoconsulta con cámara y micrófono | Sí (Daily en el navegador) |
| Funcionar sin conexión | Sólo la pantalla de «sin conexión». La agenda y el expediente necesitan red a propósito, para no dejar datos clínicos guardados en el teléfono |
| Actualizaciones | Inmediatas, sin pasar por las tiendas |
| Pagos (Stripe), reservas, expediente, recetas | Sí |

## Qué daría una app nativa

- Presencia en App Store y Google Play: confianza y descubrimiento para los pacientes.
- Avisos más confiables en iPhone sin tener que «agregar a inicio».
- Inicio de sesión con Face ID o huella. En la web existe con passkeys, una alternativa que se puede agregar sin app.
- Integración con el calendario y los contactos del teléfono, widgets y Apple Watch.

## Costos y riesgos

- Dos tiendas con revisiones. Apple exige que una app de salud justifique el manejo de datos sensibles, y las suscripciones vendidas dentro de iOS pueden pagar comisión de Apple. Las clínicas contratan por la web, así que se evita vendiendo fuera de la app.
- Mantener versiones antiguas instaladas compatibles con la API.
- Costo de las cuentas de desarrollador: Apple, 99 USD al año; Google, 25 USD una vez.

## Ruta sugerida si se decide hacerla

1. **Capacitor** sobre la misma aplicación web (Next.js): reutiliza el 90 % del código y agrega avisos nativos (APNs/FCM), Face ID y el calendario del teléfono. Es un proyecto de 2 a 4 semanas.
2. Primero, una app **para el personal** (agenda, avisos, videoconsulta, expediente). Los pacientes pueden seguir con la web y los enlaces de correo y WhatsApp.
3. La API pública v1 y los webhooks de este sprint ya sirven de base para cualquier cliente adicional.

## Disparadores para revisarlo

- Más de 30 % de las clínicas piden avisos en iPhone y no logran instalar la PWA.
- Las clínicas o sus pacientes piden la app en las tiendas como requisito.
- Se necesita acceso sin conexión al expediente, lo que exige cifrado local y un análisis de riesgo aparte.
