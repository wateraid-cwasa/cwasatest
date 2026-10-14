# CWASA Meter Reading Application — Architecture & Platform Documentation

This document provides a realistic, practical overview of the programming languages, frameworks, deployment targets, and architectural trade-offs used in this application.

---

## 1. Core Technology Stack

| Layer | Technology | Version | Purpose in this Project |
| :--- | :--- | :--- | :--- |
| **Language** | **TypeScript** | `~6.0.3` | Strong type checking for meter records, customer accounts, translation strings, and form states. Compiles to standard JavaScript. |
| **UI Library** | **React** | `19.2.3` | Component lifecycle, state hooks (`useState`, `useEffect`, `useRef`, `useMemo`), and reactive UI updates. |
| **Mobile Framework** | **React Native** | `0.86.3` | Provides native UI primitives (`View`, `Text`, `TextInput`, `ScrollView`, `Pressable`, `StyleSheet`) targeting Android and iOS. |
| **Universal Platform** | **Expo SDK** | `~57.0.27` | Build system, local development server (`Metro`), platform bundling, and cross-platform native plugin management. |
| **Web Compatibility** | **React Native Web** | `^0.21.2` | Compiles React Native components and StyleSheet rules into standard HTML5 DOM (`<div>`, `<input>`, CSS Flexbox) for browser execution. |
| **Device Hardware APIs** | **Expo Camera** & **W3C Geolocation** | `~57.0.6` | Captures meter inspection photos via the device camera and gathers GPS coordinates (Latitude & Longitude). |
| **Web Production Server** | **Docker + Nginx** | `Alpine` | Builds static assets via `npx expo export --platform web` and serves them over Nginx. |

---

## 2. Platform Deployment Matrix (Web vs. Mobile App)

The application is written as a single codebase in [`App.tsx`](App.tsx) and deploys across both web and mobile without duplicating business logic:

| Feature / Aspect | Web Deployment (Browser / Portal) | Mobile App Deployment (Android / iOS) |
| :--- | :--- | :--- |
| **Target Users** | Billing officers, MOD supervisors, office coordinators, desktop workstations. | Field meter readers, on-site utility inspectors walking residential & commercial zones. |
| **Build Command** | `npx expo export --platform web` | `npx eas build -p android` (or `expo run:android` / `expo run:ios`) |
| **Artifact Output** | Static production bundle in `/dist` (`index.html`, minified JS, CSS, bundled images). | `.apk` / `.aab` for Android devices; `.ipa` for iOS / TestFlight. |
| **Hosting & Distribution** | Docker container with Nginx, Linux VM, AWS S3/CloudFront, Vercel, or any standard web server. | Google Play Store, MDM (Mobile Device Management), or direct internal APK download. |
| **Layout Behavior** | Desktop dashboard layout with collapsible left navigation sidebar, top breadcrumbs, and wide tables. | Compact single-column handheld layout, mobile top navigation bar, bottom floating actions. |
| **GPS / Location** | Browser Geolocation API (`navigator.geolocation.getCurrentPosition` with high accuracy). | Native device hardware GPS chip querying fine location permissions. |
| **Camera Access** | Browser HTML5 MediaDevices / WebRTC stream (requires secure HTTPS context). | Native OS camera viewfinder (`expo-camera` with Android/iOS camera permissions declared in [`app.json`](app.json)). |
| **Installation** | Zero installation needed; opens via any browser URL. | Installed on device; launches directly from the home screen / app drawer. |

---

## 3. Real Benefits (Practical & Grounded)

### 1. Single Codebase, Zero Code Drift
- All validation rules (e.g. meter auto-population, non-editable previous bill calculation, and billing approval filters) live in one file.
- Changes made to billing algorithms or field requirements are immediately reflected in both the web and mobile interfaces simultaneously.

### 2. Tailored Responsive UI Without Framework Switching
- The app checks `Platform.OS === 'web'` and screen width dynamically.
- Desktop users receive a full office dashboard with collapsible sidebar navigation and data tables.
- Mobile users receive a streamlined field-work interface tailored for one-handed operation.

### 3. Native Mobile Capabilities Where Needed
- Field inspectors need hardware access (GPS coordinates and photo verification of the meter dials). Expo provides native camera and geolocation hooks without requiring separate Android Java/Kotlin code.

### 4. Low Maintenance Overhead
- Developers only need React and TypeScript knowledge. There is no need to maintain separate web (e.g. React/Vue) and mobile (e.g. Flutter/Kotlin) teams.

---

## 4. Realistic Limitations & Trade-offs (Keeping It Real)

- **HTTPS Requirement on Web**: Modern browsers block camera and GPS access on insecure HTTP connections (except `localhost`). When hosting the web version, a valid SSL/TLS certificate (HTTPS) is mandatory for hardware access.
- **Expo Camera Web Compatibility**: While `expo-camera` supports web, browser camera behavior can vary slightly across desktop webcams, mobile Chrome, and Safari.
- **Styling Architecture**: Styles rely on React Native's Flexbox engine (`StyleSheet.create`), which translates accurately to CSS flexbox on the web, but avoids traditional CSS cascade / media queries in favor of React state and dimensions.

---

## 5. Development & Build Commands

```powershell
# 1. Install dependencies
npm ci

# 2. Run local development for Web
npx expo start --web

# 3. Run local development for Android
npx expo start --android

# 4. Production Web Build (Docker)
docker compose up --build -d

# 5. Production Web Static Export
npx expo export --platform web
```
