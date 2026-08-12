BEGIN;

DELETE FROM sessions;
DELETE FROM password_reset_tokens;
DELETE FROM otp_codes;
DELETE FROM devices;
DELETE FROM login_history;
DELETE FROM user_roles;
DELETE FROM candidate_accounts;
DELETE FROM employee_accounts;
DELETE FROM company_users;
DELETE FROM users;

COMMIT;
