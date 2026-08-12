DROP INDEX IF EXISTS "auth_users_email_lower_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "auth_users_email_role_lower_unique"
  ON "auth_users" (LOWER("email"), "role");

ALTER TABLE "auth_sessions"
  ADD COLUMN IF NOT EXISTS "role" TEXT;

CREATE INDEX IF NOT EXISTS "auth_sessions_email_role_active_idx"
  ON "auth_sessions" (LOWER("email"), "role", "revoked_at", "expires_at");
