# CWASA Meter Reading App

Frontend-first Expo app for web, iOS, and Android. The web interface uses React Native Web; platform-specific camera access is provided by Expo Camera.

## Run the web preview with Docker

Install and start Docker Desktop, then run these commands from this project folder:

```powershell
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). Stop the container with `Ctrl+C`. To start it in the background, use:

```powershell
docker compose up --build -d
```

Stop and remove the container with:

```powershell
docker compose down
```

The Docker image builds the static Expo web export and serves it with Nginx. It does not run the iOS/Android app or a backend. The Meter Reading screen lists the signed-in inspector's submitted readings awaiting administrator review; the Completed screen lists that inspector's approved readings. Administrators can review and approve submissions from the admin panel.

The browser camera needs camera permission and a secure context. `http://localhost:8080` is treated as secure for local development; when opening the app from another device or deploying it, serve it over HTTPS for camera access.

## Deploy the frontend to Render

The repository-level `render.yaml` configures a Render Static Site that builds
only this `meter-app/` directory. It publishes Expo's `dist/` web export and
rewrites app routes to `index.html`; the NestJS backend and its files are not
part of this static-site build.

In Render, create a **Blueprint** for this Git repository and set
`EXPO_PUBLIC_API_BASE_URL` to the HTTPS URL of an API deployed separately,
including its `/api/v1` prefix (for example,
`https://your-api.example.com/api/v1`). This value is embedded in the frontend
at build time, so rebuild/redeploy after changing it. The frontend can load
without an API, but sign-in, readings, account management, and service requests
require a reachable backend. Configure the backend to allow requests from the
Render site origin; do not put database credentials or JWT secrets in this
frontend variable.

For a temporary test with a backend running on a development PC, an ngrok
HTTPS URL can be used as `EXPO_PUBLIC_API_BASE_URL` in Render, but the PC, API,
and tunnel must stay online. This is not a reliable production API deployment.
Set `CORS_ORIGINS` on the backend to include
`https://cwasa-meter-app.onrender.com`, then rebuild the frontend after changing
its API URL.

## Run with Expo

```powershell
npm ci
Copy-Item .env.example .env
npx expo start --web
```

For Android, connect a device with USB debugging enabled or start an Android emulator, then run:

```powershell
npx expo start --android
```

## Connect the standalone backend

The NestJS API is in the sibling `../backend` folder and runs separately from
this Expo app. Configure the backend separately using
`../backend/.env.example`. Configure `EXPO_PUBLIC_API_BASE_URL` in this app's
`.env` for the device running Expo:

- Web on the development PC: `http://localhost:3000/api/v1` (the preferred
  local setup when the backend is running on the same PC)
- Android emulator: `http://10.0.2.2:3000/api/v1`
- Physical device: use the development PC's private LAN IP and allow the API
  through the Windows private-network firewall.

For the Render website, use the backend's public HTTPS URL in the Render
frontend environment settings. If testing through ngrok, use its forwarding URL
with `/api/v1` and add the Render origin to `CORS_ORIGINS` in
`backend/.env`. Do not place `CORS_ORIGINS` in `meter-app/.env`, and do not
expose SQL Server to the public internet; only the backend should connect to
the databases.

The native camera permission is configured in `app.json`. Rebuild the native app after changing native permissions or plugins.

New Reading looks up accounts/meters and the latest bill through the source
database views. It reads real device GPS coordinates and requires a meter photo
from the camera or gallery. Both photo sources are resized and compressed to
JPEG (up to a 1280-pixel edge and under 1 MB) before being sent to the backend.
The backend stores the reading and photo in `CWASABILL_PLATFORM_TEST`; see the
backend README for the required SQL scripts. On web, allow location access and
run from localhost or HTTPS.

Service requests are created through the authenticated backend and stored in
`app.ServiceRequests` in `CWASABILL_PLATFORM_TEST`. Run the backend's
`sql/service-requests.sql` script before using this feature. Inspectors can
look up only customers assigned to their RICODE, attach an optional compressed
photo, submit problem details, and filter their saved requests by status.
