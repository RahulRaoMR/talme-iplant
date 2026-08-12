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
