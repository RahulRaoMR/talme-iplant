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
