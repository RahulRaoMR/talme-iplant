# Candidate Database Backend

Production-ready backend foundation for a Candidate Database Platform similar to Naukri.

## Stack

- Node.js
- Express.js
- Prisma ORM
- PostgreSQL
- JWT-ready auth dependencies
- bcrypt
- dotenv
- cors
- helmet
- express-rate-limit
- multer
- morgan

## Setup

```bash
cd backend
npm install
cp ../.env.example ../.env
npm run prisma:generate
npm run dev
```

## Health Check

```http
GET /api/health
```

Response:

```json
{
  "success": true,
  "message": "Candidate Backend Running"
}
```

Candidate APIs are intentionally not implemented yet. This project currently contains only the backend foundation.

## AlloyDB / PostgreSQL Search Schema

Use the existing AlloyDB database `iplante`. Configure `DATABASE_URL` with placeholders from the root `.env.example`, then run:

```bash
npm run prisma:generate
npm run prisma:deploy
```

The migration `20260918110000_add_hr_employee_resume_search` adds:

- `hr_employee_resumes` for latest resume metadata and extracted text
- `skills` and `employee_skills` for normalized skill search
- GIN/full-text/trigram indexes for fast employee, skill, and latest-resume searches

Do not store PDF/DOCX binary content in PostgreSQL. Store only metadata, storage keys/paths, extracted text, and searchable structured data.

Both servers use the root `.env`. `BACKEND_PORT` controls this API; `PORT` controls the root application. Prisma npm scripts load the root `.env`.
