-- Search-ready HR employee resume schema for PostgreSQL/AlloyDB.
-- Resume binaries stay in file/object storage; PostgreSQL stores metadata,
-- extracted text, normalized skills, and indexes for fast search.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS "hr_employee_resumes" (
  "id" BIGSERIAL PRIMARY KEY,
  "employee_record_id" BIGINT NOT NULL REFERENCES "hr_employee_records"("id") ON DELETE CASCADE,
  "file_name" TEXT,
  "file_path" TEXT,
  "file_url" TEXT,
  "storage_provider" TEXT NOT NULL DEFAULT 'local',
  "storage_key" TEXT,
  "extracted_text" TEXT,
  "is_latest" BOOLEAN NOT NULL DEFAULT TRUE,
  "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "search_vector" TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("extracted_text", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("file_name", '')), 'D')
  ) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS "hr_employee_resumes_latest_unique"
  ON "hr_employee_resumes"("employee_record_id")
  WHERE "is_latest" = TRUE;

CREATE INDEX IF NOT EXISTS "hr_employee_resumes_employee_idx"
  ON "hr_employee_resumes"("employee_record_id");

CREATE INDEX IF NOT EXISTS "hr_employee_resumes_uploaded_idx"
  ON "hr_employee_resumes"("uploaded_at" DESC);

CREATE INDEX IF NOT EXISTS "hr_employee_resumes_search_vector_idx"
  ON "hr_employee_resumes" USING GIN ("search_vector");

CREATE TABLE IF NOT EXISTS "skills" (
  "id" BIGSERIAL PRIMARY KEY,
  "skill_name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "skills_normalized_name_key" UNIQUE ("normalized_name")
);

CREATE INDEX IF NOT EXISTS "skills_name_trgm_idx"
  ON "skills" USING GIN (LOWER("skill_name") gin_trgm_ops);

CREATE TABLE IF NOT EXISTS "employee_skills" (
  "id" BIGSERIAL PRIMARY KEY,
  "employee_record_id" BIGINT NOT NULL REFERENCES "hr_employee_records"("id") ON DELETE CASCADE,
  "skill_id" BIGINT NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
  "resume_id" BIGINT REFERENCES "hr_employee_resumes"("id") ON DELETE SET NULL,
  "years_of_experience" DOUBLE PRECISION,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_skills_employee_skill_resume_unique"
  ON "employee_skills"("employee_record_id", "skill_id", COALESCE("resume_id", 0));

CREATE INDEX IF NOT EXISTS "employee_skills_employee_idx"
  ON "employee_skills"("employee_record_id");

CREATE INDEX IF NOT EXISTS "employee_skills_skill_idx"
  ON "employee_skills"("skill_id");

CREATE INDEX IF NOT EXISTS "employee_skills_resume_idx"
  ON "employee_skills"("resume_id");

CREATE INDEX IF NOT EXISTS "hr_employee_records_name_trgm_idx"
  ON "hr_employee_records" USING GIN (LOWER("name") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "hr_employee_records_designation_trgm_idx"
  ON "hr_employee_records" USING GIN (LOWER("designation") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "hr_employee_records_department_trgm_idx"
  ON "hr_employee_records" USING GIN (LOWER("department") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "hr_employee_records_latest_filters_idx"
  ON "hr_employee_records"("archived_at", "source_type", "department", "designation");

INSERT INTO "hr_employee_resumes" (
  "employee_record_id", "file_name", "file_path", "storage_provider", "storage_key", "is_latest", "uploaded_at"
)
SELECT
  employee."id",
  employee."cv_file_name",
  employee."cv_stored_name",
  CASE WHEN employee."resume_s3_key" IS NULL THEN 'local' ELSE 's3' END,
  COALESCE(employee."resume_s3_key", employee."cv_stored_name"),
  TRUE,
  COALESCE(employee."source_updated_at", employee."updated_at", employee."created_at", NOW())
FROM "hr_employee_records" employee
WHERE (employee."cv_file_name" IS NOT NULL OR employee."cv_stored_name" IS NOT NULL OR employee."resume_s3_key" IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1
    FROM "hr_employee_resumes" resume
    WHERE resume."employee_record_id" = employee."id" AND resume."is_latest" = TRUE
  );

WITH skill_source AS (
  SELECT DISTINCT
    initcap(trim(raw_skill)) AS skill_name,
    lower(regexp_replace(trim(raw_skill), '\s+', ' ', 'g')) AS normalized_name
  FROM "hr_employee_records" employee
  CROSS JOIN LATERAL regexp_split_to_table(coalesce(employee."keywords", ''), '[,;|/\n]+') AS raw_skill
  WHERE trim(raw_skill) <> ''
)
INSERT INTO "skills" ("skill_name", "normalized_name")
SELECT skill_name, normalized_name
FROM skill_source
WHERE normalized_name <> ''
ON CONFLICT ("normalized_name") DO NOTHING;

WITH employee_skill_source AS (
  SELECT DISTINCT
    employee."id" AS employee_record_id,
    skill."id" AS skill_id,
    latest_resume."id" AS resume_id
  FROM "hr_employee_records" employee
  CROSS JOIN LATERAL regexp_split_to_table(coalesce(employee."keywords", ''), '[,;|/\n]+') AS raw_skill
  JOIN "skills" skill
    ON skill."normalized_name" = lower(regexp_replace(trim(raw_skill), '\s+', ' ', 'g'))
  LEFT JOIN LATERAL (
    SELECT resume."id"
    FROM "hr_employee_resumes" resume
    WHERE resume."employee_record_id" = employee."id" AND resume."is_latest" = TRUE
    ORDER BY resume."uploaded_at" DESC, resume."id" DESC
    LIMIT 1
  ) latest_resume ON TRUE
  WHERE trim(raw_skill) <> ''
)
INSERT INTO "employee_skills" ("employee_record_id", "skill_id", "resume_id")
SELECT employee_record_id, skill_id, resume_id
FROM employee_skill_source
ON CONFLICT DO NOTHING;
