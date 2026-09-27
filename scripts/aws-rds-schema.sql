-- Talme HRMS AWS RDS PostgreSQL schema preparation.
-- Review before applying. Do not run against Neon production.

CREATE TABLE IF NOT EXISTS "Candidate" (
  "id" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "keywords" TEXT NOT NULL,
  "experience" DOUBLE PRECISION,
  "currentCompany" TEXT,
  "currentDesignation" TEXT,
  "resumeUrl" TEXT,
  "profileImage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Candidate_email_key" ON "Candidate"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "Candidate_phone_key" ON "Candidate"("phone");
CREATE INDEX IF NOT EXISTS "Candidate_fullName_idx" ON "Candidate"("fullName");
CREATE INDEX IF NOT EXISTS "Candidate_phone_idx" ON "Candidate"("phone");
CREATE INDEX IF NOT EXISTS "Candidate_email_idx" ON "Candidate"("email");
CREATE INDEX IF NOT EXISTS "Candidate_location_idx" ON "Candidate"("location");

CREATE TABLE IF NOT EXISTS "auth_users" (
  "id" BIGSERIAL PRIMARY KEY,
  "full_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_users_email_role_lower_unique"
  ON "auth_users" (LOWER("email"), "role");

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" BIGSERIAL PRIMARY KEY,
  "session_key" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT,
  "refresh_token_hash" TEXT NOT NULL,
  "csrf_token" TEXT NOT NULL,
  "remember_me" BOOLEAN NOT NULL DEFAULT FALSE,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "revoked_at" TIMESTAMPTZ,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "auth_sessions_session_key_key" UNIQUE ("session_key"),
  CONSTRAINT "auth_sessions_refresh_token_hash_key" UNIQUE ("refresh_token_hash")
);

CREATE INDEX IF NOT EXISTS "auth_sessions_email_idx"
  ON "auth_sessions" ("email");

CREATE INDEX IF NOT EXISTS "auth_sessions_email_role_active_idx"
  ON "auth_sessions" (LOWER("email"), "role", "revoked_at", "expires_at");

CREATE TABLE IF NOT EXISTS "auth_password_otps" (
  "id" BIGSERIAL PRIMARY KEY,
  "auth_user_id" BIGINT NOT NULL REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "otp_hash" TEXT NOT NULL,
  "reset_token_hash" TEXT,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "reset_expires_at" TIMESTAMPTZ,
  "verified_at" TIMESTAMPTZ,
  "used_at" TIMESTAMPTZ,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "request_ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "auth_password_otps_user_active_idx"
  ON "auth_password_otps" ("auth_user_id", "used_at", "expires_at");

CREATE INDEX IF NOT EXISTS "auth_password_otps_email_created_idx"
  ON "auth_password_otps" (LOWER("email"), "created_at");

CREATE TABLE IF NOT EXISTS "employee_record_audits" (
  "record_key" TEXT PRIMARY KEY,
  "employee_user_id" TEXT,
  "employee_email" TEXT,
  "employee_phone" TEXT,
  "created_by_auth_user_id" BIGINT REFERENCES "auth_users"("id") ON DELETE SET NULL,
  "created_by_name" TEXT NOT NULL,
  "created_by_email" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_edited_by_auth_user_id" BIGINT REFERENCES "auth_users"("id") ON DELETE SET NULL,
  "last_edited_by_name" TEXT NOT NULL,
  "last_edited_by_email" TEXT,
  "last_edited_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_action" TEXT NOT NULL DEFAULT 'created'
);

CREATE INDEX IF NOT EXISTS "employee_record_audits_employee_email_idx"
  ON "employee_record_audits" (LOWER("employee_email"));

CREATE TABLE IF NOT EXISTS "hr_employee_imports" (
  "id" BIGSERIAL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "generated_at" TIMESTAMPTZ,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "imported_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_preview" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "hr_employee_records" (
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
  "resume_s3_key" TEXT,
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

CREATE INDEX IF NOT EXISTS "hr_employee_records_source_type_idx"
  ON "hr_employee_records"("source_type");
CREATE INDEX IF NOT EXISTS "hr_employee_records_source_id_idx"
  ON "hr_employee_records"("source_id");
CREATE INDEX IF NOT EXISTS "hr_employee_records_local_user_id_idx"
  ON "hr_employee_records"("local_user_id");
CREATE INDEX IF NOT EXISTS "hr_employee_records_email_idx"
  ON "hr_employee_records"("email");
CREATE INDEX IF NOT EXISTS "hr_employee_records_email_lower_idx"
  ON "hr_employee_records"(LOWER("email"));
CREATE INDEX IF NOT EXISTS "hr_employee_records_phone_idx"
  ON "hr_employee_records"("phone");
CREATE INDEX IF NOT EXISTS "hr_employee_records_name_idx"
  ON "hr_employee_records"("name");
CREATE INDEX IF NOT EXISTS "hr_employee_records_resume_s3_key_idx"
  ON "hr_employee_records"("resume_s3_key");
