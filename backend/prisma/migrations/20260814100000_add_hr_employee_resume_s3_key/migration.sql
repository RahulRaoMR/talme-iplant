ALTER TABLE "hr_employee_records"
  ADD COLUMN IF NOT EXISTS "resume_s3_key" TEXT;

CREATE INDEX IF NOT EXISTS "hr_employee_records_resume_s3_key_idx"
  ON "hr_employee_records"("resume_s3_key");
