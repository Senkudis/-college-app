# Handoff Report — Milestone 4 (Launch Prep - API Tests & Documentation)

This report outlines the observations, reasoning, implementation, and verification steps for completing the Milestone 4 tasks.

---

## 1. Observation
- **Node.js Environment**: The local Node.js version is `v24.14.0` (as verified by `node -v`). This version includes native support for the `node:test` test runner and global `fetch` / `FormData` / `Blob` APIs.
- **Database Connection Check**: In `config/db.js`, the server exits with a status code of 1 if the MongoDB URI is not set:
  ```javascript
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI غير موجود في متغيرات البيئة");
    process.exit(1);
  }
  ```
- **Registered Routes**: The LMS system routes are loaded inside `server.js` using `app.use("/api/...", ...)` for various modules including `/api/auth`, `/api/users`, `/api/subjects`, `/api/lectures`, `/api/assignments`, `/api/submissions`, `/api/financials`, and `/api/notifications`.
- **Response Wrapper**: Responses from key routes (like `/api/subjects` and `/api/submissions/submit`) use a unified response utility `success` in `utils/response.js` which nests the data under a `data` key (e.g., `res.data.data.subject._id`).

---

## 2. Logic Chain
- **Decoupling Database Driver**: Since the test suite must run offline under network isolation, running Mongoose's normal compilation throws errors when trying to connect to a non-existent database or initialize collections via the MongoDB driver. 
- **In-Memory Mongoose Simulator**: To resolve the connection crash while preserving the application's controller logic and schema hooks (like password hashing and input validations), we monkeypatched `mongoose.model` to return a mock class constructor. This simulator handles standard database methods (`find`, `findOne`, `create`, `updateOne`, `deleteMany`, `findByIdAndUpdate`, `populate`, `save`, and `countDocuments`) entirely in-memory using a JavaScript array store.
- **Dynamic Port Allocation**: To prevent port conflicts when running tests, Express's `app.listen()` prototype method was monkeypatched to override any requested port to `0`, causing the operating system to automatically allocate a free port.
- **Full Route Coverage**: Built 30 test cases in `routes/api.test.js` targeting:
  - **Auth**: Correct and incorrect credentials login, dean-only user registration.
  - **Users**: Admin-only listing of users, user creation.
  - **Subjects**: Creation and retrieval of academic subjects.
  - **Lectures**: Dean/doctor upload of lecture details and file attachments.
  - **Assignments**: Uploading PDF assignments for specific batches.
  - **Submissions**: Student submissions and teacher grading updates.
  - **Financials**: tuition fees, sequential FIFO payment allocation, student balance checking, and total balance lists.
  - **Notifications**: Notification broadcasting, student retrieval filtering, and read/unread markings.
- **Comprehensive API Documentation**: Generated `API_DOCUMENTATION.md` detailing over 80% of all registered routes, complete with request schemas, authorization levels, and response shapes.

---

## 3. Caveats
- **Attachment uploads**: Standard `Blob` and `FormData` buffers are accepted by Multer. When running tests, mock files are written to the `uploads/` folder and cleaned up subsequently where applicable, though these files remain locally generated under the root directory.
- **Cron Jobs**: The background `node-cron` scheduler has been stubbed during testing to prevent timer loops from keeping the process alive after server shutdown.

---

## 4. Conclusion
- The backend API test suite is successfully configured and running offline via the custom in-memory database simulator.
- `npm test` runs cleanly and reports 30 out of 30 tests passing.
- The `API_DOCUMENTATION.md` file correctly describes all core routes with accurate payloads.

---

## 5. Verification Method
- **Command**: Run `npm test` inside the project root (`c:\Users\kde\Desktop\kedwebcbs-main\`).
- **Files to Inspect**:
  - `routes/test-helper.js` (Mongoose simulation and server startup/port handling)
  - `routes/api.test.js` (Test cases mapping)
  - `config/db.js` (Bypassed MongoDB check for test environment)
  - `package.json` (Configuration of the test script)
  - `API_DOCUMENTATION.md` (API documentation)
- **Invalidation Condition**: If any test fails, or if running `npm test` times out or throws DB connection errors, Handoff verification is considered failed.
