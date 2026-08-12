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
  "request_ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "auth_password_otps_user_active_idx"
  ON "auth_password_otps" ("auth_user_id", "used_at", "expires_at");

CREATE INDEX IF NOT EXISTS "auth_password_otps_email_created_idx"
  ON "auth_password_otps" (LOWER("email"), "created_at");
