# Talme Enterprise Auth

A self-contained Node + SQLite implementation of enterprise authentication, RBAC, session security, audit logging, and a premium responsive login/registration UI.

## Run

```powershell
npm start
```

Open `http://localhost:4000`.

## Demo Users

All demo users use password `Password123!`.

| Role | Email |
| --- | --- |
| Candidate | candidate@talme.test |
| Employer | employer@talme.test |
| Recruiter | recruiter@talme.test |
| Employee | employee@talme.test |
| HR Manager | hr@talme.test |
| Company Admin | company.admin@talme.test |
| Platform Admin | platform.admin@talme.test |
| Super Admin | super.admin@talme.test |

Registration for employees is invite-only. Use invite code `TALME-EMPLOYEE-2026`.

## Key APIs

- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/otp/request`
- `POST /api/auth/otp/verify`
- `POST /api/auth/forgot-password`
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
