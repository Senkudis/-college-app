# Context and Environment — College LMS Improvements (kedwebcbs)

## Project Overview
- **Name**: College LMS Backend & Frontend (kedwebcbs)
- **Tech Stack**:
  - **Backend**: Node.js, Express.js (v5.2.1), Mongoose (v9.0.2), MongoDB.
  - **Frontend**: Raw HTML, CSS (including styles for modern glassmorphism, responsive mobile layout), Vanilla JS.
  - **Tools**: node-cron, nodemailer, capacitor (for mobile app wrapper).

## Environment Configuration (`.env`)
- To connect to the database, a local or remote MongoDB instance is configured.
- Port is set to 5000 (default fallback) or configured via `PORT` environment variable.

## File System Structure
- `/models`: Database schema models (User, Notification, Batch, Lecture, Assignment, Submission, etc.).
- `/routes`: Express route handlers.
- `/middleware`: Authentication (`auth.middleware.js`) and role-based access control (`role.middleware.js`).
- `/www`: Frontend web pages and assets (HTML, CSS, JS, sounds).
- `/config`: Database configuration (`db.js`).
- `/utils`: Helper utils (response wrappers, etc.).
