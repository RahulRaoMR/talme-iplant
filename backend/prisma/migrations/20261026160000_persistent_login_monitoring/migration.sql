ALTER TABLE "auth_sessions"
  ADD COLUMN IF NOT EXISTS "location_json" JSONB,
  ADD COLUMN IF NOT EXISTS "logout_reason" TEXT;

CREATE INDEX IF NOT EXISTS "auth_sessions_created_at_idx" ON "auth_sessions" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "auth_sessions_revoked_at_idx" ON "auth_sessions" ("revoked_at" DESC) WHERE "revoked_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "auth_login_attempts" (
  "id" BIGSERIAL PRIMARY KEY,
  "email" TEXT,
  "role" TEXT,
  "reason" TEXT,
  "ip_address" TEXT,
  "device" TEXT,
  "browser" TEXT,
  "location_json" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "auth_login_attempts_created_at_idx" ON "auth_login_attempts" ("created_at" DESC);
