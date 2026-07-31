## 2026-07-11T19:19:15Z

Please perform Milestone 2 (Backend Implementation) for the college LMS project (kedwebcbs).

Working directory: c:\Users\kde\Desktop\kedwebcbs-main\.agents\implementer_m2\
Workspace Mode: inherit
Role: Backend Developer

Your tasks:
1. Read the Milestone 1 handoff report at c:\Users\kde\Desktop\kedwebcbs-main\.agents\explorer_m1\handoff.md to understand the database schemas, route designs, and notification integration details.
2. Implement the Financials & Fees module backend:
   - Create 'models/Fee.js' ( tuition fees, payment tracking, remainingAmount virtual).
   - Create 'models/Payment.js' (payment records, methods, references).
   - Create 'routes/financial.routes.js' containing:
     - POST '/api/financials/fees' (dean only) - supports creating fee for individual student or batch-wide.
     - POST '/api/financials/payments' (dean/admin only) - creates a Payment, queries pending student fees, and allocates the payment amount sequentially in FIFO order of due dates.
     - GET '/api/financials/balance/:studentId' (dean/admin or specific student) - retrieves total fees, total paid, and calculated balance.
   - Register the financials routes in 'server.js'. Also update the API descriptive list in 'server.js' to document these new endpoints.
3. Enhance the Notification system backend:
   - Update 'routes/notification.routes.js' to capture 'target', 'batches', and 'recipients' when creating a notification via POST '/'.
   - Update GET '/' and GET '/unread-count' in 'routes/notification.routes.js' to filter notifications dynamically. A user should only see notifications where:
     - target is "all" OR
     - target is in user's roles OR
     - recipients contains user's ID OR
     - batches contains user's batch ID.
   - Implement GET '/new' in 'routes/notification.routes.js' to query new notifications created after 'lastCheck' timestamp, using the exact same filters as GET '/'.
4. Add Notification Hook Triggers to:
   - 'routes/assignment.routes.js': Trigger a notification targeted to the assignment's batches when an assignment is created.
   - 'routes/submission.routes.js': Trigger a notification targeted to the specific student (recipients) when a submission is graded (under PUT '/:id/grade').
   - 'routes/academic-event.routes.js': Trigger a notification targeted to the event's batch (batches: [req.activeBatch]) when an academic event is created.
5. Verify your backend code changes compile and load without errors. You may run temporary nodes or scripts to verify code correctness.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Save a detailed description of your changes and any test/verification output in c:\Users\kde\Desktop\kedwebcbs-main\.agents\implementer_m2\handoff.md.
