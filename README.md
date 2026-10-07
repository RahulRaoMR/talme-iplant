# Talme Enterprise Auth

A Node + PostgreSQL authentication system with local RBAC/session mirrors, audit logging, and a responsive login/registration UI.

New registrations start as `PENDING` and cannot sign in until a Super Admin approves them in **Admin Control Center > Users**. Login, refresh tokens and protected requests all require an enabled `APPROVED` PostgreSQL account, with bcrypt password verification and JWT session validation.

## Registration Approval

Deploy the Prisma migrations before running updated servers: `npm --prefix backend run prisma:deploy`. The approval migration preserves existing enabled accounts as approved and marks existing inactive accounts rejected. All new registrations, including Admin registrations, require approval.

The Registered Users table supports Approve, Reject and Delete, status filters and registration contact details. Reject and Delete immediately revoke the selected email-and-role account's sessions and password reset tokens. Delete is a permanent access deletion, not physical erasure: its blocked record remains to prevent the same email-and-role registration being recreated. Other roles registered to the same email are separate accounts. Review history is persisted in `auth_registration_reviews`; self-rejection/deletion and removal of the final approved Super Admin are prohibited.

Run `npm run registration-approval:test` for PostgreSQL-backed end-to-end coverage. Authentication smoke and password-reset tests also use temporary database schemas and in-memory SQLite; they never create real portal users.

## Account Protection

Approve and Reject require explicit confirmation. Delete additionally requires the administrator's current password and the exact account email; both are checked in the backend before changing account status. Failed deletion password checks are audited without recording passwords.

PostgreSQL enforces shared limits across server processes: eight login requests per IP per minute, five failed attempts per email-and-role registration within a 15-minute window, twenty registration actions per administrator per minute, and five deletion verification attempts per administrator within a 15-minute window. Successful password verification clears the corresponding failure counter; a verified password reset also clears login lockouts. Limits return HTTP 429 and `Retry-After`. Failed login guesses do not revoke a user's existing valid session.

Non-remembered sessions expire after 30 idle minutes in PostgreSQL, including refresh requests and recovery after a restart. Remembered sessions retain their configured absolute expiry. JWTs must use HS256 with valid issue/expiry times, protected JSON responses are not cached, and production authentication cookies are Secure/HttpOnly/SameSite Strict. Production must be served over HTTPS.

Expired security counter rows are pruned in bounded batches after one day; active lockouts are never deleted by cleanup.

Run `npm run auth-protection:test` for isolated PostgreSQL-backed coverage of lockouts, concurrent limits, deletion reauthentication, session expiry and strict token validation. The controls follow the [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) and [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) guidance; they are not a substitute for MFA or a deployment security review.

## Run

```powershell
npm start
```

Open `http://localhost:4000`.

## Required Environment

Set these values in Vercel Production and in your local shell when running the server:

```powershell
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
JWT_SECRET="replace-with-a-long-random-production-secret"
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL=noreply@iplant.talme.in
AUTH_EMAIL_FROM="Talme HR <noreply@iplant.talme.in>"
APP_URL="https://iplant.talme.in"
```

Set `EMPLOYEE_INVITE_CODE` only if employee self-registration should be enabled.

## Key APIs

- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/forgot-password`
- `POST /api/auth/forgot-password/verify`
- `POST /api/auth/reset-password`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `GET /api/me`
- `GET /api/admin/users`
- `GET /api/platform/companies`
- `GET /api/hr/employees`
- `GET /api/candidate/applications`

Every protected API verifies JWT authentication and permissions.

## Login Locations

Admin monitoring uses calendar days in `Asia/Kolkata` (IST). Today's login/logout counters count recorded events, not all active sessions; an existing session can remain active without a new login today. Device totals count distinct devices with unexpired, unrevoked sessions and distinguish Android tablets from phones. A zero is retained when there are no matching events or devices.

Login history stores approximate IP locations using the local `geoip-lite` dataset. The admin location map and activity tables include the selected date range; older history is backfilled from its recorded IPs. Localhost/private networks are labelled `Local network`, not assigned a guessed city. These are employee login locations, not employee profile addresses.

For reverse-proxy deployments, set `TRUST_PROXY` to the proxy IPs/CIDRs (comma-separated), or `loopback` for a local reverse proxy. Leave it empty for direct connections. Forwarded addresses are accepted only from trusted hops. Do not use an unrestricted trust setting.

Keep the GeoLite dataset current using the [geoip-lite update instructions](https://github.com/geoip-lite/node-geoip#update-the-datafiles-optional); newer MaxMind data requires your own license key. Restart the server after updating the dataset. No login IPs are sent to an external lookup service.

## AlloyDB PostgreSQL

This project connects to the existing Google Cloud AlloyDB/PostgreSQL database `iplante` through the backend only. Do not expose database credentials to the browser and do not commit `.env` files.

Set `DATABASE_URL` in `.env` or deployment settings:

```powershell
DATABASE_URL="postgresql://DATABASE_USER:DATABASE_PASSWORD@DATABASE_HOST:5432/iplante?sslmode=require"
```

The HR employee search schema is managed by Prisma migrations under `backend/prisma/migrations`. It stores resume metadata, extracted resume text, normalized skills, and indexed search data. Resume PDF/DOCX binaries remain in file/object storage.
