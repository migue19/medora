# Revisión de la NOM-024-SSA3-2012 (expediente clínico electrónico)

Revisión técnica de Medora frente a los lineamientos de la NOM-024-SSA3-2012 («Sistemas de información de registro electrónico para la salud. Intercambio de información en salud») y su relación con la NOM-004-SSA3-2012 (expediente clínico). Es una guía de diseño para la interoperabilidad futura, **no una opinión legal ni una certificación**. Antes de integrarse con instituciones públicas conviene validarla con un asesor regulatorio y con la DGIS.

## Estado actual (Sprint 11)

| Tema | Qué pide (en resumen) | En Medora | Pendiente |
|---|---|---|---|
| Identificación del paciente | Datos de identificación consistentes; CURP como identificador preferente | Nombre, teléfono y correo, más CURP opcional validada por formato | Hacer obligatoria la CURP si se integra con el sector público; validar contra RENAPO |
| Identificación del prestador | Datos del profesional y del establecimiento | Nombre, especialidad y cédula del médico en notas y recetas | Clave CLUES del establecimiento (sólo si la clínica la tiene) |
| Catálogos | Catálogos fundamentales de la DGIS (CIE-10, CIE-9-MC, medicamentos, etc.) | CIE-10 con 152 códigos frecuentes; se acepta cualquier código con formato válido | Catálogo CIE-10 completo de la DGIS; procedimientos CIE-9-MC; Cuadro Básico y Catálogo de Insumos para medicamentos |
| Contenido del expediente | Historia clínica, notas de evolución, resultados (NOM-004) | Historia clínica por secciones de la NOM-004, notas SOAP con signos vitales y diagnósticos, alergias, adjuntos y recetas | Hojas especiales (consentimientos firmados, referencia y contrarreferencia, interconsulta) |
| Integridad y autoría | Autor y fecha de cada registro; los registros no se alteran | La nota firmada y la receta emitida no cambian (disparadores en la base); las correcciones van en adenda; la historia guarda versiones | Firma electrónica avanzada (e.firma) en lugar de «usuario autenticado + fecha y hora» |
| Confidencialidad y acceso | Acceso según el rol y bitácora de accesos | Médico tratante y personal autorizado por el propietario; recepción sin acceso; bitácora de cada consulta, cambio, impresión e intento negado, que no se puede borrar ni modificar | Reportes periódicos de la bitácora para el responsable de datos personales |
| Seguridad | Cifrado y resguardo | HTTPS; adjuntos cifrados con AES-256-GCM; respaldos diarios de la base | Copia de respaldo fuera del servidor (pendiente general); rotación de la llave de cifrado |
| Conservación | Al menos 5 años (NOM-004) | Ningún registro clínico ni de la bitácora se puede borrar (disparadores en la base) | Política escrita de conservación y de baja después del plazo |
| Intercambio | Mensajería y documentos estándar (HL7) | No hay intercambio con otros sistemas | Exportar el expediente en HL7 CDA R2 o FHIR (por ejemplo, Patient, Encounter, Condition, AllergyIntolerance, MedicationRequest, Observation) |
| Certificación | Los sistemas que intercambian con el sector salud se certifican ante la DGIS | No aplica mientras Medora no intercambie información con terceros | Proceso de certificación si se integra con instituciones públicas o aseguradoras |

## Decisiones de diseño que facilitan la interoperabilidad

- Los diagnósticos se guardan como pares `{código CIE-10, descripción}`, sin texto libre mezclado, y se mapean directo a `Condition.code` de FHIR.
- Los signos vitales usan claves fijas con unidades definidas, y se mapean a `Observation` con códigos LOINC (por ejemplo, 8480-6 presión sistólica, 8462-4 diastólica, 8867-4 frecuencia cardiaca, 8310-5 temperatura, 29463-7 peso y 8302-2 talla).
- Las recetas guardan cada medicamento con dosis, vía, frecuencia y duración por separado, y se mapean a `MedicationRequest.dosageInstruction`.
- La bitácora registra quién, qué acción, sobre qué recurso, cuándo y desde qué IP, y se mapea a `AuditEvent`.

## Siguientes pasos sugeridos

1. Catálogo CIE-10 completo de la DGIS e inclusión de la CLUES de la clínica.
2. Exportar el expediente de un paciente en FHIR R4 (paquete JSON), útil también para atender el derecho de acceso del paciente (ARCO).
3. Firma electrónica avanzada de notas y recetas.
4. Recetas de medicamentos controlados: quedan fuera; requieren recetario especial con código de barras de COFEPRIS.
