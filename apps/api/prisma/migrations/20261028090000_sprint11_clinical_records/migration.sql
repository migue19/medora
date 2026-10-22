-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "clinicalAccess" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClinicalProfile" (
    "clinicPatientId" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "birthDate" DATE,
    "sex" VARCHAR(1),
    "curp" VARCHAR(18),
    "bloodType" VARCHAR(3),
    "history" JSONB NOT NULL DEFAULT '{}',
    "updatedById" UUID,
    "updatedByName" VARCHAR(120),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClinicalProfile_pkey" PRIMARY KEY ("clinicPatientId")
);

-- CreateTable
CREATE TABLE "ClinicalHistoryVersion" (
    "id" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "authorId" UUID NOT NULL,
    "authorName" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalHistoryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergy" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "substance" VARCHAR(120) NOT NULL,
    "reaction" VARCHAR(200),
    "severity" VARCHAR(10) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "recordedById" UUID NOT NULL,
    "recordedByName" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Allergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalNote" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "appointmentId" UUID,
    "doctorId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "authorName" VARCHAR(120) NOT NULL,
    "subjective" TEXT NOT NULL DEFAULT '',
    "objective" TEXT NOT NULL DEFAULT '',
    "assessment" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT '',
    "vitals" JSONB NOT NULL DEFAULT '{}',
    "diagnoses" JSONB NOT NULL DEFAULT '[]',
    "amendsId" UUID,
    "signedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClinicalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "noteId" UUID,
    "doctorId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "items" JSONB NOT NULL,
    "instructions" VARCHAR(2000),
    "diagnosis" VARCHAR(500),
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" VARCHAR(200),

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalFile" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "noteId" UUID,
    "filename" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL,
    "iv" BYTEA NOT NULL,
    "tag" BYTEA NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" UUID NOT NULL,
    "uploadedByName" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalAccessLog" (
    "id" UUID NOT NULL,
    "clinicId" UUID NOT NULL,
    "clinicPatientId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userName" VARCHAR(120) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "resourceId" UUID,
    "ip" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Icd10" (
    "code" VARCHAR(10) NOT NULL,
    "description" VARCHAR(255) NOT NULL,

    CONSTRAINT "Icd10_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "ClinicalHistoryVersion_clinicPatientId_createdAt_idx" ON "ClinicalHistoryVersion"("clinicPatientId", "createdAt");

-- CreateIndex
CREATE INDEX "Allergy_clinicPatientId_idx" ON "Allergy"("clinicPatientId");

-- CreateIndex
CREATE INDEX "ClinicalNote_clinicPatientId_createdAt_idx" ON "ClinicalNote"("clinicPatientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalNote_appointmentId_idx" ON "ClinicalNote"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_code_key" ON "Prescription"("code");

-- CreateIndex
CREATE INDEX "Prescription_clinicPatientId_issuedAt_idx" ON "Prescription"("clinicPatientId", "issuedAt");

-- CreateIndex
CREATE INDEX "ClinicalFile_clinicPatientId_createdAt_idx" ON "ClinicalFile"("clinicPatientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalAccessLog_clinicPatientId_createdAt_idx" ON "ClinicalAccessLog"("clinicPatientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalAccessLog_clinicId_createdAt_idx" ON "ClinicalAccessLog"("clinicId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClinicalProfile" ADD CONSTRAINT "ClinicalProfile_clinicPatientId_fkey" FOREIGN KEY ("clinicPatientId") REFERENCES "ClinicPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalHistoryVersion" ADD CONSTRAINT "ClinicalHistoryVersion_clinicPatientId_fkey" FOREIGN KEY ("clinicPatientId") REFERENCES "ClinicalProfile"("clinicPatientId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_clinicPatientId_fkey" FOREIGN KEY ("clinicPatientId") REFERENCES "ClinicPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_clinicPatientId_fkey" FOREIGN KEY ("clinicPatientId") REFERENCES "ClinicPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_clinicPatientId_fkey" FOREIGN KEY ("clinicPatientId") REFERENCES "ClinicPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ClinicalNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalFile" ADD CONSTRAINT "ClinicalFile_clinicPatientId_fkey" FOREIGN KEY ("clinicPatientId") REFERENCES "ClinicPatient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Permisos y datos mínimos.
ALTER TABLE "ClinicalProfile"
  ADD CONSTRAINT "ClinicalProfile_sex" CHECK ("sex" IS NULL OR "sex" IN ('F', 'M', 'X')),
  ADD CONSTRAINT "ClinicalProfile_curp" CHECK ("curp" IS NULL OR "curp" ~ '^[A-Z][AEIOUX][A-Z]{2}[0-9]{6}[HMX][A-Z]{5}[0-9A-Z][0-9]$');
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_severity" CHECK ("severity" IN ('LEVE', 'MODERADA', 'GRAVE'));
ALTER TABLE "ClinicalFile" ADD CONSTRAINT "ClinicalFile_size" CHECK ("size" > 0 AND "size" <= 10485760);
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_void" CHECK (("voidedAt" IS NULL) = ("voidReason" IS NULL));

-- Retención (NOM-004: al menos 5 años): ningún registro clínico ni de la bitácora se borra.
CREATE OR REPLACE FUNCTION clinical_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los registros del expediente clínico no se pueden borrar (%).', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER "ClinicalNote_no_delete" BEFORE DELETE ON "ClinicalNote" FOR EACH ROW EXECUTE FUNCTION clinical_no_delete();
CREATE TRIGGER "Prescription_no_delete" BEFORE DELETE ON "Prescription" FOR EACH ROW EXECUTE FUNCTION clinical_no_delete();
CREATE TRIGGER "ClinicalFile_no_delete" BEFORE DELETE ON "ClinicalFile" FOR EACH ROW EXECUTE FUNCTION clinical_no_delete();
CREATE TRIGGER "Allergy_no_delete" BEFORE DELETE ON "Allergy" FOR EACH ROW EXECUTE FUNCTION clinical_no_delete();
CREATE TRIGGER "ClinicalProfile_no_delete" BEFORE DELETE ON "ClinicalProfile" FOR EACH ROW EXECUTE FUNCTION clinical_no_delete();
CREATE TRIGGER "ClinicalHistoryVersion_no_delete" BEFORE DELETE ON "ClinicalHistoryVersion" FOR EACH ROW EXECUTE FUNCTION clinical_no_delete();
CREATE TRIGGER "ClinicalAccessLog_no_delete" BEFORE DELETE ON "ClinicalAccessLog" FOR EACH ROW EXECUTE FUNCTION clinical_no_delete();

-- La bitácora y las versiones de la historia sólo se agregan; los archivos no cambian (salvo al fusionar fichas).
CREATE OR REPLACE FUNCTION clinical_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'clinicPatientId') IS DISTINCT FROM (to_jsonb(OLD) - 'clinicPatientId') THEN
    RAISE EXCEPTION '% no se puede modificar.', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClinicalAccessLog_append_only" BEFORE UPDATE ON "ClinicalAccessLog" FOR EACH ROW EXECUTE FUNCTION clinical_append_only();
CREATE TRIGGER "ClinicalHistoryVersion_append_only" BEFORE UPDATE ON "ClinicalHistoryVersion" FOR EACH ROW EXECUTE FUNCTION clinical_append_only();
CREATE TRIGGER "ClinicalFile_append_only" BEFORE UPDATE ON "ClinicalFile" FOR EACH ROW EXECUTE FUNCTION clinical_append_only();

-- Nota firmada: su contenido ya no cambia (las correcciones van en una adenda).
CREATE OR REPLACE FUNCTION clinical_note_signed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."signedAt" IS NOT NULL AND
     (to_jsonb(NEW) - 'clinicPatientId' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'clinicPatientId' - 'updatedAt') THEN
    RAISE EXCEPTION 'La nota ya está firmada: agrega una adenda.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ClinicalNote_signed" BEFORE UPDATE ON "ClinicalNote" FOR EACH ROW EXECUTE FUNCTION clinical_note_signed();

-- Receta emitida: sólo se puede anular (y moverse al fusionar fichas).
CREATE OR REPLACE FUNCTION prescription_issued() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'clinicPatientId' - 'voidedAt' - 'voidReason') IS DISTINCT FROM (to_jsonb(OLD) - 'clinicPatientId' - 'voidedAt' - 'voidReason')
     OR (OLD."voidedAt" IS NOT NULL AND NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt") THEN
    RAISE EXCEPTION 'La receta ya se emitió: sólo se puede anular.' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Prescription_issued" BEFORE UPDATE ON "Prescription" FOR EACH ROW EXECUTE FUNCTION prescription_issued();

-- Catálogo CIE-10: códigos frecuentes en consulta externa.
INSERT INTO "Icd10" (code, description) VALUES
  ('A09', 'Diarrea y gastroenteritis de presunto origen infeccioso'),
  ('A09.0', 'Otras gastroenteritis y colitis no especificadas de origen infeccioso'),
  ('B01.9', 'Varicela sin complicaciones'),
  ('B02.9', 'Herpes zóster sin complicaciones'),
  ('B35.1', 'Tiña de las uñas'),
  ('B35.3', 'Tiña del pie'),
  ('B37.3', 'Candidiasis de la vulva y de la vagina'),
  ('B86', 'Escabiosis'),
  ('D50.9', 'Anemia por deficiencia de hierro, sin otra especificación'),
  ('D64.9', 'Anemia de tipo no especificado'),
  ('E03.9', 'Hipotiroidismo, no especificado'),
  ('E05.9', 'Tirotoxicosis, no especificada'),
  ('E10.9', 'Diabetes mellitus tipo 1 sin mención de complicación'),
  ('E11.9', 'Diabetes mellitus tipo 2 sin mención de complicación'),
  ('E11.6', 'Diabetes mellitus tipo 2 con otras complicaciones especificadas'),
  ('E11.4', 'Diabetes mellitus tipo 2 con complicaciones neurológicas'),
  ('E11.2', 'Diabetes mellitus tipo 2 con complicaciones renales'),
  ('E11.3', 'Diabetes mellitus tipo 2 con complicaciones oftálmicas'),
  ('E28.2', 'Síndrome de ovario poliquístico'),
  ('E55.9', 'Deficiencia de vitamina D, no especificada'),
  ('E66.9', 'Obesidad, no especificada'),
  ('E78.0', 'Hipercolesterolemia pura'),
  ('E78.1', 'Hipergliceridemia pura'),
  ('E78.2', 'Hiperlipidemia mixta'),
  ('E78.5', 'Hiperlipidemia, no especificada'),
  ('E79.0', 'Hiperuricemia sin signos de artritis inflamatoria'),
  ('E86', 'Depleción del volumen'),
  ('F10.2', 'Trastornos mentales y del comportamiento debidos al uso de alcohol: síndrome de dependencia'),
  ('F17.2', 'Trastornos mentales y del comportamiento debidos al uso de tabaco: síndrome de dependencia'),
  ('F32.9', 'Episodio depresivo, no especificado'),
  ('F33.9', 'Trastorno depresivo recurrente, no especificado'),
  ('F41.0', 'Trastorno de pánico [ansiedad paroxística episódica]'),
  ('F41.1', 'Trastorno de ansiedad generalizada'),
  ('F41.2', 'Trastorno mixto de ansiedad y depresión'),
  ('F41.9', 'Trastorno de ansiedad, no especificado'),
  ('F43.2', 'Trastornos de adaptación'),
  ('F51.0', 'Insomnio no orgánico'),
  ('F90.0', 'Perturbación de la actividad y de la atención'),
  ('G43.9', 'Migraña, no especificada'),
  ('G44.2', 'Cefalea debida a tensión'),
  ('G47.0', 'Trastornos del inicio y del mantenimiento del sueño [insomnios]'),
  ('G47.3', 'Apnea del sueño'),
  ('G56.0', 'Síndrome del túnel carpiano'),
  ('G40.9', 'Epilepsia, tipo no especificado'),
  ('H10.9', 'Conjuntivitis, no especificada'),
  ('H52.1', 'Miopía'),
  ('H60.9', 'Otitis externa, sin otra especificación'),
  ('H65.9', 'Otitis media no supurativa, sin otra especificación'),
  ('H66.9', 'Otitis media, no especificada'),
  ('H81.1', 'Vértigo paroxístico benigno'),
  ('I10', 'Hipertensión esencial (primaria)'),
  ('I11.9', 'Enfermedad cardíaca hipertensiva sin insuficiencia cardíaca (congestiva)'),
  ('I20.9', 'Angina de pecho, no especificada'),
  ('I25.1', 'Enfermedad aterosclerótica del corazón'),
  ('I48', 'Fibrilación y aleteo auricular'),
  ('I49.9', 'Arritmia cardíaca, no especificada'),
  ('I50.9', 'Insuficiencia cardíaca, no especificada'),
  ('I63.9', 'Infarto cerebral, no especificado'),
  ('I83.9', 'Venas varicosas de los miembros inferiores sin úlcera ni inflamación'),
  ('I84.9', 'Hemorroides no especificadas, sin complicación'),
  ('J00', 'Rinofaringitis aguda [resfriado común]'),
  ('J01.9', 'Sinusitis aguda, no especificada'),
  ('J02.9', 'Faringitis aguda, no especificada'),
  ('J03.9', 'Amigdalitis aguda, no especificada'),
  ('J04.0', 'Laringitis aguda'),
  ('J06.9', 'Infección aguda de las vías respiratorias superiores, no especificada'),
  ('J11.1', 'Influenza con otras manifestaciones respiratorias, virus no identificado'),
  ('J18.9', 'Neumonía, no especificada'),
  ('J20.9', 'Bronquitis aguda, no especificada'),
  ('J21.9', 'Bronquiolitis aguda, no especificada'),
  ('J30.4', 'Rinitis alérgica, no especificada'),
  ('J32.9', 'Sinusitis crónica, no especificada'),
  ('J42', 'Bronquitis crónica no especificada'),
  ('J44.9', 'Enfermedad pulmonar obstructiva crónica, no especificada'),
  ('J45.9', 'Asma, no especificada'),
  ('K02.9', 'Caries dental, no especificada'),
  ('K21.9', 'Enfermedad del reflujo gastroesofágico sin esofagitis'),
  ('K25.9', 'Úlcera gástrica, no especificada como aguda ni crónica, sin hemorragia ni perforación'),
  ('K29.7', 'Gastritis, no especificada'),
  ('K30', 'Dispepsia'),
  ('K35.8', 'Apendicitis aguda, otra y la no especificada'),
  ('K40.9', 'Hernia inguinal unilateral o no especificada, sin obstrucción ni gangrena'),
  ('K58.9', 'Síndrome del colon irritable sin diarrea'),
  ('K59.0', 'Constipación'),
  ('K76.0', 'Degeneración grasa del hígado, no clasificada en otra parte'),
  ('K80.2', 'Cálculo de la vesícula biliar sin colecistitis'),
  ('K81.0', 'Colecistitis aguda'),
  ('L01.0', 'Impétigo [cualquier sitio anatómico] [cualquier organismo]'),
  ('L20.9', 'Dermatitis atópica, no especificada'),
  ('L23.9', 'Dermatitis alérgica de contacto, de causa no especificada'),
  ('L30.9', 'Dermatitis, no especificada'),
  ('L40.0', 'Psoriasis vulgar'),
  ('L50.9', 'Urticaria, no especificada'),
  ('L70.0', 'Acné vulgar'),
  ('L02.9', 'Absceso cutáneo, furúnculo y carbunco, de sitio no especificado'),
  ('L03.9', 'Celulitis de sitio no especificado'),
  ('M10.9', 'Gota, no especificada'),
  ('M17.9', 'Gonartrosis, no especificada'),
  ('M19.9', 'Artrosis, no especificada'),
  ('M25.5', 'Dolor en articulación'),
  ('M54.2', 'Cervicalgia'),
  ('M54.4', 'Lumbago con ciática'),
  ('M54.5', 'Lumbago no especificado'),
  ('M62.6', 'Distensión muscular'),
  ('M65.4', 'Tenosinovitis de estiloides radial [de Quervain]'),
  ('M75.1', 'Síndrome de manguito rotatorio'),
  ('M77.1', 'Epicondilitis lateral'),
  ('M79.1', 'Mialgia'),
  ('M79.7', 'Fibromialgia'),
  ('M81.9', 'Osteoporosis, no especificada'),
  ('N18.9', 'Enfermedad renal crónica, no especificada'),
  ('N20.0', 'Cálculo del riñón'),
  ('N30.0', 'Cistitis aguda'),
  ('N39.0', 'Infección de vías urinarias, sitio no especificado'),
  ('N40', 'Hiperplasia de la próstata'),
  ('N76.0', 'Vaginitis aguda'),
  ('N92.0', 'Menstruación excesiva y frecuente con ciclo regular'),
  ('N94.6', 'Dismenorrea, no especificada'),
  ('N95.1', 'Estados menopáusicos y climatéricos femeninos'),
  ('N97.9', 'Infertilidad femenina, no especificada'),
  ('O26.9', 'Complicación relacionada con el embarazo, no especificada'),
  ('O80', 'Parto único espontáneo'),
  ('R05', 'Tos'),
  ('R06.0', 'Disnea'),
  ('R10.4', 'Otros dolores abdominales y los no especificados'),
  ('R11', 'Náusea y vómito'),
  ('R42', 'Mareo y desvanecimiento'),
  ('R50.9', 'Fiebre, no especificada'),
  ('R51', 'Cefalea'),
  ('R53', 'Malestar y fatiga'),
  ('R07.4', 'Dolor en el pecho, no especificado'),
  ('R73.0', 'Anormalidades en la prueba de tolerancia a la glucosa'),
  ('S00.9', 'Traumatismo superficial de la cabeza, parte no especificada'),
  ('S06.0', 'Concusión'),
  ('S13.4', 'Esguince y torcedura de la columna cervical'),
  ('S52.5', 'Fractura de la epífisis inferior del radio'),
  ('S60.9', 'Traumatismo superficial de la muñeca y de la mano, no especificado'),
  ('S83.6', 'Esguince y torcedura de otras partes y las no especificadas de la rodilla'),
  ('S93.4', 'Esguince y torcedura del tobillo'),
  ('T14.0', 'Traumatismo superficial de región no especificada del cuerpo'),
  ('T78.4', 'Alergia no especificada'),
  ('Z00.0', 'Examen médico general'),
  ('Z00.1', 'Control de salud de rutina del niño'),
  ('Z01.4', 'Examen ginecológico (general) (de rutina)'),
  ('Z02.7', 'Extensión de certificado médico'),
  ('Z23', 'Necesidad de inmunización contra enfermedad bacteriana única'),
  ('Z30.0', 'Consejo y asesoramiento general sobre la anticoncepción'),
  ('Z34.9', 'Supervisión de embarazo normal no especificado'),
  ('Z39.2', 'Seguimiento postparto, de rutina'),
  ('Z71.3', 'Consulta para instrucción y vigilancia de la dieta'),
  ('Z76.0', 'Consulta para repetición de receta'),
  ('Z09.9', 'Examen de seguimiento consecutivo a tratamiento por afección no especificada');

