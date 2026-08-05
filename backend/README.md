# Candidate Database Backend

Production-ready backend foundation for a Candidate Database Platform similar to Naukri.

## Stack

- Node.js
- Express.js
- Prisma ORM
- PostgreSQL / Neon
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
cp .env.example .env
npx prisma generate
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
