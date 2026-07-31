# Handoff Report: Milestone 1 - Exploration & Research

This report provides the detailed analysis, technical findings, and architectural plans for the enhancements to the `kedwebcbs` LMS project.

---

## 1. Observation

Based on codebase inspection, the following configurations, models, and routes were analyzed:

### A. Notifications System
* **File path**: `models/Notification.js` (Lines 26-50):
  ```javascript
  26:     target: {
  27:       type: String,
  28:       enum: ["all", "students", "doctors", "leaders"],
  29:       default: "all"
  30:     },
  ...
  40:     batches: [{
  41:       type: mongoose.Schema.Types.ObjectId,
  42:       ref: "Batch"
  43:     }],
  44: 
  45:     // المستلمون المباشرون (للإشعارات المحددة)
  46:     recipients: [{
  47:       type: mongoose.Schema.Types.ObjectId,
  48:       ref: "User"
  49:     }],
  ```
* **File path**: `routes/notification.routes.js` (Lines 11-16):
  ```javascript
  11:     const notification = await Notification.create({
  12:       title: req.body.title,
  13:       message: req.body.message,
  14:       type: req.body.type || "normal",
  15:       createdBy: req.user.id
  16:     });
  ```
  The endpoint ignores request body parameters `target`, `batches`, and `recipients` when creating a notification.
* **File path**: `routes/notification.routes.js` (Lines 50-51) & (Lines 88-90):
  ```javascript
  50:       Notification.find()
  51:         .sort({ type: -1, createdAt: -1 })
  ```
  ```javascript
  88:     const count = await Notification.countDocuments({
  89:       readBy: { $ne: req.user.id }
  90:     });
  ```
  There is no filtering logic in the retrieval routes. Users retrieve all system notifications regardless of their target, batch, or individual recipient assignments.

### B. Authentication & Authorization Middleware
* **File path**: `middleware/auth.middleware.js` (Lines 53-59):
  ```javascript
  53:     req.user = {
  54:       id: decoded.id || decoded._id || decoded.userId,
  55:       email: decoded.email,
  56:       roles: decoded.roles || decoded.role || [],
  57:       name: decoded.name,
  58:       firstLogin: decoded.firstLogin || false
  59:     };
  ```
  The authentication middleware validates the JWT token and appends a `req.user` payload containing `id`, `email`, `roles` (array), `name`, and `firstLogin`.
* **File path**: `middleware/role.middleware.js` (Lines 14-16):
  ```javascript
  14:     const hasPermission = allowedRoles.some(role =>
  15:       userRoles.includes(role)
  16:     );
  ```
  The authorization middleware checks if the authenticated user has at least one of the roles allowed for that endpoint.

### C. Student & Batch Structures
* **File path**: `models/User.js` (Lines 25-29) & (Lines 81-92):
  ```javascript
  25:   roles: {
  26:     type: [String],
  27:     enum: ["student", "leader", "doctor", "dean"],
  28:     default: ["student"]
  29:   },
  ...
  81:   // الدفعة المسجل فيها (للطلاب والليدر)
  82:   batch: {
  83:     type: mongoose.Schema.Types.ObjectId,
  84:     ref: "Batch",
  85:     default: null
  86:   },
  87: 
  88:   // الدفعات المرتبط بها (للدكاترة)
  89:   batches: [{
  90:     type: mongoose.Schema.Types.ObjectId,
  91:     ref: "Batch"
  92:   }],
  ```
  * Students and Leaders are bound to a single batch reference via the `batch` attribute.
  * Doctors are bound to multiple batches via the `batches` array reference.
  * Deans are global administrators who are not bound to specific batches.
* **File path**: `middleware/batch.middleware.js` (Lines 20-26):
  ```javascript
  20:     if (req.user.roles.includes("student") || req.user.roles.includes("leader")) {
  21:       const user = await User.findById(req.user.id).select("batch").lean();
  22:       if (!user || !user.batch) {
  23:         return res.status(403).json({ success: false, message: "حسابك غير مرتبط بأي دفعة" });
  24:       }
  25:       req.activeBatch = user.batch;
  ```
  This confirms how the active batch context is established automatically for student-related queries.

### D. Front-End Assets & UI
* **File paths**:
  * `www/css/style.css` contains variables for glassmorphic properties (such as `--glass-bg`, `--glass-blur`, `--glass-border`).
  * `www/css/mobile.css` defines mobile screen breakpoints under `@media (max-width: 900px)`.
  * Management interfaces like `www/manage-users.html` use plain standard HTML tables (`<table class="table">`), which trigger horizontal scroll issues on mobile.

---

## 2. Logic Chain

1. **Target-Filtering Requirement**:
   * Since `models/Notification.js` supports `target` (roles), `batches`, and `recipients` fields, we must update the `POST /api/notifications` route to receive and validate these fields.
   * To prevent users from seeing notifications intended for others, `GET /api/notifications` and `GET /api/notifications/unread-count` must filter by querying the active user's roles and batch membership.
   * The query should dynamically match:
     * Notifications targeted to `"all"`.
     * Notifications targeted to any role matching the user's roles (`$in: user.roles`).
     * Notifications where the user's specific ID is listed in `recipients`.
     * Notifications where the user's specific `batch` ID is listed in `batches`.

2. **Automated Notification Triggers**:
   * When assignments are posted, we want all students in the assigned batches to be notified. By hooking into `POST /api/assignments`, we can retrieve the assignment's title and batches, and programmatically insert a record into the notifications collection.
   * When submissions are graded, we want the specific student who submitted the assignment to be alerted. By hooking into `PUT /api/submissions/:id/grade`, we can pull the `student` reference and insert a direct user notification.
   * When academic events are created, we want all students within the event's batch to be notified. By hooking into `POST /api/academic-events`, we can read `req.activeBatch` and publish a batch-targeted notification.

3. **Authentication & Route Protection**:
   * Endpoints can use `authMiddleware` to establish identity (`req.user`) and `roleMiddleware` to verify required role clearances.
   * For the Financials module, the creation of fees and payments should be restricted to the `dean` role, while balance checking can be shared between the `dean` and the authenticated `student` whose balance is being queried.

4. **Financial Module Database Design**:
   * We need a `Fee` model to record charge events (tuition, fees) and their status.
   * We need a `Payment` model to document payments made.
   * Since payments must settle outstanding balances, recording a payment must dynamically query the student's pending fees, allocate the payment amount in order of due date (FIFO), and update the corresponding fee status properties (`pending` -> `partially_paid` -> `paid`).

5. **Front-End Styling**:
   * Responsive layout checks on table-heavy views (e.g. `manage-users.html`) show that switching from tabular structures to flexbox cards on mobile views will prevent overflowing elements.
   * The visual polish can be enhanced by converting static gray headers and backgrounds into glassmorphic cards using the existing CSS tokens.

---

## 3. Caveats

* **Offline/Native App Behavior**: Mobile push notifications (FCM) are supported in user profiles (`fcmTokens` array in `User.js`). Our backend triggers must integrate seamlessly with local Mongo database creation, but sending push notifications to actual devices via FCM is outside the immediate scope unless FCM service initializers are configured.
* **FIFO Fee Settle Edge Case**: If a student pays *more* than their total outstanding fees, the remaining payment amount must be stored as an unallocated credit balance. Our design includes a `creditBalance` attribute on the student user profile or handles this by tracking unallocated payments.
* **Archived Batches**: `middleware/batch.middleware.js` automatically prevents access to archived batches. Our financial design assumes that fees cannot be generated for students in archived batches.

---

## 4. Conclusion

The application is a standard, robust Express/Mongoose web app. Implementing Milestone 2 will require modifying route handlers to support structured query filters, appending trigger functions to existing route files, creating financial models/routes, and applying styling adjustments.

Below are the detailed model structures, API route contracts, and testing specifications.

### A. Database Schema Design (Financials & Fees)

#### 1. Fee Model Schema (`models/Fee.js`)
```javascript
const mongoose = require("mongoose");

const FeeSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    title: {
      type: String,
      required: [true, "عنوان الرسم مطلوب"],
      trim: true
    },
    amount: {
      type: Number,
      required: [true, "القيمة مطلوبة"],
      min: [0, "القيمة لا يمكن أن تكون سالبة"]
    },
    dueDate: {
      type: Date,
      required: [true, "تاريخ الاستحقاق مطلوب"]
    },
    status: {
      type: String,
      enum: ["pending", "partially_paid", "paid"],
      default: "pending",
      index: true
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { timestamps: true }
);

// Virtual property to calculate remaining balance on the fee
FeeSchema.virtual("remainingAmount").get(function() {
  return Math.max(0, this.amount - this.paidAmount);
});

module.exports = mongoose.model("Fee", FeeSchema);
```

#### 2. Payment Model Schema (`models/Payment.js`)
```javascript
const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: [true, "قيمة الدفع مطلوبة"],
      min: [0.01, "قيمة الدفع يجب أن تكون أكبر من صفر"]
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ["cash", "bank_transfer", "card", "deposit"]
    },
    reference: {
      type: String,
      required: [true, "رقم المرجع/الإيصال مطلوب"],
      unique: true,
      trim: true
    },
    paymentDate: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      trim: true
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", PaymentSchema);
```

---

### B. Endpoints & API Route Contracts (Financials & Fees)

The routes will be registered at `/api/financials` and handled in `routes/financial.routes.js`.

#### 1. POST `/api/financials/fees`
* **Access**: `dean` only
* **Function**: Creates a fee for an individual student or iterates over all active students in a batch to create batch-wide fees.
* **Request Body**:
  ```json
  {
    "studentId": "65b9c03b1234567890abcdef", // Optional if batchId provided
    "batchId": "65b9c03b1234567890abc111",   // Optional if studentId provided
    "title": "رسوم دراسية الفصل الأول 2026",
    "amount": 150000,
    "dueDate": "2026-09-30T00:00:00.000Z"
  }
  ```
* **Processing logic**:
  * If `studentId` is provided: Create a single fee.
  * If `batchId` is provided: Fetch all active users with role `student` matching `batch: batchId` and create a fee document for each.
* **Response (Success 201)**:
  ```json
  {
    "success": true,
    "message": "تم إضافة الرسوم بنجاح",
    "count": 1
  }
  ```

#### 2. POST `/api/financials/payments`
* **Access**: `dean` or `admin`
* **Function**: Records a student payment and allocates the amount to outstanding fees (FIFO order).
* **Request Body**:
  ```json
  {
    "studentId": "65b9c03b1234567890abcdef",
    "amount": 200000,
    "paymentMethod": "bank_transfer",
    "reference": "TXN987654321",
    "notes": "الدفعة الأولى للرسوم الدراسية"
  }
  ```
* **Processing logic**:
  * Save the `Payment` document.
  * Query all `Fee` documents for the student with status `$ne: "paid"`, sorted by `dueDate: 1`.
  * Allocate the payment amount sequentially:
    * Deduct from the oldest fee's remaining balance.
    * If fully settled, set status to `paid`.
    * If partially settled, set status to `partially_paid` and increment `paidAmount`.
* **Response (Success 201)**:
  ```json
  {
    "success": true,
    "message": "تم تسجيل الدفع بنجاح وتحديث الرسوم المتعلقة",
    "payment": { ... }
  }
  ```

#### 3. GET `/api/financials/balance/:studentId`
* **Access**: `dean` or the specific `student` matching `:studentId`
* **Function**: Returns calculated totals and current outstanding balance.
* **Response (Success 200)**:
  ```json
  {
    "success": true,
    "studentId": "65b9c03b1234567890abcdef",
    "totalFees": 350000,
    "totalPaid": 200000,
    "balance": 150000
  }
  ```

---

### C. Proposed Notifications Integration Plan

#### 1. Target-Filtering Implementation
In `routes/notification.routes.js`:
* Read parameters from body:
  ```javascript
  const notification = await Notification.create({
    title: req.body.title,
    message: req.body.message,
    type: req.body.type || "normal",
    target: req.body.target || "all",
    batches: req.body.batches || [],
    recipients: req.body.recipients || [],
    createdBy: req.user.id
  });
  ```
* Filter database queries for fetching:
  ```javascript
  const user = await User.findById(req.user.id).select("batch roles");
  const query = {
    $or: [
      { target: "all" },
      { target: { $in: user.roles } },
      { recipients: req.user.id }
    ]
  };
  if (user.batch) {
    query.$or.push({ batches: user.batch });
  }
  // Apply query to Notification.find(query) and Notification.countDocuments(query)
  ```

#### 2. Automatic Notification Hooks
* **Assignment Created**:
  * In `routes/assignment.routes.js` `POST /`:
  ```javascript
  await Notification.create({
    title: `تكليف جديد: ${assignment.title}`,
    message: `تم إضافة واجب جديد لمادة ${subject.name}. تاريخ التسليم النهائي: ${assignment.dueDate}`,
    type: "normal",
    target: "students",
    batches: assignment.batches,
    createdBy: req.user.id
  });
  ```
* **Submission Graded**:
  * In `routes/submission.routes.js` `PUT /:id/grade`:
  ```javascript
  await Notification.create({
    title: "تم رصد درجة التكليف",
    message: `تم تقييم تسليمك للواجب "${assignment.title}". الدرجة: ${grade}/100`,
    type: "normal",
    target: "students",
    recipients: [submission.student],
    createdBy: req.user.id
  });
  ```
* **Academic Event Created**:
  * In `routes/academic-event.routes.js` `POST /`:
  ```javascript
  await Notification.create({
    title: `فعالية جديدة: ${event.title}`,
    message: `تمت إضافة فعالية أكاديمية جديدة للجدول: ${event.title} في تاريخ ${event.startsAt}`,
    type: "normal",
    target: "students",
    batches: [req.activeBatch],
    createdBy: req.user.id
  });
  ```

---

### D. UI/UX Design Survey & Front-end Integration

1. **Required UI Polish**:
   * **Responsiveness**: Elements such as navigation bars and table views in management screens (`manage-users.html`, `manage-batches.html`) will be updated in CSS to stack card layouts on mobile (`@media (max-width: 900px)`) instead of table rows.
   * **Glassmorphism Integration**: Convert structural containers (like headers, search bars, sidebars) to use the existing variables `--glass-bg`, `--glass-blur`, and `--glass-border` with `backdrop-filter: blur(10px)`.

2. **Integration of Financial Screens**:
   * Create `www/financials.html` layout utilizing a unified dashboard template.
   * For **Students**: Displays dynamic dashboard elements containing "Balance Due" card, "Paid Fees" card, and a table showing a log of billing charges and payments.
   * For **Deans**: Adds buttons/modals to:
     * Assign new fees (by batch or individual student).
     * Record a payment (form with Student Search, Amount, Payment Method, Reference, and Notes).
     * Print receipts/reports.

---

### E. Backend Testing Setup (Jest & Supertest)

A automated testing suite is recommended using **Jest** and **Supertest**.

#### 1. Configuration in `package.json`
```json
"scripts": {
  "test": "cross-env NODE_ENV=test jest --runInBand --detectOpenHandles --forceExit"
}
```

#### 2. Test Setup (`tests/setup.js`)
```javascript
const mongoose = require("mongoose");
require("dotenv").config({ path: ".env.test" });

beforeAll(async () => {
  const url = process.env.MONGO_URI_TEST || "mongodb://localhost:27017/kedwebcbs_test";
  await mongoose.connect(url);
});

afterAll(async () => {
  await mongoose.connection.close();
});

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});
```

#### 3. Test Example (`tests/financial.test.js`)
```javascript
const request = require("supertest");
const app = require("../app"); // Make sure server.js exports the app
const User = require("../models/User");
const Batch = require("../models/Batch");
const Fee = require("../models/Fee");

describe("Financials Module APIs", () => {
  let deanToken, studentToken, studentId;

  beforeEach(async () => {
    // 1. Create a batch
    const batch = await Batch.create({ name: "Batch 2026", code: "B2026" });

    // 2. Create dean & student users
    const dean = await User.create({
      name: "Dean User",
      email: "dean@university.edu",
      password: "password123",
      roles: ["dean"]
    });
    const student = await User.create({
      name: "Student User",
      email: "student@university.edu",
      password: "password123",
      roles: ["student"],
      batch: batch._id
    });
    studentId = student._id.toString();

    // 3. Log in users to get tokens
    const deanLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "dean@university.edu", password: "password123" });
    deanToken = deanLogin.body.token;

    const studentLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "student@university.edu", password: "password123" });
    studentToken = studentLogin.body.token;
  });

  test("POST /api/financials/fees - Dean can create a student fee", async () => {
    const res = await request(app)
      .post("/api/financials/fees")
      .set("Authorization", `Bearer ${deanToken}`)
      .send({
        studentId,
        amount: 1000,
        title: "Registration Fee",
        dueDate: new Date()
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.fee.amount).toBe(1000);
  });

  test("POST /api/financials/fees - Student cannot create a fee", async () => {
    const res = await request(app)
      .post("/api/financials/fees")
      .set("Authorization", `Bearer ${studentToken}`)
      .send({ studentId, amount: 1000, title: "Hack Fee", dueDate: new Date() });

    expect(res.status).toBe(403);
  });
});
```

---

### F. API Documentation Structure

To cover >=80% of routes, the project will maintain a Markdown API document under `docs/API_DOCUMENTATION.md` structured as follows:

```markdown
# College LMS API Documentation

## Auth Module
* `POST /api/auth/login` - Authenticate user credentials and retrieve JWT.
* `POST /api/auth/register` - Create user accounts (Dean only).
* `POST /api/auth/force-change-password` - Mandatory password update on first login.

## Notifications Module
* `POST /api/notifications` - Create custom notification (Dean/Doctor/Leader). Supports targets (roles, batches, users).
* `GET /api/notifications` - Retrieve list of notifications matching user context.
* `GET /api/notifications/unread-count` - Fetch unread notifications count.
* `POST /api/notifications/read/:id` - Mark a notification as read.

## Financials & Fees Module
* `POST /api/financials/fees` - Assign tuition fee/bills (Dean only).
* `POST /api/financials/payments` - Log payments against student records (Dean/Admin only).
* `GET /api/financials/balance/:studentId` - Retrieve payment summaries and balance dues (Dean/Student).

... [Other modules such as Courses, Assignments, Submissions, Quizzes, Attendance]
```

---

## 5. Verification Method

To verify the setup independently:
1. **Source Inspection**: Use `view_file` to inspect `routes/notification.routes.js` and verify target filtering matches the logic chain schema.
2. **API Verification**: When route changes are implemented in Milestone 2, run manual curls to verify access controls:
   ```bash
   # Test auth middleware blocks requests without tokens
   curl -i http://localhost:5000/api/financials/balance/someStudentId
   ```
3. **Execution of Automated Tests**:
   Run the test commands:
   ```bash
   npm test
   ```
   Verify that Jest outputs execution reports with 100% test pass rate.
