-- Persistent HR employee store for the production dashboard.
-- This migration only adds new HR tables and indexes. Existing auth/Candidate
-- tables are intentionally left untouched.

CREATE TABLE "hr_employee_imports" (
  "id" BIGSERIAL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "generated_at" TIMESTAMPTZ,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "imported_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_preview" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "hr_employee_records" (
  "id" BIGSERIAL PRIMARY KEY,
  "record_key" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT,
  "source_file" TEXT,
  "row_number" INTEGER,
  "import_id" BIGINT REFERENCES "hr_employee_imports"("id") ON DELETE SET NULL,
  "local_user_id" BIGINT,
  "local_employee_account_id" BIGINT,
  "local_company_id" BIGINT,
  "local_role_id" BIGINT,
  "local_role_company_id" BIGINT,
  "local_role_assigned_at" TIMESTAMPTZ,
  "employee_code" TEXT,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "email_verified" BOOLEAN,
  "phone_verified" BOOLEAN,
  "designation" TEXT,
  "department" TEXT,
  "location" TEXT,
  "keywords" TEXT,
  "experience" DOUBLE PRECISION,
  "current_company" TEXT,
  "current_designation" TEXT,
  "cv_file_name" TEXT,
  "cv_stored_name" TEXT,
  "source_created_at" TIMESTAMPTZ,
  "source_updated_at" TIMESTAMPTZ,
  "source_payload" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "archived_at" TIMESTAMPTZ,
  CONSTRAINT "hr_employee_records_record_key_key" UNIQUE ("record_key"),
  CONSTRAINT "hr_employee_records_source_type_check"
    CHECK ("source_type" IN ('sqlite', 'imported', 'manual', 'upload'))
);

CREATE INDEX "hr_employee_records_source_type_idx"
  ON "hr_employee_records"("source_type");

CREATE INDEX "hr_employee_records_source_id_idx"
  ON "hr_employee_records"("source_id");

CREATE INDEX "hr_employee_records_local_user_id_idx"
  ON "hr_employee_records"("local_user_id");

CREATE INDEX "hr_employee_records_email_idx"
  ON "hr_employee_records"("email");

CREATE INDEX "hr_employee_records_email_lower_idx"
  ON "hr_employee_records"(LOWER("email"));

CREATE INDEX "hr_employee_records_phone_idx"
  ON "hr_employee_records"("phone");

CREATE INDEX "hr_employee_records_name_idx"
  ON "hr_employee_records"("name");
