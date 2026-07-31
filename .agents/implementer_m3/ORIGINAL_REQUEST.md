## 2026-07-11T19:24:42Z

Please perform Milestone 3 (Frontend UI/UX Integration & Polish) for the college LMS project (kedwebcbs).

Working directory: c:\Users\kde\Desktop\kedwebcbs-main\.agents\implementer_m3\
Workspace Mode: inherit
Role: Frontend Developer

Your tasks:
1. Create 'www/financials.html':
   - Implement a unified layout utilizing style.css, dashboard.css, and app.js (which contains the CBS helper class).
   - The page must adapt based on the user role (CBS.getUser().roles):
     - For Students: Render a dashboard with summary cards (Total Fees, Total Paid, Balance Due) using the modern glassmorphic classes (e.g. '.card-glass'), followed by a breakdown table of fees and a history table of payments.
     - For Deans: Render an Admin Financial dashboard with:
       - "Create Fee" form (support assigning fee to a single student or batch-wide). Load active batches and student dropdowns/autocomplete.
       - "Record Payment" form (select student, input amount, payment method cash/bank_transfer/card/deposit, reference receipt number, notes).
       - "Balances Registry": list of students with their total fees, paid, and balance, with a "View Details" action to check individual billing breakdowns.
   - Use CBS.apiGet/CBS.apiPost to communicate with the backend financials endpoints (/api/financials/fees, /api/financials/payments, /api/financials/balance/:id) and use CBS.toast for user notifications.
2. Integrate the Financials link into all page sidebars (nav bars) in the www/ directory:
   - Pages to modify include: dashboard.html, admin_dashboard.html, manage-users.html, manage-batches.html, manage-subjects.html, manage-lectures.html, manage-assignments.html, manage-attendance.html, manage-notifications.html, notifications.html, reports.html, subjects.html, assignments.html, etc.
   - Link: <a href="/financials.html" class="nav-item"><i class="ri-money-dollar-circle-line"></i><span>الرسوم المالية</span></a> (or inline Arabic labels matching standard sidebars).
3. Polish UI/UX and mobile responsiveness:
   - Identify tables in the system (e.g. manage-users, manage-batches, manage-notifications, and your new financials lists) and ensure they are responsive.
   - If tables overflow on mobile screens (< 900px), apply CSS media queries to refactor them into card block structures.
   - Apply existing glassmorphic variables (--glass-bg, --glass-blur, --glass-border, and backdrop-filter) to structural panels like sidebars, search cards, and dialogs.
4. Test and verify all front-end assets load correctly, compile, and run without syntax/runtime errors.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Save a detailed description of your changes in c:\Users\kde\Desktop\kedwebcbs-main\.agents\implementer_m3\handoff.md.
