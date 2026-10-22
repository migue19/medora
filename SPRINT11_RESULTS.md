# Resultados de verificación · Sprint 11

Fecha: 22 de octubre de 2026. Entorno: macOS, Node 24, PostgreSQL 17 local.

| Verificación | Resultado |
|---|---|
| `npm run typecheck` (API + web) | OK |
| Pruebas unitarias | 16/16 |
| Pruebas de integración con PostgreSQL real (base creada desde cero) | 76/76 (72 anteriores + 4 nuevas) |
| `npm run build` (API + Next.js) | OK |
| Navegador (local) | El médico abre el expediente desde la cita, registra signos vitales y SOAP, busca y agrega un diagnóstico CIE-10, firma, emite la receta; la bitácora muestra cada acción; la verificación pública muestra la receta auténtica |
| Receta en PDF | Revisada visualmente: encabezado, médico con cédula, paciente con edad y sexo, alergias en rojo, signos vitales, diagnóstico, medicamentos, indicaciones, QR y firma |

## Qué se entregó

- **Historia clínica** por secciones de la NOM-004:
  - Antecedentes heredofamiliares, personales patológicos y no patológicos, y gineco-obstétricos.
  - Padecimiento actual, interrogatorio por aparatos y sistemas, exploración física, estudios, diagnósticos, pronóstico e indicación terapéutica.
  - Fecha de nacimiento, sexo, grupo sanguíneo y CURP (validada).
  - Cada cambio queda como versión.
- **Alergias** con gravedad; se descartan, no se borran. Aparecen en el encabezado del expediente y en la receta.
- **Notas de evolución SOAP:**
  - Signos vitales con rangos válidos e IMC calculado, y hasta 10 diagnósticos CIE-10 (catálogo de 152 códigos frecuentes con búsqueda por código o nombre; también se admiten otros códigos con formato válido).
  - Borrador, firma y adendas. Una nota firmada no cambia, ni siquiera directo en la base.
- **Recetas:**
  - Hasta 15 medicamentos con presentación, dosis, vía, frecuencia, duración e indicaciones.
  - PDF con QR y código de 10 caracteres; verificación pública que muestra sólo las iniciales del paciente; anulación con motivo (sólo quien la emitió).
  - Una vez emitida, la base no deja modificarla.
- **Adjuntos cifrados** (AES-256-GCM): se valida el tipo real (PDF, JPG o PNG) y el tamaño (hasta 10 MB); en la base sólo hay texto cifrado.
- **Control de acceso:**
  - Ven el expediente el médico tratante (con citas o notas del paciente) y quien el propietario autorice; recepción nunca.
  - Sólo un médico escribe. El propietario o la administración pueden tener perfil de médico.
- **Bitácora:** consulta, cambios, firma, receta, impresión, anulación, carga y descarga de archivos, consulta de la bitácora e intentos negados. Se ve por expediente y para toda la clínica (sólo el propietario). La base no deja borrarla ni modificarla.
- **Retención:** la base rechaza borrar cualquier registro clínico. Al fusionar fichas de paciente, el expediente se mueve completo; si ambas tienen historia clínica, la fusión se detiene.
- **Accesos al expediente:** desde la agenda («Expediente clínico»), la ficha del paciente y la videoconsulta («Documentar en el expediente»).
- **Revisión de la NOM-024:** en `docs/NOM-024-revision.md`, con lo que ya cumple, lo pendiente y el mapeo a FHIR, LOINC y CIE-10 para la interoperabilidad futura.
- **Correcciones de paso:** la ventana del PDF se abre al hacer clic (si no, el navegador la bloqueaba como ventana emergente), y el propietario o la administración pueden vincularse a un perfil de médico.

## Cobertura de integración nueva

- **Acceso:**
  - Recepción, otro médico y el propietario sin autorización reciben 403, y cada intento queda en la bitácora.
  - El médico tratante lee y escribe; el propietario autorizado sólo lee.
  - Recepción no puede recibir acceso; sólo el propietario autoriza.
  - Bitácora completa en orden y vista de toda la clínica sólo para el propietario.
  - La bitácora no se puede borrar ni alterar en la base.
- **Historia y notas:**
  - CURP inválida (400); dos versiones de la historia; secciones desconocidas ignoradas.
  - Alergia descartada; signos fuera de rango, código CIE-10 inválido o cita ajena dan 400.
  - Otro médico no edita (403); firmada, la API responde 409 y la base rechaza cambios y borrado; la adenda sí se permite.
  - Búsqueda CIE-10 por nombre y por código, cerrada a recepción.
- **Recetas:**
  - Sin medicamentos da 400; código de 10 caracteres; el PDF es válido.
  - La verificación pública muestra iniciales y cédula, sin alergias ni diagnóstico, y da 404 si no existe.
  - Inmutable en la base; sólo quien la emitió la anula; anulada, aparece así en la verificación; queda en la bitácora.
- **Adjuntos:**
  - Cifrado en la base y descarga íntegra; tipo no permitido da 400; recepción recibe 403.
  - No se pueden modificar en la base; quedan en la bitácora.
