CREATE TABLE auth_security_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX auth_security_limits_expiry_idx ON auth_security_limits(expires_at);
