BEGIN;

ALTER TABLE auth_users ADD COLUMN approval_status TEXT;
ALTER TABLE auth_users ADD COLUMN deleted_at TIMESTAMP(3);
-- Preserve existing enabled accounts, including the administrators who review registrations.
UPDATE auth_users SET approval_status = CASE WHEN is_active THEN 'APPROVED' ELSE 'REJECTED' END;
ALTER TABLE auth_users ALTER COLUMN approval_status SET NOT NULL;
ALTER TABLE auth_users ALTER COLUMN approval_status SET DEFAULT 'PENDING';
ALTER TABLE auth_users ALTER COLUMN is_active SET DEFAULT false;
ALTER TABLE auth_users ADD CONSTRAINT auth_users_approval_status_check
  CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'DELETED'));
ALTER TABLE auth_users ADD CONSTRAINT auth_users_approved_access_check
  CHECK (NOT is_active OR (approval_status = 'APPROVED' AND deleted_at IS NULL));
CREATE INDEX auth_users_approval_status_idx ON auth_users(approval_status);

CREATE TABLE auth_registration_reviews (
  id BIGSERIAL PRIMARY KEY,
  auth_user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  reviewer_auth_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
  previous_status TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX auth_registration_reviews_user_idx ON auth_registration_reviews(auth_user_id, created_at);

COMMIT;
