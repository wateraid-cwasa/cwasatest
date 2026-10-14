# CWASA Meter Reading

This repository contains the Expo frontend in `meter-app/` and the NestJS API
in `backend/`. They are developed and deployed independently.

## Backend

Requirements: Node.js 20 or newer, npm, and access to the configured SQL Server
databases.

```powershell
cd backend
Copy-Item .env.example .env
# Set database URLs and independent JWT secrets in .env.
npm ci
npm run prisma:source:generate
npm run prisma:platform:generate
npm run start:dev
```

The API health endpoint is `http://localhost:3000/api/v1/health`. See
[`backend/README.md`](./backend/README.md) for database setup, SQL scripts,
authentication, and API details.

## Frontend

In a separate terminal:

```powershell
cd meter-app
npm ci
$env:EXPO_PUBLIC_API_BASE_URL = "http://localhost:3000/api/v1"
npm run web
```

Set `EXPO_PUBLIC_API_BASE_URL` to the reachable API URL for your target device
or deployment. Never put database credentials or signing secrets in frontend
configuration.
