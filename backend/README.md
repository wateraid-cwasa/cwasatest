# CWASA Meter Reading API

NestJS service for the Expo meter-reading app. The frontend and API share a
repository but can be built and deployed independently.

## Local development

Requirements: Node.js 20 or newer and npm.

```powershell
npm install
Copy-Item .env.example .env
# Edit .env locally with both database URLs and independent JWT secrets.
npm run start:dev
```

The health endpoint is `http://localhost:3000/api/v1/health`.

Set `CORS_ORIGINS` in `.env` to a comma-separated list of trusted web-app origins.
Native Android and iOS requests are not subject to browser CORS restrictions.

## Prisma schemas and auth tables

The source and platform databases have separate Prisma schemas and connection
variables. The source database is queried only through the approved
`platform.vw_Inspector` view. The platform schema models `app.AdminAccounts` and
`app.MeterInspectorCredentials`.

Before the first login, execute [`sql/source-inspector-view.sql`](./sql/source-inspector-view.sql)
in SSMS against `CWASABILL_TEST` and
[`sql/platform-auth.sql`](./sql/platform-auth.sql) against
`CWASABILL_PLATFORM_TEST`, using a database administrator account. The source
view exposes only RICODE and inspector name, so the runtime SQL login does not
need direct access to `dbo.MICode`. The platform SQL login has DML permissions
but is not assumed to have permission to create tables. The platform script
creates dedicated application credential and inspector-directory tables; it
does not use billing passwords or SQL Server connection logins for application
authentication. Inspectors created by admins are stored in
`app.MeterInspectorDirectory` rather than the external billing database.
Rerun `sql/platform-auth.sql` on existing installations to create this
directory table and grant the runtime principal access to it.

For real customer lookup, rerun `sql/source-inspector-view.sql` after
`platform.vw_Customer` and `platform.vw_BillHistory` exist; it grants the source
runtime login read access to those views. Execute `sql/meter-readings.sql`
against `CWASABILL_PLATFORM_TEST` with a database administrator account. It
creates or migrates `app.MeterReadings` and grants the runtime login the
SELECT/INSERT/UPDATE access needed for the review flow. Reading photos are
required, resized and JPEG-compressed to fit within 1 MB, and stored as
`varbinary(max)` in this database. Rerun this idempotent script to add the
`WardNo` column required for inspector ward filtering.

The inspector-only reading routes are `GET
/api/v1/readings/customer-lookup?identifier=...` and `POST
/api/v1/readings`. Lookup reads customer and latest-bill values from the two
approved source views; creation stores the amount, actual GPS coordinates,
inspector RICODE, and required compressed photo in the platform database.
Submitted readings start as `Pending`; inspectors can list their own pending
and approved entries at `GET /api/v1/readings/pending` and
`GET /api/v1/readings/completed`. Administrators review
`GET /api/v1/readings/admin/pending`, `GET
/api/v1/readings/admin/completed`, and `GET /api/v1/readings/admin/rejected`.
Admins approve or reject a pending entry with `POST
/api/v1/readings/admin/:readingId/approve` or `POST
/api/v1/readings/admin/:readingId/reject`. Each decision records the
administrator and review time. Any authenticated
meter inspector can look up and submit readings for any customer; each new
reading is still recorded under the submitting inspector's RICODE. Apply
`Rejected` status support by rerunning `sql/meter-readings.sql` against the
platform database.

Service requests are stored in `app.ServiceRequests`; execute
[`sql/service-requests.sql`](./sql/service-requests.sql) against
`CWASABILL_PLATFORM_TEST` with a database administrator account. The
inspector-only API provides `GET /api/v1/service-requests`,
`GET /api/v1/service-requests/customer-lookup?identifier=...`, and
`POST /api/v1/service-requests`. Any authenticated meter inspector can look up
any customer in the customer view and create a request for them. Each request
is associated with the submitting inspector's RICODE. Optional compressed
JPEG photos are stored in the platform database, up to 1 MB.

After creating the tables, initialize the first administrator once:

```powershell
npm run prisma:source:generate
npm run prisma:platform:generate
npm run bootstrap:admin
```

The CLI prompts for a username and a masked password, stores only an Argon2id
hash, and refuses to run if an administrator already exists. There is no public
admin signup endpoint.

The source and platform Prisma clients are separate. Inspector login resolves
the unique `RICODE` from `platform.vw_Inspector` or the app-managed
`app.MeterInspectorDirectory`; admins authenticate against `app.AdminAccounts`.
Admins can list inspectors, create app-managed inspector accounts, set/reset
passwords, and deactivate accounts through protected API routes. Password
hashes are stored only in the platform database.
Admin APIs also support creating app-managed inspectors, listing approved and
rejected readings, rejecting pending readings, and deactivating inspector
credentials. Deactivation preserves the inspector directory row and disables
sign-in rather than deleting account history.

The Prisma pull scripts are available if you later introspect additional database
objects. Review their output before regenerating because introspection can rename
models referenced by application code. If a SQL Server password contains a
connection-string delimiter such as `;`, wrap that password value in curly
braces in the connection URL.

## Database access

The API will connect to `CWASABILL_TEST` using `cwasa_platform_app` for read-only
source data and to `CWASABILL_PLATFORM_TEST` using `cwasa_platform_rw` for
application data. Database credentials belong only in the backend's local
`.env` file or the deployment platform's secret manager; never commit them.
The `.env.example` file contains placeholders, not working credentials.

For local development on the SQL Server PC, the host can be `localhost`. A
separately deployed API cannot use `localhost` to reach the developer's PC.
Production must use a database endpoint reachable through a private network or
VPN, or run the API within the network that contains SQL Server. Do not expose
SQL Server directly to the public internet.

The API provides inspector login, admin login, profile lookup, token refresh,
inspector listing, and admin-only inspector password setup. The inspector login
uses the existing frontend contract at `POST /api/v1/meter-reader/login` with
`meterReaderId` and `password`. The value of `meterReaderId` is the verified
source `RICODE`.

The [Dockerfile](./Dockerfile) builds the API as a standalone container. Set
database URLs and JWT secrets through the deployment platform's secret settings.

## Consumer (customer-facing) endpoints

This same API also serves the Consumer APP. The customer slice is a
self-contained module (`src/customer`) with its own JWT guard and claims
type, kept separate from the inspector/admin auth code so the two cannot
interfere with each other. Routes:

- `POST /api/v1/customer/otp/request` - takes `accountNo` and `mobileNo`,
  verifies the pair against `platform.vw_Customer`, and issues a one-time
  6-digit code (argon2-hashed, stored in `app.CustomerOtps`, 5 attempts/min).
  There is no SMS gateway configured yet, so outside production the response
  includes a `devOtp` field for testing.
- `POST /api/v1/customer/otp/verify` - takes `accountNo` and `otp`, returns
  an access/refresh token pair plus the matched customer record.
- `POST /api/v1/customer/token/refresh` - takes `refreshToken`, returns a new
  token pair. (Named differently from the inspector/admin `/auth/refresh` to
  avoid a route collision on the shared app.)
- `GET /api/v1/customer/me` - current session's claims (requires a customer
  access token).
- `GET /api/v1/customer/profile`, `GET /api/v1/customer/bills`,
  `GET /api/v1/customer/meter-readings` - scoped to the signed-in customer's
  `accountNo`, reading from `platform.vw_Customer`, `platform.vw_BillHistory`,
  and `app.MeterReadings`.

Run `sql/customer-otp.sql` once against `CWASABILL_PLATFORM_TEST` to create
the `app.CustomerOtps` table before using these routes. After pulling schema
changes, regenerate the platform Prisma client with
`npm run prisma:platform:generate`.
