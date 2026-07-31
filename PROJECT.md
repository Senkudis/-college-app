# Project: College LMS Improvements (kedwebcbs)

## Architecture
The application is a College Learning Management System (LMS) with:
- **Backend**: Node.js & Express.js. MongoDB database with Mongoose ODM schemas.
- **Frontend**: Raw HTML/CSS/JS served statically by Express (`www` folder).
- **Core Modules**:
  - Auth, Users, Batches, Subjects, Lectures, Assignments, Submissions, Attendance, Academic Events, Campus, Quizzes, Reports.
  - **New module**: Financials (fees, payments, balances).
  - **Enhanced module**: Notifications (targeted delivery, automated alert triggers).

## Code Layout
- `models/`: Database schemas (User, Notification, Batch, Fee, Payment, etc.).
- `routes/`: Express route handlers (`auth.routes.js`, `financial.routes.js`, etc.).
- `middleware/`: Middleware files (`auth.middleware.js`, `role.middleware.js`).
- `www/`: Front-end web screens (`login.html`, `dashboard.html`, `financials.html`, etc.).
- `config/`: Database configurations.
- `utils/`: Common helpers (`response.js`).

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Exploration & Research | Analyze codebase, design financial models, plan API test/docs structure | None | DONE |
| M2 | Backend Implementation | Build Financial models & routes, update Notification models & routes, trigger alerts | M1 | DONE |
| M3 | Frontend UI/UX Integration | Create/integrate financials screen, polish CSS, ensure mobile responsiveness | M2 | DONE |
| M4 | Launch Prep (Tests & Docs) | Build API tests, configure `npm test`, generate API docs | M2 | DONE |
| M5 | Verification & Auditing | Run AC verification scripts, run adversarial testing, perform forensic integrity audit | M3, M4 | DONE |

## Interface Contracts

### 1. Financials & Fees API (`/api/financials`)
- **POST `/api/financials/fees`** (dean only)
  - Creates a tuition fee or other charges for a student or batch.
  - Body: `{ studentId: string, amount: number, title: string, dueDate: date }`
  - Response: `{ success: true, fee: Object }`
- **POST `/api/financials/payments`** (dean/admin only)
  - Records a payment against student fees.
  - Body: `{ studentId: string, amount: number, paymentMethod: string, reference: string }`
  - Response: `{ success: true, payment: Object }`
- **GET `/api/financials/balance/:studentId`** (dean/student)
  - Gets the current student balance (fees minus payments).
  - Response: `{ success: true, balance: number, totalFees: number, totalPaid: number }`

### 2. Notifications API (`/api/notifications`)
- **POST `/api/notifications`** (dean/doctor/leader)
  - Sends a notification to all, specific roles, specific batches, or specific users.
  - Body: `{ title: string, message: string, type: 'normal'|'emergency', target: 'all'|'students'|'doctors'|'leaders', batches: [string], recipients: [string] }`
  - Response: `{ success: true, notification: Object }`
- **GET `/api/notifications`** (authenticated users)
  - Retrieves notifications filtered for the logged-in user's role, batch, or individual ID.
  - Response: `{ success: true, data: Array }`
