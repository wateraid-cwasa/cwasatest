# CWASA Meter Reading Application — Comprehensive Backend & Database Setup Blueprint

This document provides the complete technical specification for the **CWASA Meter Reading Application**, detailing all front-end functionalities, core files, and existing static mock data structures. It serves as an authoritative implementation blueprint for deploying a **NestJS** backend connected to **Microsoft SQL Server (SQL Express)** using a **dual-database architecture**.

---

## 1. Database Architecture & Credentials (SQL Express)

The backend utilizes a **dual-database architecture** to strictly separate read-only billing data from read/write application data:

```
                  ┌───────────────────────────────────────────────┐
                  │                 NestJS Backend                │
                  │                (meter-backend)                │
                  └──────────────┬─────────────────┬──────────────┘
                                 │                 │
                Connection 1     │                 │   Connection 2
            (billingConnection)  │                 │   (default)
            synchronize: false   │                 │   synchronize: true
                                 ▼                 ▼
             ┌─────────────────────────┐     ┌─────────────────────────┐
             │      CWASABILL_TEST     │     │   CWASA_PLATFORM_DEV    │
             │   (Read-Only Billing)   │     │  (Read/Write App Data)  │
             ├─────────────────────────┤     ├─────────────────────────┤
             │ • platform.vw_Customer  │     │ • Zones                 │
             │ • platform.vw_BillHist. │     │ • Employees             │
             │ • Master Ledger Data    │     │ • Customers (Cache)     │
             │                         │     │ • MeterReadings         │
             │                         │     │ • ServiceRequests       │
             │                         │     │ • SyncAuditLogs         │
             └─────────────────────────┘     └─────────────────────────┘
```

### Database 1: Billing Copy (Read-Only)
* **Database Name:** `CWASABILL_TEST`
* **Purpose:** Houses masked customer billing data and read-only platform views (`platform.vw_Customer`, `platform.vw_BillHistory`).
* **NestJS Access:** `synchronize: false` (Must never modify or alter schema).

### Database 2: Application Data (Read/Write)
* **Database Name:** `CWASA_PLATFORM_DEV`
* **Purpose:** Houses app-specific entities (Users/Employees, Zones, Service Requests, App-captured Meter Readings, Offline Sync Logs).
* **NestJS Access:** `synchronize: true` (Auto-creates and manages tables during development).

### System Credentials
* **Host:** `localhost` *(If using a named SQL Express instance without port 1433 mapped, append `\SQLEXPRESS` or specify `instanceName: 'SQLEXPRESS'` in TypeORM extra options).*
* **Default Port:** `1433` (Ensure TCP/IP is enabled in SQL Server Configuration Manager).
* **NestJS App User:** `cwasa_platform_app`
* **App Password:** `<Password_Set_In_Script_03>` *(Default: `ChangeMe_App#2026`)*
* **Developer SSMS User:** `cwasa_developer` (Used for manual administrative queries and testing).

---

## 2. Application Database Schema (CWASA_PLATFORM_DEV)

Run this DDL script in **SQL Server Management Studio (SSMS)** under the `CWASA_PLATFORM_DEV` database to initialize the foundational application tables.

```sql
USE CWASA_PLATFORM_DEV;
GO

-- 1. Revenue Zones / MOD Master Table
CREATE TABLE Zones (
    ZoneId INT IDENTITY(1,1) PRIMARY KEY,
    ZoneCode NVARCHAR(50) NOT NULL UNIQUE,       -- e.g., 'MOD-1'
    ZoneName NVARCHAR(100) NOT NULL,              -- e.g., 'MOD-1 Agrabad'
    Description NVARCHAR(255) NULL,
    CreatedAt DATETIME2 DEFAULT SYSDATETIME()
);

-- 2. Employees / Meter Readers Master Table
CREATE TABLE Employees (
    EmployeeId INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeCode NVARCHAR(50) NOT NULL UNIQUE,   -- e.g., 'E-10482'
    FullName NVARCHAR(150) NOT NULL,             -- e.g., 'Md Jahed'
    Email NVARCHAR(150) NULL,
    PhoneNumber NVARCHAR(50) NULL,
    PasswordHash NVARCHAR(255) NOT NULL,         -- Bcrypt hashed password
    ZoneId INT NULL FOREIGN KEY REFERENCES Zones(ZoneId),
    Role NVARCHAR(50) DEFAULT 'READER',          -- 'READER', 'SUPERVISOR', 'ADMIN'
    IsActive BIT DEFAULT 1,
    CreatedAt DATETIME2 DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 DEFAULT SYSDATETIME()
);

-- 3. App Customer Cache Table
CREATE TABLE Customers (
    CustomerId INT IDENTITY(1,1) PRIMARY KEY,
    AccountNumber NVARCHAR(50) NOT NULL UNIQUE,  -- e.g., '310245'
    MeterNumber NVARCHAR(50) NOT NULL UNIQUE,    -- e.g., '2004517K'
    FullName NVARCHAR(150) NOT NULL,             -- e.g., 'Mr Kamal Hossain'
    PhoneNumber NVARCHAR(50) NULL,
    AddressLine NVARCHAR(255) NOT NULL,          -- e.g., '712 Mowllapara North, Agrabad'
    DetailAddress NVARCHAR(500) NULL,            -- e.g., '712 Mowllapara North, Agrabad, Chattogram'
    CustomerType NVARCHAR(50) DEFAULT 'Domestic',-- 'Domestic', 'Commercial', 'Industrial'
    MeterType NVARCHAR(50) DEFAULT 'Metered',    -- 'Metered', 'Non-metered'
    ZoneId INT NULL FOREIGN KEY REFERENCES Zones(ZoneId),
    Area NVARCHAR(100) NULL,                     -- e.g., 'Dewan Hat'
    Ward NVARCHAR(50) NULL,                      -- e.g., '24'
    ConnectionSize NVARCHAR(50) DEFAULT '3/4 inch',
    CurrentDueAmount DECIMAL(18,2) DEFAULT 0.00,
    DueStatusLabel NVARCHAR(50) DEFAULT 'No due',-- 'Due', 'No due'
    ApprovalStatus NVARCHAR(50) DEFAULT 'approved', -- 'approved', 'required'
    CustomerStatus NVARCHAR(50) DEFAULT 'normal',-- 'normal', 'blocked', 'high-use', 'zero-use'
    HasActiveComplaint BIT DEFAULT 0,
    DefaultLatitude DECIMAL(9,6) NULL,
    DefaultLongitude DECIMAL(9,6) NULL,
    CreatedAt DATETIME2 DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 DEFAULT SYSDATETIME()
);

-- 4. Meter Readings Table (App-captured Inspection Records)
CREATE TABLE MeterReadings (
    ReadingId INT IDENTITY(1,1) PRIMARY KEY,
    ReadingCode NVARCHAR(50) NOT NULL UNIQUE,    -- e.g., 'RD-261011-001'
    CustomerId INT NOT NULL FOREIGN KEY REFERENCES Customers(CustomerId),
    EmployeeId INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeId),
    PreviousReading DECIMAL(18,2) NOT NULL,
    PreviousReadingDate DATE NULL,
    CurrentReading DECIMAL(18,2) NOT NULL,
    UsageUnits AS (CurrentReading - PreviousReading) PERSISTED,
    MeterCondition NVARCHAR(50) DEFAULT 'normal', -- 'normal', 'damaged', 'stopped'
    Remarks NVARCHAR(500) NULL,
    Latitude DECIMAL(9,6) NULL,
    Longitude DECIMAL(9,6) NULL,
    PhotoUrl NVARCHAR(500) NULL,                 -- File path: '/uploads/readings/...'
    ApprovalStatus NVARCHAR(50) DEFAULT 'approved', -- 'approved', 'required'
    IsUploaded BIT DEFAULT 1,
    ReadingDate DATETIME2 DEFAULT SYSDATETIME(),
    CreatedAt DATETIME2 DEFAULT SYSDATETIME()
);

-- 5. Service Requests / Meter Complaints Table
CREATE TABLE ServiceRequests (
    RequestId INT IDENTITY(1,1) PRIMARY KEY,
    RequestCode NVARCHAR(50) NOT NULL UNIQUE,    -- e.g., 'SR-2026-0001'
    CustomerId INT NULL FOREIGN KEY REFERENCES Customers(CustomerId),
    EmployeeId INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeId),
    MeterOrAccount NVARCHAR(100) NOT NULL,
    ProblemType NVARCHAR(100) NOT NULL,          -- 'Meter defective', 'Meter stopped', 'Glass broken', 'Other'
    ProblemDescription NVARCHAR(1000) NULL,
    PhotoUrl NVARCHAR(500) NULL,                 -- File path: '/uploads/service-requests/...'
    RequestStatus NVARCHAR(50) DEFAULT 'OPEN',   -- 'OPEN', 'IN_PROGRESS', 'RESOLVED'
    CreatedAt DATETIME2 DEFAULT SYSDATETIME(),
    UpdatedAt DATETIME2 DEFAULT SYSDATETIME()
);

-- 6. Offline Synchronization Queue Audit Table
CREATE TABLE SyncAuditLogs (
    SyncId INT IDENTITY(1,1) PRIMARY KEY,
    EmployeeId INT NOT NULL FOREIGN KEY REFERENCES Employees(EmployeeId),
    ClientGeneratedId NVARCHAR(100) NOT NULL,
    RecordType NVARCHAR(50) NOT NULL,            -- 'READING', 'SERVICE_REQUEST'
    PayloadJson NVARCHAR(MAX) NOT NULL,
    SyncStatus NVARCHAR(50) DEFAULT 'SUCCESS',   -- 'SUCCESS', 'FAILED', 'CONFLICT'
    ErrorMessage NVARCHAR(MAX) NULL,
    SyncedAt DATETIME2 DEFAULT SYSDATETIME()
);

-- Indexes for Fast Search & Filtering Performance
CREATE NONCLUSTERED INDEX IX_Customers_AccountNumber ON Customers(AccountNumber);
CREATE NONCLUSTERED INDEX IX_Customers_MeterNumber ON Customers(MeterNumber);
CREATE NONCLUSTERED INDEX IX_Customers_ApprovalStatus ON Customers(ApprovalStatus);
CREATE NONCLUSTERED INDEX IX_Customers_ZoneId ON Customers(ZoneId);
CREATE NONCLUSTERED INDEX IX_MeterReadings_CustomerId ON MeterReadings(CustomerId);
CREATE NONCLUSTERED INDEX IX_MeterReadings_EmployeeId ON MeterReadings(EmployeeId);
CREATE NONCLUSTERED INDEX IX_ServiceRequests_CustomerId ON ServiceRequests(CustomerId);
GO
```

---

## 3. NestJS Initialization & Architecture

### Setup Commands
Run these commands in the terminal to set up the NestJS backend workspace:

```bash
# 1. Initialize NestJS Project
npx @nestjs/cli new meter-backend
cd meter-backend

# 2. Database & MSSQL Driver
npm install @nestjs/typeorm typeorm mssql

# 3. Authentication & Security
npm install @nestjs/passport passport passport-jwt @nestjs/jwt bcrypt
npm install -D @types/passport-jwt @types/bcrypt

# 4. File Upload, Static Assets & Validation
npm install @nestjs/serve-static multer
npm install -D @types/multer
npm install class-validator class-transformer dotenv
```

### Directory Structure inside `meter-backend/src/`

```text
src/
├── main.ts                        # Application bootstrap, CORS, global validation pipes
├── app.module.ts                  # Dual TypeORM connections & feature module imports
├── common/
│   ├── decorators/                # @CurrentUser(), @Roles()
│   ├── filters/                   # HttpExceptionFilter
│   └── guards/                    # JwtAuthGuard, RolesGuard
├── config/
│   ├── database.config.ts         # Dual database configuration helper
│   └── multer.config.ts           # Storage engines for reading & service photos
└── modules/
    ├── auth/                      # Login, register, JWT token strategy
    ├── employees/                 # Employee profile, zone details, reader stats
    ├── customers/                 # Customer listings, search, auto-fill lookup
    ├── readings/                  # Reading submission, photo upload, sync queue
    └── service-requests/          # Complaints catalog, photo upload
```

---

## 4. Dual TypeORM Configuration (`app.module.ts`)

Configure `src/app.module.ts` to route queries securely between the read-only billing views (`CWASABILL_TEST`) and the read/write app tables (`CWASA_PLATFORM_DEV`):

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    // Static file serving for uploaded photos
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),

    // CONNECTION 1: Read-Only Billing Views
    TypeOrmModule.forRoot({
      name: 'billingConnection',
      type: 'mssql',
      host: 'localhost',
      port: 1433, // Ensure TCP/IP is enabled in SQL Server Configuration Manager
      username: 'cwasa_platform_app',
      password: 'ChangeMe_App#2026', // Password set in Script 03
      database: 'CWASABILL_TEST',
      extra: { 
        trustServerCertificate: true,
        // Uncomment if using named instance without default port: 
        // instanceName: 'SQLEXPRESS',
      },
      synchronize: false, // CRITICAL: Never alter billing tables
      autoLoadEntities: true,
    }),

    // CONNECTION 2: Read/Write App Data
    TypeOrmModule.forRoot({
      name: 'default', // Default connection
      type: 'mssql',
      host: 'localhost',
      port: 1433,
      username: 'cwasa_platform_app',
      password: 'ChangeMe_App#2026',
      database: 'CWASA_PLATFORM_DEV',
      extra: { 
        trustServerCertificate: true,
        // instanceName: 'SQLEXPRESS',
      },
      synchronize: true, // ALLOWED: Auto-builds tables for Employees, Readings, etc.
      autoLoadEntities: true,
    }),
  ],
})
export class AppModule {}
```

---

## 5. File Upload Configuration (`src/config/multer.config.ts`)

Meter dial photos and service request photos are segregated into dedicated folders:

```typescript
import { diskStorage } from 'multer';
import { extname } from 'path';

export const readingPhotoStorage = diskStorage({
  destination: './uploads/readings',
  filename: (req, file, callback) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    callback(null, `reading-${uniqueSuffix}${extname(file.originalname || '.jpg')}`);
  },
});

export const servicePhotoStorage = diskStorage({
  destination: './uploads/service-requests',
  filename: (req, file, callback) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    callback(null, `service-${uniqueSuffix}${extname(file.originalname || '.jpg')}`);
  },
});
```

---

## 6. REST API Endpoints Specification

| HTTP Method | Endpoint | Query / Body DTO | Response | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/meter-reader/login` | `{ meterReaderId, password }` | `{ meterReader, tokens: { accessToken, refreshToken } }` | Authenticates a meter reader and returns tokens. |
| `POST` | `/api/auth/register` | `{ employeeCode, fullName, email, phoneNumber, riCode, password }` | `{ success, message }` | Registers a new meter reader account. |
| `GET` | `/api/employees/me` | *Headers: Bearer Token* | `EmployeeProfileDto` | Returns logged-in user profile, zone, and statistics. |
| `GET` | `/api/customers` | `?search=...&approvalStatus=...&page=1` | `{ data: Customer[], pendingCount, completedCount }` | Fetches filtered customer list with live dashboard counters. |
| `GET` | `/api/customers/lookup` | `?query=310245` (Account or Meter No) | `CustomerLookupDto` | **Auto-fills New Reading Form**: Returns `name`, `zone`, `previousReading`. |
| `GET` | `/api/customers/:id` | `id: number` | `CustomerDetailDto` | Returns complete customer details and previous billing history. |
| `POST` | `/api/readings` | `multipart/form-data` (fields + `photo` file) | `{ success, readingId, usageUnits }` | Submits meter reading with photo and GPS coordinates. |
| `GET` | `/api/readings/completed` | `?date=...&page=1` | `CompletedReading[]` | Returns all completed readings for the logged-in reader. |
| `POST` | `/api/readings/batch-sync`| `{ items: SyncQueueItem[] }` | `{ syncedCount, failedIds }` | Batch uploads offline readings saved on the handheld device. |
| `GET` | `/api/service-requests` | `?status=OPEN` | `ServiceRequest[]` | Retrieves all active service and meter defect tickets. |
| `POST` | `/api/service-requests`| `multipart/form-data` (fields + `photo` file) | `{ success, requestId }` | Creates a new maintenance ticket with optional defect photo. |

---

## 7. Main Project Files & Directory Structure

```text
meter-app/
├── App.tsx                   # Main application orchestrator, navigation state & screens
├── styles.ts                 # Centralized StyleSheet design system & theme tokens
├── translations.ts           # Bilingual dictionary (English & Bengali)
├── index.ts                  # Application entry point (registerRootComponent)
├── app.json                  # Expo project manifest, hardware permissions & build configs
├── package.json              # Project dependencies & npm scripts
├── tsconfig.json             # TypeScript compiler configuration
├── Dockerfile                # Production Docker container definition for web deployment
├── docker-compose.yml        # Docker compose configuration
├── nginx.conf                # Nginx web server configuration for production web hosting
├── DOCUMENTATION.md          # Platform & deployment trade-off documentation
├── README.md                 # Project quickstart guide
└── assets/                   # App icons, splash images, and custom typography fonts
    └── fonts/
        ├── RBNylo-Bold.otf   # Brand typography
```
Open Sans regular and bold are loaded from `@expo-google-fonts/open-sans`.

### Detailed File Responsibilities

| File Name | Purpose & Responsibilities | Key Symbols / Exports |
| :--- | :--- | :--- |
| [App.tsx](./App.tsx) | Core client controller. Manages application navigation, user inputs, camera and gallery capture, GPS acquisition, and renders the application screens. | `App` (default), `ScreenName`, `CustomerRecord`, `CompletedReading`, `ServiceRequest` |
| [`styles.ts`](file:///e:/READING%20APP/meter-app/styles.ts) | Houses the entire design system and styling rules (3,200+ lines). Includes color tokens, dark mode layouts, desktop dashboard wrappers, mobile cards, status badges, buttons, forms, and camera viewfinder overlays. | `styles` (StyleSheet object) |
| [`translations.ts`](file:///e:/READING%20APP/meter-app/translations.ts) | Internationalization layer providing key-value translation dictionaries for English (`LANG.en`) and Bengali (`LANG.bn`). | `LANG`, `Language` (`'en' \| 'bn'`) |
| [`index.ts`](file:///e:/READING%20APP/meter-app/index.ts) | Universal bootstrap file that calls Expo's `registerRootComponent(App)` to initialize the application on Web, Android, and iOS. | Root bootstrap |
| [`app.json`](file:///e:/READING%20APP/meter-app/app.json) | Declares platform configurations, orientation locks, splash screen settings, and native device permission plugins for `expo-camera` and `expo-location`. | Expo Configuration Manifest |
| [`package.json`](file:///e:/READING%20APP/meter-app/package.json) | Lists dependencies including `react-native`, `expo`, `expo-camera`, `expo-font`, `react-native-safe-area-context`, and build scripts. | Dependencies & scripts |
| [`Dockerfile`](file:///e:/READING%20APP/meter-app/Dockerfile) & [`nginx.conf`](file:///e:/READING%20APP/meter-app/nginx.conf) | Builds static production web bundle (`npx expo export --platform web`) and serves assets over an Alpine Nginx HTTP server. | Web containerization |

---

## 8. Complete Application Functionality & Screen Catalog

The application currently supports **16 distinct screen states and interactive flows**:

1. **Splash Screen (`splash`)**: App branding, utility emblem, dynamic loading indicator, auto-transition to Sign-In.
2. **Authentication — Sign In (`signin`)**: Employee ID and Password inputs, Remember Me toggle, validation alerts.
3. **Authentication — Registration / Sign Up (`signup`)**: Employee ID, Name, Mobile, Email, RI Code (Revenue Inspector Zone), Password, Confirm Password.
4. **Employee Profile (`profile`)**: Displays employee avatar, name (`Md Jahed`), ID (`E-10482`), zone (`MOD-1 Agrabad`), contact info, language switcher (English / বাংলা), Sign Out.
5. **Account Navigation Drawer (`drawerOpen`)**: Mobile side menu with user profile header, language toggle, and shortcuts.
6. **Meter Reading Dashboard / Customer List (`list`)**:
   - **Responsive Dual Layout**: Desktop dashboard with collapsible sidebar table vs Mobile handheld cards.
   - **Pending vs Completed Tabs**: Toggle between pending queue (`629`) and completed history (`2,143`).
   - **Live Search**: Instant matching across name, address, account number, meter number.
   - **Bill Approval Filter Modal**: Filter by `All`, `Approved`, or `Approval Required` with live counts and quick reset pill.
   - **Customer Card Details**: Outstanding amount (`৳`), due badge, approval status, complaint tag (`⚑ Complaint`).
   - **New Reading FAB**: Mobile floating action button (bottom-right) and web sidebar action.
7. **Customer Detail (`detail`)**:
   - **Tab 1: Bill Information**: Account No, Meter No, Customer Type, Connection Size, Ward, Area, Address, Phone, Due Amount, Previous Reading, Previous Date, Nearby Distance (`12 m`).
   - **Tab 2: Historical Readings**: Previous readings cycle consumption timeline.
   - **Actions**: "Enter reading" button and "Create service request".
8. **Camera Viewfinder (`camera`)**:
   - Hardware stream on Android/iOS via `expo-camera` and HTML5 MediaDevices on Web.
   - Frame guide ("Fit the whole meter face inside the frame"), camera flip, retake, photo routing to reading or complaint forms.
9. **Reading Entry (`enter`)**:
   - Dial input, real-time consumption calculation (`Current - Previous`).
   - Anomaly warnings: High consumption (≥ 100 units) requires mandatory remarks; zero-use confirmation.
   - Meter condition selector: `Normal`, `Damaged`, `Stopped`.
10. **Reading Review (`review`)**: Verification summary of entered reading data and photo thumbnail.
11. **Reading Saved / Confirmation (`saved`)**: Success screen with shortcuts to "Next Customer" or "Dashboard".
12. **New Reading Workflow (`newReading`)**:
   - Single input for Meter No or Account No.
   - **Auto-population**: Queries and fills Customer Name, MOD (Zone), and Previous Bill.
   - **Field lock**: Auto-populated fields are locked as read-only.
   - Active input for Current Bill / Reading.
   - "Access Device GPS" button captures live Latitude & Longitude.
   - Meter photo is required; capture it with the camera or choose one from the gallery. Both are resized and compressed before upload.
   - Submission is stored in the backend as Pending for admin review.
13. **Pending Readings (`list`)**: Shows only the signed-in inspector's pending submissions, scoped to their RICODE.
14. **Admin Reading Review (`admin`)**: Administrators inspect pending submission details and photo, then approve a reading.
15. **Completed Readings (`completed`)**: Shows the signed-in inspector's backend records after admin approval.
16. **Service Requests Catalog (`sr`)**: Catalog of reported meter defects (`Meter defective`, `Meter stopped`, `Glass broken`, `Other`).
17. **Create Service Request (`srnew`) & Confirmation (`srdone`)**:
   - Problem type picker, description text.
   - Photo options: "Take photo" via camera or "Choose from gallery" with image preview & remove button.
   - Success screen (`srdone`) with reference ticket confirmation.

---

## 9. Current Static Mock Data Inventory in `App.tsx`

| Entity | Location in `App.tsx` | Fields / Values to Replace with Backend & MSSQL |
| :--- | :--- | :--- |
| **Pending/Completed Readings** | Backend `app.MeterReadings` | Readings are scoped to the inspector RICODE; admin approval moves `Pending` records to `Completed`. |
| **`MOCK_SERVICE_REQUESTS`** | Lines 175–180 | 3 records: `id`, `name`, `addr`, `type` (`'Meter defective'`, `'Meter stopped'`, `'Glass broken'`). |
| **Employee Profile** | Lines 1007–1028 | Hardcoded employee: `Md Jahed`, ID: `E-10482`, Zone: `MOD-1 Agrabad`, dummy password `••••••••`. |
| **Reading Counters** | Reading list and completed screens | Loaded from the backend for the signed-in inspector. |

---

## 10. Frontend Integration Guide (Connecting `meter-app` to NestJS)

### Step 1: API Base URL and Meter-Reader Login
The centralized API base URL is configured in [`api.ts`](./api.ts). Override it with `EXPO_PUBLIC_API_BASE_URL` when needed. The sign-in form sends `{ meterReaderId, password }` to `POST /meter-reader/login`. Successful responses store `tokens.accessToken` and `tokens.refreshToken` separately: in Expo SecureStore on native platforms and in `localStorage` on web. Browser `localStorage` is not encrypted; an XSS vulnerability could expose its tokens.

To send the stored access token with an authenticated request:
```typescript
import { apiClient, getStoredAccessToken } from './api';

const accessToken = await getStoredAccessToken();
if (!accessToken) throw new Error('Access token not found');

const response = await apiClient.get('/protected-resource', {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```
`/protected-resource` is illustrative; the app does not attach tokens automatically.
### Step 3: Replace Static Data in `App.tsx`
- **Dynamic Customer Fetching**: Query `/api/customers?search=${searchText}&approvalStatus=${appliedBillFilter}` inside `useEffect`.
- **Dynamic Auto-population in New Reading**: Call `/api/customers/lookup?query=${encodeURIComponent(val)}` when user enters 4+ characters in the Meter / Account field.
- **Multipart Form Upload**: Send photo, coordinates, and reading via `FormData`:
```typescript
const formData = new FormData();
formData.append('meterOrAccount', newReadingForm.meterOrAccount);
formData.append('currentReading', newReadingForm.currentBill);
formData.append('latitude', newReadingForm.latitude);
formData.append('longitude', newReadingForm.longitude);
if (newReadingPhoto) {
  formData.append('photo', {
    uri: newReadingPhoto.uri,
    name: 'reading.jpg',
    type: 'image/jpeg',
  } as any);
}

await apiRequest('/readings', {
  method: 'POST',
  data: formData,
  headers: { Authorization: `Bearer ${authToken}` },
});
```
- **Reading approval workflow**: Inspector submissions go directly to the backend as Pending. Admin approval moves them to Completed; the app does not maintain an offline upload queue.
