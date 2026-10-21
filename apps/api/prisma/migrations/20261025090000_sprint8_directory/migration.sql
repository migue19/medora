
-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "directoryEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Doctor" ADD COLUMN     "searchText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "specialtyId" UUID;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "city" VARCHAR(80),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "neighborhood" VARCHAR(80),
ADD COLUMN     "postalCode" VARCHAR(10),
ADD COLUMN     "state" VARCHAR(60);

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "telemedicine" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Specialty" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Specialty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Condition" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Condition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConditionSpecialty" (
    "conditionId" UUID NOT NULL,
    "specialtyId" UUID NOT NULL,

    CONSTRAINT "ConditionSpecialty_pkey" PRIMARY KEY ("conditionId","specialtyId")
);

-- CreateTable
CREATE TABLE "DoctorCondition" (
    "doctorId" UUID NOT NULL,
    "conditionId" UUID NOT NULL,

    CONSTRAINT "DoctorCondition_pkey" PRIMARY KEY ("doctorId","conditionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Specialty_slug_key" ON "Specialty"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Condition_slug_key" ON "Condition"("slug");

-- CreateIndex
CREATE INDEX "DoctorCondition_conditionId_idx" ON "DoctorCondition"("conditionId");

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionSpecialty" ADD CONSTRAINT "ConditionSpecialty_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "Condition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionSpecialty" ADD CONSTRAINT "ConditionSpecialty_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "Specialty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorCondition" ADD CONSTRAINT "DoctorCondition_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorCondition" ADD CONSTRAINT "DoctorCondition_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "Condition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Extensiones de búsqueda: trigramas y sin acentos.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() no es IMMUTABLE; este envoltorio sí, para poder indexar.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE INDEX "Doctor_searchText_trgm" ON "Doctor" USING gin ("searchText" gin_trgm_ops);

ALTER TABLE "Location"
  ADD CONSTRAINT "Location_coordinates" CHECK (
    ("latitude" IS NULL) = ("longitude" IS NULL)
    AND ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180))
  );

-- Reservas que llegan desde el directorio.
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_channel";
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_channel" CHECK ("channel" IS NULL OR "channel" IN ('web', 'widget', 'google', 'instagram', 'directorio'));

-- Catálogo inicial.
INSERT INTO "Specialty" (id, slug, name, synonyms) VALUES
  (gen_random_uuid(), 'medicina-general', 'Medicina general', ARRAY['medico general','doctor general','consulta general','medico de cabecera']::text[]),
  (gen_random_uuid(), 'medicina-familiar', 'Medicina familiar', ARRAY['medico familiar','familiar']::text[]),
  (gen_random_uuid(), 'medicina-interna', 'Medicina interna', ARRAY['internista']::text[]),
  (gen_random_uuid(), 'pediatria', 'Pediatría', ARRAY['pediatra','ninos','niños','infantil','bebes']::text[]),
  (gen_random_uuid(), 'ginecologia-obstetricia', 'Ginecología y obstetricia', ARRAY['ginecologia','ginecologo','gineco','obstetra','obstetricia','embarazo']::text[]),
  (gen_random_uuid(), 'cardiologia', 'Cardiología', ARRAY['cardiologo','corazon']::text[]),
  (gen_random_uuid(), 'dermatologia', 'Dermatología', ARRAY['dermatologo','piel']::text[]),
  (gen_random_uuid(), 'endocrinologia', 'Endocrinología', ARRAY['endocrinologo','endocrino','hormonas','tiroides']::text[]),
  (gen_random_uuid(), 'gastroenterologia', 'Gastroenterología', ARRAY['gastroenterologo','gastro','estomago','digestivo']::text[]),
  (gen_random_uuid(), 'neurologia', 'Neurología', ARRAY['neurologo']::text[]),
  (gen_random_uuid(), 'neumologia', 'Neumología', ARRAY['neumologo','pulmones','respiratorio']::text[]),
  (gen_random_uuid(), 'nefrologia', 'Nefrología', ARRAY['nefrologo','rinones','riñones']::text[]),
  (gen_random_uuid(), 'urologia', 'Urología', ARRAY['urologo']::text[]),
  (gen_random_uuid(), 'oftalmologia', 'Oftalmología', ARRAY['oftalmologo','ojos','vista']::text[]),
  (gen_random_uuid(), 'otorrinolaringologia', 'Otorrinolaringología', ARRAY['otorrino','oidos','nariz','garganta']::text[]),
  (gen_random_uuid(), 'traumatologia-ortopedia', 'Traumatología y ortopedia', ARRAY['traumatologo','ortopedista','ortopedia','huesos','traumatologia']::text[]),
  (gen_random_uuid(), 'reumatologia', 'Reumatología', ARRAY['reumatologo','articulaciones']::text[]),
  (gen_random_uuid(), 'psiquiatria', 'Psiquiatría', ARRAY['psiquiatra','salud mental']::text[]),
  (gen_random_uuid(), 'psicologia', 'Psicología', ARRAY['psicologo','terapia','terapeuta']::text[]),
  (gen_random_uuid(), 'nutricion', 'Nutrición', ARRAY['nutriologo','nutriologa','nutricionista','dieta']::text[]),
  (gen_random_uuid(), 'odontologia', 'Odontología', ARRAY['dentista','odontologo','dental','dientes']::text[]),
  (gen_random_uuid(), 'ortodoncia', 'Ortodoncia', ARRAY['ortodoncista','brackets','frenos']::text[]),
  (gen_random_uuid(), 'cirugia-general', 'Cirugía general', ARRAY['cirujano']::text[]),
  (gen_random_uuid(), 'cirugia-plastica', 'Cirugía plástica y reconstructiva', ARRAY['cirujano plastico','estetica']::text[]),
  (gen_random_uuid(), 'oncologia', 'Oncología', ARRAY['oncologo','cancer']::text[]),
  (gen_random_uuid(), 'hematologia', 'Hematología', ARRAY['hematologo','sangre']::text[]),
  (gen_random_uuid(), 'infectologia', 'Infectología', ARRAY['infectologo']::text[]),
  (gen_random_uuid(), 'geriatria', 'Geriatría', ARRAY['geriatra','adultos mayores']::text[]),
  (gen_random_uuid(), 'alergologia', 'Alergología e inmunología', ARRAY['alergologo','alergias','inmunologia']::text[]),
  (gen_random_uuid(), 'angiologia', 'Angiología y cirugía vascular', ARRAY['angiologo','vascular','venas']::text[]),
  (gen_random_uuid(), 'neurocirugia', 'Neurocirugía', ARRAY['neurocirujano']::text[]),
  (gen_random_uuid(), 'medicina-deporte', 'Medicina del deporte', ARRAY['deportiva','medico del deporte']::text[]),
  (gen_random_uuid(), 'rehabilitacion', 'Medicina física y rehabilitación', ARRAY['rehabilitacion','fisiatra']::text[]),
  (gen_random_uuid(), 'fisioterapia', 'Fisioterapia', ARRAY['fisioterapeuta','terapia fisica']::text[]),
  (gen_random_uuid(), 'coloproctologia', 'Coloproctología', ARRAY['proctologo','coloproctologo']::text[]),
  (gen_random_uuid(), 'audiologia', 'Audiología', ARRAY['audiologo','audicion']::text[]);
INSERT INTO "Condition" (id, slug, name, synonyms) VALUES
  (gen_random_uuid(), 'chequeo-general', 'Chequeo general', ARRAY['revision general','check up','certificado medico']::text[]),
  (gen_random_uuid(), 'diabetes', 'Diabetes', ARRAY['azucar alta','glucosa alta']::text[]),
  (gen_random_uuid(), 'hipertension', 'Hipertensión', ARRAY['presion alta','presion arterial alta']::text[]),
  (gen_random_uuid(), 'colesterol-alto', 'Colesterol alto', ARRAY['dislipidemia','trigliceridos altos']::text[]),
  (gen_random_uuid(), 'obesidad', 'Obesidad y sobrepeso', ARRAY['sobrepeso','bajar de peso']::text[]),
  (gen_random_uuid(), 'hipotiroidismo', 'Hipotiroidismo', ARRAY['tiroides','hipertiroidismo']::text[]),
  (gen_random_uuid(), 'arritmias', 'Arritmias', ARRAY['palpitaciones']::text[]),
  (gen_random_uuid(), 'infarto', 'Prevención de infarto', ARRAY['dolor de pecho']::text[]),
  (gen_random_uuid(), 'acne', 'Acné', ARRAY['granos','barros']::text[]),
  (gen_random_uuid(), 'dermatitis', 'Dermatitis', ARRAY['eczema','ronchas']::text[]),
  (gen_random_uuid(), 'psoriasis', 'Psoriasis', ARRAY[]::text[]),
  (gen_random_uuid(), 'caida-cabello', 'Caída del cabello', ARRAY['alopecia']::text[]),
  (gen_random_uuid(), 'lunares', 'Revisión de lunares', ARRAY['manchas en la piel']::text[]),
  (gen_random_uuid(), 'gastritis', 'Gastritis', ARRAY['dolor de estomago','acidez']::text[]),
  (gen_random_uuid(), 'reflujo', 'Reflujo', ARRAY['agruras','reflujo gastroesofagico']::text[]),
  (gen_random_uuid(), 'colitis', 'Colitis', ARRAY['colon irritable','inflamacion intestinal']::text[]),
  (gen_random_uuid(), 'higado-graso', 'Hígado graso', ARRAY['higado']::text[]),
  (gen_random_uuid(), 'hemorroides', 'Hemorroides', ARRAY['almorranas']::text[]),
  (gen_random_uuid(), 'migrana', 'Migraña', ARRAY['dolor de cabeza','cefalea','jaqueca']::text[]),
  (gen_random_uuid(), 'epilepsia', 'Epilepsia', ARRAY['convulsiones']::text[]),
  (gen_random_uuid(), 'vertigo', 'Vértigo y mareos', ARRAY['mareo']::text[]),
  (gen_random_uuid(), 'ansiedad', 'Ansiedad', ARRAY['estres','ataques de panico']::text[]),
  (gen_random_uuid(), 'depresion', 'Depresión', ARRAY['tristeza']::text[]),
  (gen_random_uuid(), 'insomnio', 'Insomnio', ARRAY['no puedo dormir','sueno']::text[]),
  (gen_random_uuid(), 'tdah', 'TDAH', ARRAY['deficit de atencion','hiperactividad']::text[]),
  (gen_random_uuid(), 'terapia-pareja', 'Terapia de pareja', ARRAY['problemas de pareja']::text[]),
  (gen_random_uuid(), 'asma', 'Asma', ARRAY['falta de aire']::text[]),
  (gen_random_uuid(), 'alergias', 'Alergias', ARRAY['rinitis alergica']::text[]),
  (gen_random_uuid(), 'tos-cronica', 'Tos crónica', ARRAY['tos']::text[]),
  (gen_random_uuid(), 'control-prenatal', 'Control prenatal', ARRAY['embarazo','embarazada']::text[]),
  (gen_random_uuid(), 'papanicolaou', 'Papanicolaou', ARRAY['citologia','vph']::text[]),
  (gen_random_uuid(), 'menopausia', 'Menopausia', ARRAY['climaterio','bochornos']::text[]),
  (gen_random_uuid(), 'infertilidad', 'Infertilidad', ARRAY['fertilidad','quiero embarazarme']::text[]),
  (gen_random_uuid(), 'anticonceptivos', 'Anticonceptivos', ARRAY['planificacion familiar','diu']::text[]),
  (gen_random_uuid(), 'control-nino-sano', 'Control del niño sano', ARRAY['crecimiento','desarrollo infantil','peso del bebe']::text[]),
  (gen_random_uuid(), 'vacunacion', 'Vacunación', ARRAY['vacunas']::text[]),
  (gen_random_uuid(), 'infeccion-urinaria', 'Infección urinaria', ARRAY['cistitis','ardor al orinar']::text[]),
  (gen_random_uuid(), 'calculos-renales', 'Cálculos renales', ARRAY['piedras en el rinon','litiasis']::text[]),
  (gen_random_uuid(), 'prostata', 'Próstata', ARRAY['antigeno prostatico']::text[]),
  (gen_random_uuid(), 'insuficiencia-renal', 'Insuficiencia renal', ARRAY['rinon','dialisis']::text[]),
  (gen_random_uuid(), 'cataratas', 'Cataratas', ARRAY[]::text[]),
  (gen_random_uuid(), 'glaucoma', 'Glaucoma', ARRAY['presion en el ojo']::text[]),
  (gen_random_uuid(), 'miopia', 'Miopía y lentes', ARRAY['lentes','astigmatismo','examen de la vista']::text[]),
  (gen_random_uuid(), 'sinusitis', 'Sinusitis', ARRAY['senos paranasales']::text[]),
  (gen_random_uuid(), 'otitis', 'Otitis', ARRAY['dolor de oido','infeccion de oido']::text[]),
  (gen_random_uuid(), 'amigdalitis', 'Amigdalitis', ARRAY['anginas','dolor de garganta']::text[]),
  (gen_random_uuid(), 'perdida-auditiva', 'Pérdida auditiva', ARRAY['sordera','aparatos auditivos']::text[]),
  (gen_random_uuid(), 'lumbalgia', 'Dolor de espalda', ARRAY['lumbalgia','ciatica']::text[]),
  (gen_random_uuid(), 'dolor-rodilla', 'Dolor de rodilla', ARRAY['menisco','ligamentos']::text[]),
  (gen_random_uuid(), 'esguince', 'Esguinces y fracturas', ARRAY['fractura','torcedura']::text[]),
  (gen_random_uuid(), 'lesiones-deportivas', 'Lesiones deportivas', ARRAY['lesion deportiva']::text[]),
  (gen_random_uuid(), 'artritis', 'Artritis', ARRAY['artrosis','dolor de articulaciones']::text[]),
  (gen_random_uuid(), 'lupus', 'Lupus', ARRAY[]::text[]),
  (gen_random_uuid(), 'osteoporosis', 'Osteoporosis', ARRAY[]::text[]),
  (gen_random_uuid(), 'rehabilitacion-fisica', 'Rehabilitación física', ARRAY['terapia fisica']::text[]),
  (gen_random_uuid(), 'varices', 'Várices', ARRAY['venas varicosas','arañas vasculares']::text[]),
  (gen_random_uuid(), 'anemia', 'Anemia', ARRAY[]::text[]),
  (gen_random_uuid(), 'caries', 'Caries', ARRAY['dolor de muela','muela']::text[]),
  (gen_random_uuid(), 'limpieza-dental', 'Limpieza dental', ARRAY['profilaxis']::text[]),
  (gen_random_uuid(), 'brackets', 'Brackets', ARRAY['frenos','alineadores']::text[]),
  (gen_random_uuid(), 'extraccion-dental', 'Extracción dental', ARRAY['muelas del juicio']::text[]),
  (gen_random_uuid(), 'hernia', 'Hernias', ARRAY['hernia inguinal','hernia umbilical']::text[]),
  (gen_random_uuid(), 'vesicula', 'Vesícula biliar', ARRAY['colecistitis','piedras en la vesicula']::text[]),
  (gen_random_uuid(), 'cancer-mama', 'Cáncer de mama', ARRAY['mastografia']::text[]),
  (gen_random_uuid(), 'demencia', 'Demencia y memoria', ARRAY['alzheimer','perdida de memoria']::text[]),
  (gen_random_uuid(), 'infecciones', 'Infecciones', ARRAY['fiebre']::text[]);
INSERT INTO "ConditionSpecialty" ("conditionId", "specialtyId")
SELECT c.id, s.id FROM (VALUES
  ('chequeo-general', 'medicina-general'),
  ('chequeo-general', 'medicina-familiar'),
  ('chequeo-general', 'medicina-interna'),
  ('diabetes', 'endocrinologia'),
  ('diabetes', 'medicina-interna'),
  ('diabetes', 'medicina-familiar'),
  ('hipertension', 'cardiologia'),
  ('hipertension', 'medicina-interna'),
  ('hipertension', 'medicina-familiar'),
  ('colesterol-alto', 'cardiologia'),
  ('colesterol-alto', 'medicina-interna'),
  ('colesterol-alto', 'endocrinologia'),
  ('obesidad', 'nutricion'),
  ('obesidad', 'endocrinologia'),
  ('hipotiroidismo', 'endocrinologia'),
  ('arritmias', 'cardiologia'),
  ('infarto', 'cardiologia'),
  ('acne', 'dermatologia'),
  ('dermatitis', 'dermatologia'),
  ('dermatitis', 'alergologia'),
  ('psoriasis', 'dermatologia'),
  ('caida-cabello', 'dermatologia'),
  ('lunares', 'dermatologia'),
  ('gastritis', 'gastroenterologia'),
  ('gastritis', 'medicina-general'),
  ('reflujo', 'gastroenterologia'),
  ('colitis', 'gastroenterologia'),
  ('colitis', 'coloproctologia'),
  ('higado-graso', 'gastroenterologia'),
  ('higado-graso', 'medicina-interna'),
  ('hemorroides', 'coloproctologia'),
  ('hemorroides', 'cirugia-general'),
  ('migrana', 'neurologia'),
  ('epilepsia', 'neurologia'),
  ('vertigo', 'neurologia'),
  ('vertigo', 'otorrinolaringologia'),
  ('ansiedad', 'psicologia'),
  ('ansiedad', 'psiquiatria'),
  ('depresion', 'psicologia'),
  ('depresion', 'psiquiatria'),
  ('insomnio', 'psiquiatria'),
  ('insomnio', 'neurologia'),
  ('tdah', 'psiquiatria'),
  ('tdah', 'pediatria'),
  ('tdah', 'psicologia'),
  ('terapia-pareja', 'psicologia'),
  ('asma', 'neumologia'),
  ('asma', 'alergologia'),
  ('asma', 'pediatria'),
  ('alergias', 'alergologia'),
  ('alergias', 'otorrinolaringologia'),
  ('tos-cronica', 'neumologia'),
  ('tos-cronica', 'medicina-general'),
  ('control-prenatal', 'ginecologia-obstetricia'),
  ('papanicolaou', 'ginecologia-obstetricia'),
  ('menopausia', 'ginecologia-obstetricia'),
  ('menopausia', 'endocrinologia'),
  ('infertilidad', 'ginecologia-obstetricia'),
  ('infertilidad', 'urologia'),
  ('anticonceptivos', 'ginecologia-obstetricia'),
  ('control-nino-sano', 'pediatria'),
  ('vacunacion', 'pediatria'),
  ('vacunacion', 'medicina-general'),
  ('infeccion-urinaria', 'urologia'),
  ('infeccion-urinaria', 'medicina-general'),
  ('infeccion-urinaria', 'nefrologia'),
  ('calculos-renales', 'urologia'),
  ('calculos-renales', 'nefrologia'),
  ('prostata', 'urologia'),
  ('insuficiencia-renal', 'nefrologia'),
  ('cataratas', 'oftalmologia'),
  ('glaucoma', 'oftalmologia'),
  ('miopia', 'oftalmologia'),
  ('sinusitis', 'otorrinolaringologia'),
  ('otitis', 'otorrinolaringologia'),
  ('otitis', 'pediatria'),
  ('amigdalitis', 'otorrinolaringologia'),
  ('amigdalitis', 'pediatria'),
  ('perdida-auditiva', 'audiologia'),
  ('perdida-auditiva', 'otorrinolaringologia'),
  ('lumbalgia', 'traumatologia-ortopedia'),
  ('lumbalgia', 'rehabilitacion'),
  ('lumbalgia', 'fisioterapia'),
  ('dolor-rodilla', 'traumatologia-ortopedia'),
  ('dolor-rodilla', 'medicina-deporte'),
  ('esguince', 'traumatologia-ortopedia'),
  ('lesiones-deportivas', 'medicina-deporte'),
  ('lesiones-deportivas', 'fisioterapia'),
  ('lesiones-deportivas', 'traumatologia-ortopedia'),
  ('artritis', 'reumatologia'),
  ('artritis', 'traumatologia-ortopedia'),
  ('lupus', 'reumatologia'),
  ('osteoporosis', 'reumatologia'),
  ('osteoporosis', 'geriatria'),
  ('osteoporosis', 'endocrinologia'),
  ('rehabilitacion-fisica', 'fisioterapia'),
  ('rehabilitacion-fisica', 'rehabilitacion'),
  ('varices', 'angiologia'),
  ('anemia', 'hematologia'),
  ('anemia', 'medicina-interna'),
  ('caries', 'odontologia'),
  ('limpieza-dental', 'odontologia'),
  ('brackets', 'ortodoncia'),
  ('extraccion-dental', 'odontologia'),
  ('hernia', 'cirugia-general'),
  ('vesicula', 'cirugia-general'),
  ('vesicula', 'gastroenterologia'),
  ('cancer-mama', 'oncologia'),
  ('cancer-mama', 'ginecologia-obstetricia'),
  ('demencia', 'geriatria'),
  ('demencia', 'neurologia'),
  ('infecciones', 'infectologia'),
  ('infecciones', 'medicina-general')
) AS v(c, s) JOIN "Condition" c ON c.slug = v.c JOIN "Specialty" s ON s.slug = v.s;

-- Índice del directorio por médico, mantenido por la base en cualquier alta o edición (panel, alta de
-- clínicas, seed): especialidad del catálogo, padecimientos del catálogo y texto de búsqueda normalizado.
CREATE OR REPLACE FUNCTION directory_norm(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT regexp_replace(f_unaccent(lower(trim($1))), '\s+', ' ', 'g') $$;

-- Ciudad o colonia como segmento de URL: «Benito Juárez» → «benito-juarez».
CREATE OR REPLACE FUNCTION directory_slug(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$ SELECT trim(both '-' from regexp_replace(directory_norm($1), '[^a-z0-9]+', '-', 'g')) $$;

CREATE OR REPLACE FUNCTION doctor_directory_index() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT s.id INTO NEW."specialtyId" FROM "Specialty" s
  WHERE directory_norm(NEW.specialty) = directory_norm(s.name)
     OR directory_norm(NEW.specialty) = ANY (SELECT directory_norm(x) FROM unnest(s.synonyms) x)
  ORDER BY s.slug LIMIT 1;
  NEW."searchText" := directory_norm(concat_ws(' ',
    NEW."displayName", NEW.specialty, array_to_string(NEW.conditions, ' '),
    (SELECT concat_ws(' ', s.name, array_to_string(s.synonyms, ' ')) FROM "Specialty" s WHERE s.id = NEW."specialtyId"),
    (SELECT string_agg(concat_ws(' ', c.name, array_to_string(c.synonyms, ' ')), ' ') FROM "Condition" c
      WHERE EXISTS (SELECT 1 FROM unnest(NEW.conditions) t
                    WHERE directory_norm(t) = directory_norm(c.name)
                       OR directory_norm(t) = ANY (SELECT directory_norm(x) FROM unnest(c.synonyms) x)))
  ));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION doctor_directory_conditions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "DoctorCondition" WHERE "doctorId" = NEW.id;
  INSERT INTO "DoctorCondition" ("doctorId", "conditionId")
  SELECT DISTINCT NEW.id, c.id FROM unnest(NEW.conditions) t, "Condition" c
  WHERE directory_norm(t) = directory_norm(c.name)
     OR directory_norm(t) = ANY (SELECT directory_norm(x) FROM unnest(c.synonyms) x);
  RETURN NULL;
END $$;

CREATE TRIGGER "Doctor_directory_index" BEFORE INSERT OR UPDATE OF "displayName", specialty, conditions ON "Doctor"
  FOR EACH ROW EXECUTE FUNCTION doctor_directory_index();
CREATE TRIGGER "Doctor_directory_conditions" AFTER INSERT OR UPDATE OF conditions ON "Doctor"
  FOR EACH ROW EXECUTE FUNCTION doctor_directory_conditions();

-- Médicos existentes.
UPDATE "Doctor" SET conditions = conditions;
