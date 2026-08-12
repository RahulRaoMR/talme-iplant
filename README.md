# Talme Enterprise Auth

A Node + Neon PostgreSQL authentication system with local RBAC/session mirrors, audit logging, and a responsive login/registration UI.

Only users created through the Create Account form can log in. Login checks the Neon `auth_users` table only, with bcrypt password verification and JWT session creation.

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
