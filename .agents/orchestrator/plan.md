# Master Plan — College LMS Improvements (kedwebcbs)

## Objectives
1. **Financials & Fees Management Module**: Build models/routes to track student fees, payments, balances, late dues. Create UI/UX for students to view, and admins/deans to manage.
2. **Robust Notification System**: Update model and routes to restrict/target notifications to specific users or batches. Add notification triggers on assignment creation, grading, and academic events.
3. **UI/UX Polish**: Apply modern style (glassmorphism, animations, dark mode) and guarantee mobile responsiveness across all frontend screens.
4. **Launch Preparation**: Build a comprehensive backend API test suite (running via `npm test`) and generate detailed API documentation covering >=80% of routes.

---

## Decomposed Milestones

### Milestone 1: Exploration & Research
- **Objective**: Analyze the codebase, review existing schemas, middlewares, routes, and UI styling, and draft the design for the Financials module.
- **Assigned to**: `teamwork_preview_explorer` (Research Agent)
- **Verification**: Exploration report saved in `.agents/explorer_research/handoff.md`.

### Milestone 2: Implementation of Backend Features (Financials & Notifications)
- **Objective**: 
  - Create the `Financial` (or `Fee` / `Payment`) model and routes. Register it in `server.js`.
  - Update `Notification` schema & routes to filter notifications by target batch or target user.
  - Integrate automated notification triggers (on assignment creation, submission grading, academic events).
- **Assigned to**: `teamwork_preview_worker` (Backend Implementer)
- **Verification**: Test endpoints manually, ensure MongoDB collections are populated correctly.

### Milestone 3: Frontend UI/UX Integration & Polish
- **Objective**:
  - Build `financials.html` and UI components for fees management.
  - Implement notification center UI improvements (in `notifications.html`, `manage-notifications.html`, and dashboard notifications lists).
  - Apply glassmorphism CSS, animations, and verify complete mobile responsiveness on all views.
- **Assigned to**: `teamwork_preview_worker` (Frontend Implementer)
- **Verification**: Reviewer checks HTML/CSS files for responsiveness and design tokens.

### Milestone 4: Launch Prep - API Tests & Documentation
- **Objective**:
  - Create a test runner and write comprehensive test cases (at least covering core modules like Auth, Users, Subjects, Lectures, Assignments, Submissions, Financials, and Notifications).
  - Configure `npm test` to run these tests.
  - Generate a detailed API documentation file (Markdown or Swagger) covering at least 80% of routes.
- **Assigned to**: `teamwork_preview_worker` (QA & Docs Implementer)
- **Verification**: Running `npm test` succeeds with 0 failures, and document contains the endpoints.

### Milestone 5: Verification & Auditing
- **Objective**:
  - Run the verification scripts for Acceptance Criteria:
    1. Financials verification script (create fee, record payment, check balance).
    2. Notifications verification script (trigger notification, check unread list).
  - Spawn `teamwork_preview_challenger` to write and run adversarial/stress tests.
  - Spawn `teamwork_preview_auditor` to verify integrity and correctness of implementation.
- **Assigned to**: `teamwork_preview_challenger` & `teamwork_preview_auditor`
- **Verification**: Verification scripts run and exit successfully; Auditor gives a CLEAN verdict.
