# Handoff Report: Milestone 2 - Backend Implementation

This report details the implementation of Milestone 2 (Backend Implementation) for the College LMS project (`kedwebcbs`).

---

## 1. Observation

Based on the instructions and subsequent codebase inspection, the following files were analyzed, created, and modified:

* **File Path (New)**: `models/Fee.js`
  Created the schema containing:
  ```javascript
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  dueDate: { type: Date, required: true },
  status: { type: String, enum: ["pending", "partially_paid", "paid"], default: "pending" },
  paidAmount: { type: Number, default: 0 },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  ```
  Includes a virtual attribute `remainingAmount` calculating the outstanding amount on the fee.

* **File Path (New)**: `models/Payment.js`
  Created the schema containing:
  ```javascript
  student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  amount: { type: Number, required: true, min: 0.01 },
  paymentMethod: { type: String, required: true, enum: ["cash", "bank_transfer", "card", "deposit"] },
  reference: { type: String, required: true, unique: true },
  paymentDate: { type: Date, default: Date.now },
  notes: { type: String },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  ```

* **File Path (New)**: `routes/financial.routes.js`
  Implemented endpoints for the Financials & Fees module:
  * `POST /fees`: Allows deans to create single or batch-wide fees.
  * `POST /payments`: Logs a payment and applies the amount sequentially in FIFO order of fee due dates.
  * `GET /balance/:studentId`: Calculates totals and outstanding balance.

* **File Path (Modified)**: `server.js`
  Registered `/api/financials` and documented the new endpoints under `app.get("/api")`.

* **File Path (Modified)**: `routes/notification.routes.js`
  * Capture `target`, `batches`, and `recipients` on `POST /`.
  * Filter query in `GET /` and `GET /unread-count` so users only see target-relevant notifications.
  * Implemented `GET /new` to fetch notifications created after a `lastCheck` timestamp using the same filters.

* **File Path (Modified)**: `routes/assignment.routes.js`
  Trigger notification targeting assignment's batches when an assignment is created:
  ```javascript
  await Notification.create({
    title: `تكليف جديد: ${assignment.title}`,
    message: `تم إضافة واجب جديد لمادة ${subjectName}. تاريخ التسليم النهائي: ${assignment.dueDate}`,
    ...
  });
  ```

* **File Path (Modified)**: `routes/submission.routes.js`
  Trigger notification targeting specific student when a submission is graded under `PUT /:id/grade`:
  ```javascript
  await Notification.create({
    title: "تم رصد درجة التكليف",
    message: `تم تقييم تسليمك للواجب "${assignmentTitle}". الدرجة: ${grade}/100`,
    ...
  });
  ```

* **File Path (Modified)**: `routes/academic-event.routes.js`
  Trigger notification targeting the event's batch context when an academic event is created:
  ```javascript
  await Notification.create({
    title: `فعالية جديدة: ${event.title}`,
    message: `تمت إضافة فعالية أكاديمية جديدة للجدول: ${event.title} في تاريخ ${event.startsAt}`,
    ...
  });
  ```

---

## 2. Logic Chain

1. **FIFO Payment Allocation**:
   To ensure payments settle outstanding fees correctly, the allocation logic must:
   - Sort student fees in chronological order of `dueDate: 1`.
   - Exclude already paid fees (`status: { $ne: "paid" }`).
   - Deduct payment amounts sequentially until the payment amount is exhausted or all fees are fully paid.
   - Update fee statuses (`paid`, `partially_paid`) accordingly and save changes.

2. **Targeted Notification Filtering**:
   Users should not see system-wide administrative notifications that are not directed to them.
   - The query filters by:
     - `target: "all"`
     - `target: { $in: req.user.roles }`
     - `recipients: req.user.id`
     - `batches: user.batch` (for students/leaders) or `batches: { $in: user.batches }` (for doctors).
   - This ensures secure, localized notification delivery.

3. **Notification Hooks**:
   By adding inline notification triggers directly within relevant route handlers, we automate updates for assignments, grades, and academic events dynamically without requiring manual notification generation.

---

## 3. Caveats

* **Credit Balances**: If a student makes an overpayment exceeding their total outstanding fees, the remaining payment amount is logged in the `Payment` document, but it does not roll over as a dynamic credit balance deduction on future fees.
* **Notification Silencing**: Notification triggers run within try-catch blocks. If a notification fail-to-save error occurs, the primary action (creating assignments, grading, or creating academic events) still succeeds.

---

## 4. Conclusion

All Backend requirements for Milestone 2 have been completed, verified via code inspection, and integrated into the LMS codebase.

---

## 5. Verification Method

To verify the changes:
1. Run the Express server: `npm start` (if a database connection is available).
2. Inspect the registered routes in `server.js` and verify they import correctly.
3. Validate API documentation at `http://localhost:5000/api` to verify the new endpoints are listed.
