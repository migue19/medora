-- Sprint 6: URL pública por médico y canal de origen de las reservas en línea.

ALTER TABLE "Appointment" ADD COLUMN "channel" VARCHAR(20);
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_channel" CHECK ("channel" IS NULL OR "channel" IN ('web', 'widget', 'google', 'instagram'));

-- Slug a partir del nombre: minúsculas, sin acentos ni títulos, guiones; se numeran los repetidos por clínica.
ALTER TABLE "Doctor" ADD COLUMN "slug" VARCHAR(80);
WITH base AS (
  SELECT id, "clinicId",
    COALESCE(NULLIF(trim(BOTH '-' FROM left(regexp_replace(
      regexp_replace(translate(lower("displayName"), 'áàäâéèëêíìïîóòöôúùüûñç', 'aaaaeeeeiiiioooouuuunc'), '^(dra?|doctora?)\.?\s+', ''),
      '[^a-z0-9]+', '-', 'g'), 70)), ''), 'medico') AS s,
    "createdAt"
  FROM "Doctor"
), numbered AS (
  SELECT id, s, row_number() OVER (PARTITION BY "clinicId", s ORDER BY "createdAt", id) AS n FROM base
)
UPDATE "Doctor" d SET slug = CASE WHEN n.n = 1 THEN n.s ELSE n.s || '-' || n.n END FROM numbered n WHERE n.id = d.id;
ALTER TABLE "Doctor" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 2 AND 80);
CREATE UNIQUE INDEX "Doctor_clinicId_slug_key" ON "Doctor"("clinicId", "slug");
