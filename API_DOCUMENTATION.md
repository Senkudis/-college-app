# College LMS API Documentation (kedwebcbs)

This file documents the API routes registered in `server.js` for the college LMS backend system.

---

## Table of Contents
1. [Authentication API (`/api/auth`)](#1-authentication-api-apiauth)
2. [Users API (`/api/users`)](#2-users-api-apiusers)
3. [Token Verification API (`/api/verify-token`)](#3-token-verification-api-apiverify-token)
4. [Subjects API (`/api/subjects`)](#4-subjects-api-apisubjects)
5. [Lectures API (`/api/lectures`)](#5-lectures-api-apilectures)
6. [Assignments API (`/api/assignments`)](#6-assignments-api-apiassignments)
7. [Submissions API (`/api/submissions`)](#7-submissions-api-apisubmissions)
8. [Financials API (`/api/financials`)](#8-financials-api-apifinancials)
9. [Notifications API (`/api/notifications`)](#9-notifications-api-apinotifications)
10. [Batches API (`/api/batches`)](#10-batches-api-apibatches)
11. [Videos & Discussions API (`/api/videos`)](#11-videos--discussions-api-apivideos)
12. [Attendance API (`/api/attendance`)](#12-attendance-api-apiattendance)

---

## 1. Authentication API (`/api/auth`)

### 1.1 POST `/api/auth/login`
- **Description**: Authenticate user and issue a JWT token.
- **Role Clearance**: Public (None)
- **Request Body**:
  ```json
  {
    "email": "dean@college.edu",
    "password": "password123"
  }
  ```
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "message": "تم تسجيل الدخول بنجاح",
    "token": "eyJhbGciOiJIUzI1NiIsIn...",
    "user": {
      "id": "60d0fe4f5311236168a109a1",
      "name": "Dean User",
      "email": "dean@college.edu",
      "roles": ["dean"],
      "firstLogin": false
    }
  }
  ```
- **Response Failure (401 Unauthorized)**:
  ```json
  {
    "success": false,
    "message": "بيانات الدخول غير صحيحة"
  }
  ```

### 1.2 POST `/api/auth/register`
- **Description**: Register a new user account (student, leader, doctor, dean).
- **Role Clearance**: `dean` only (Requires Bearer Token)
- **Request Body**:
  ```json
  {
    "name": "New Student",
    "email": "newstudent@college.edu",
    "password": "password123",
    "roles": ["student"],
    "batch": "6688f111e111111111111111"
  }
  ```
- **Response Success (201 Created)**:
  ```json
  {
    "success": true,
    "message": "تم إنشاء المستخدم بنجاح",
    "data": {
      "user": {
        "id": "60d0fe4f5311236168a109a5",
        "name": "New Student",
        "email": "newstudent@college.edu",
        "roles": ["student"],
        "batch": "6688f111e111111111111111",
        "firstLogin": true,
        "isActive": true
      }
    }
  }
  ```
- **Response Failure (400 Bad Request)**:
  ```json
  {
    "success": false,
    "message": "البريد الإلكتروني مسجل مسبقاً"
  }
  ```

---

## 2. Users API (`/api/users`)

### 2.1 GET `/api/users`
- **Description**: Fetch all user accounts with pagination.
- **Role Clearance**: `dean` only
- **Query Parameters**:
  - `page`: Page number (default: 1)
  - `limit`: Items per page (default: 30, max: 100)
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "count": 1,
    "users": [
      {
        "_id": "60d0fe4f5311236168a109a1",
        "name": "Dean User",
        "email": "dean@college.edu",
        "roles": ["dean"],
        "isActive": true
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 30,
      "total": 1,
      "pages": 1,
      "hasMore": false
    }
  }
  ```

### 2.2 POST `/api/users`
- **Description**: Alternate route to create a user account.
- **Role Clearance**: `dean` only
- **Request Body**:
  ```json
  {
    "name": "John Doe",
    "email": "johndoe@college.edu",
    "password": "securepassword",
    "roles": ["student"]
  }
  ```
- **Response Success (201 Created)**:
  ```json
  {
    "success": true,
    "message": "تم إنشاء المستخدم بنجاح",
    "user": {
      "_id": "60d0fe4f5311236168a109af",
      "name": "John Doe",
      "email": "johndoe@college.edu",
      "roles": ["student"],
      "isActive": true
    }
  }
  ```

---

## 3. Token Verification API (`/api/verify-token`)

### 3.1 GET `/api/verify-token`
- **Description**: Verify JWT token validity and return current logged-in user profile payload.
- **Role Clearance**: Authenticated Users (`student`/`leader`/`doctor`/`dean`)
- **Headers**: `Authorization: Bearer <token>`
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "user": {
      "id": "60d0fe4f5311236168a109a1",
      "email": "dean@college.edu",
      "roles": ["dean"],
      "name": "Dean User",
      "firstLogin": false
    }
  }
  ```

---

## 4. Subjects API (`/api/subjects`)

### 4.1 POST `/api/subjects`
- **Description**: Register a new subject.
- **Role Clearance**: `dean` or `doctor`
- **Request Body**:
  ```json
  {
    "name": "Web Development",
    "level": "Level 3",
    "doctor": "60d0fe4f5311236168a109a2"
  }
  ```
- **Response Success (201 Created)**:
  ```json
  {
    "success": true,
    "message": "تم إنشاء المادة بنجاح",
    "data": {
      "subject": {
        "_id": "60d0fe4f5311236168a109b1",
        "name": "Web Development",
        "level": "Level 3",
        "doctor": {
          "_id": "60d0fe4f5311236168a109a2",
          "name": "Doctor User",
          "email": "doctor@college.edu"
        },
        "batches": []
      }
    }
  }
  ```

### 4.2 GET `/api/subjects`
- **Description**: List all registered subjects.
- **Role Clearance**: Authenticated Users
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "subjects": [
        {
          "_id": "60d0fe4f5311236168a109b1",
          "name": "Web Development",
          "level": "Level 3",
          "doctor": "60d0fe4f5311236168a109a2"
        }
      ]
    }
  }
  ```

---

## 5. Lectures API (`/api/lectures`)

### 5.1 POST `/api/lectures`
- **Description**: Upload a new lecture (video URL and optional attachment).
- **Role Clearance**: `dean`, `doctor`, or `leader`
- **Request Body (Multipart Form-Data)**:
  - `title`: Lecture title (text)
  - `subject`: Subject ID (text)
  - `videoUrl`: Embeddable video URL (text)
  - `file`: PDF/document attachment (file)
- **Response Success (200 OK)**:
  ```json
  {
    "_id": "60d0fe4f5311236168a109c1",
    "title": "Introduction to HTML",
    "subject": "60d0fe4f5311236168a109b1",
    "videoUrl": "https://example.com/html-intro",
    "file": "1720726405234-lect.pdf",
    "uploadedBy": "60d0fe4f5311236168a109a2"
  }
  ```

### 5.2 GET `/api/lectures`
- **Description**: Get all lectures.
- **Role Clearance**: Authenticated Users
- **Response Success (200 OK)**:
  ```json
  [
    {
      "_id": "60d0fe4f5311236168a109c1",
      "title": "Introduction to HTML",
      "subject": {
        "_id": "60d0fe4f5311236168a109b1",
        "name": "Web Development"
      },
      "videoUrl": "https://example.com/html-intro",
      "file": "1720726405234-lect.pdf"
    }
  ]
  ```

---

## 6. Assignments API (`/api/assignments`)

### 6.1 POST `/api/assignments`
- **Description**: Create a new assignment for one or more student batches.
- **Role Clearance**: `dean`, `doctor`, or `leader`
- **Request Body (Multipart Form-Data)**:
  - `title`: Title of the assignment (text)
  - `description`: Detailed description (text)
  - `type`: Type of assignment (`exercise`, `research`, or `project`)
  - `subject`: Subject ID (text)
  - `dueDate`: Deadline date in YYYY-MM-DD (text)
  - `dueTime`: Deadline time in HH:MM (text, default "23:59")
  - `batches`: JSON array of Batch IDs or string comma-separated (text)
  - `file`: Assignment prompt file (file, required)
- **Response Success (201 Created)**:
  ```json
  {
    "_id": "60d0fe4f5311236168a109d1",
    "title": "HTML Basics Assignment",
    "description": "Build a basic HTML page",
    "type": "exercise",
    "subject": "60d0fe4f5311236168a109b1",
    "file": "1720726405345-assign.txt",
    "dueDate": "2026-07-12T00:00:00.000Z",
    "dueTime": "23:59",
    "batches": ["6688f111e111111111111111"],
    "addedBy": "60d0fe4f5311236168a109a2"
  }
  ```

---

## 7. Submissions API (`/api/submissions`)

### 7.1 POST `/api/submissions/submit`
- **Description**: Submit finished assignment.
- **Role Clearance**: `student` only
- **Request Body (Multipart Form-Data)**:
  - `assignmentId`: Target Assignment ID (text)
  - `submissionType`: Type matching the assignment (`exercise`/`research`/`project`)
  - `notes`: Student notes (text)
  - `file`: Student work attachment (file, required)
- **Response Success (201 Created)**:
  ```json
  {
    "success": true,
    "message": "تم تسليم الواجب بنجاح",
    "data": {
      "submission": {
        "_id": "60d0fe4f5311236168a109e1",
        "assignment": "60d0fe4f5311236168a109d1",
        "student": "60d0fe4f5311236168a109a4",
        "submissionType": "exercise",
        "file": "1720726405450-index.html",
        "notes": "Here is my submission",
        "isLate": false
      }
    }
  }
  ```

### 7.2 PUT `/api/submissions/:id/grade`
- **Description**: Grade student submission.
- **Role Clearance**: `dean`, `doctor`, or `leader`
- **Request Body**:
  ```json
  {
    "grade": 95,
    "feedback": "Excellent work!"
  }
  ```
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "message": "تم تقييم الواجب بنجاح"
  }
  ```

---

## 8. Financials API (`/api/financials`)

### 8.1 POST `/api/financials/fees`
- **Description**: Assess a tuition fee or other charges for a student or batch.
- **Role Clearance**: `dean` only
- **Request Body**:
  ```json
  {
    "studentId": "60d0fe4f5311236168a109a4",
    "title": "Semester 1 Tuition",
    "amount": 5000,
    "dueDate": "2026-07-22"
  }
  ```
- **Response Success (201 Created)**:
  ```json
  {
    "success": true,
    "message": "تم إضافة الرسوم بنجاح للطالب",
    "fee": {
      "_id": "60d0fe4f5311236168a109f1",
      "student": "60d0fe4f5311236168a109a4",
      "title": "Semester 1 Tuition",
      "amount": 5000,
      "dueDate": "2026-07-22T00:00:00.000Z",
      "paidAmount": 0,
      "status": "unpaid",
      "createdBy": "60d0fe4f5311236168a109a1"
    },
    "count": 1
  }
  ```

### 8.2 POST `/api/financials/payments`
- **Description**: Record a payment against student fees. Sequentially allocates payment amount in FIFO order of due dates.
- **Role Clearance**: `dean` or `admin`
- **Request Body**:
  ```json
  {
    "studentId": "60d0fe4f5311236168a109a4",
    "amount": 3000,
    "paymentMethod": "bank_transfer",
    "reference": "TXN10001",
    "notes": "Deposit payment"
  }
  ```
- **Response Success (201 Created)**:
  ```json
  {
    "success": true,
    "message": "تم تسجيل الدفع بنجاح وتحديث الرسوم المتعلقة",
    "payment": {
      "_id": "60d0fe4f5311236168a109f5",
      "student": "60d0fe4f5311236168a109a4",
      "amount": 3000,
      "paymentMethod": "bank_transfer",
      "reference": "TXN10001",
      "notes": "Deposit payment",
      "recordedBy": "60d0fe4f5311236168a109a1"
    }
  }
  ```

### 8.3 GET `/api/financials/balance/:studentId`
- **Description**: Retrieve current financial balance, total fees, and total payments for a student.
- **Role Clearance**: `dean`, `admin`, or the specific student
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "studentId": "60d0fe4f5311236168a109a4",
    "totalFees": 5000,
    "totalPaid": 3000,
    "balance": 2000,
    "fees": [...],
    "payments": [...]
  }
  ```

### 8.4 GET `/api/financials/balances`
- **Description**: Retrieve list of all student balances.
- **Role Clearance**: `dean` or `admin`
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "registry": [
      {
        "student": {
          "_id": "60d0fe4f5311236168a109a4",
          "name": "Student User",
          "email": "student@college.edu",
          "batch": {
            "_id": "6688f111e111111111111111",
            "name": "Class of 2026",
            "code": "CS2026"
          }
        },
        "totalFees": 5000,
        "totalPaid": 3000,
        "balance": 2000
      }
    ]
  }
  ```

---

## 9. Notifications API (`/api/notifications`)

### 9.1 POST `/api/notifications`
- **Description**: Send a notification targeting role(s), batch(es) or individual user(s).
- **Role Clearance**: `dean`, `doctor`, or `leader`
- **Request Body**:
  ```json
  {
    "title": "Semester Exams Scheduled",
    "message": "The final exams are scheduled starting from next month.",
    "type": "normal",
    "target": "students",
    "batches": ["6688f111e111111111111111"]
  }
  ```
- **Response Success (200 OK)**:
  ```json
  {
    "_id": "60d0fe4f5311236168a10981",
    "title": "Semester Exams Scheduled",
    "message": "The final exams are scheduled starting from next month.",
    "type": "normal",
    "target": "students",
    "batches": ["6688f111e111111111111111"],
    "recipients": [],
    "createdBy": {
      "_id": "60d0fe4f5311236168a109a1",
      "name": "Dean User",
      "email": "dean@college.edu",
      "roleName": "العميد"
    },
    "readBy": [],
    "seenBy": []
  }
  ```

### 9.2 GET `/api/notifications`
- **Description**: Retrieve notifications filtered for the logged-in user's role, batch, or individual ID.
- **Role Clearance**: Authenticated Users
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "_id": "60d0fe4f5311236168a10981",
        "title": "Semester Exams Scheduled",
        "message": "The final exams are scheduled starting from next month.",
        "type": "normal",
        "createdBy": {
          "name": "Dean User"
        }
      }
    ]
  }
  ```

### 9.3 POST `/api/notifications/read/:id`
- **Description**: Mark a single notification as read.
- **Role Clearance**: Authenticated Users
- **Response Success (200 OK)**:
  ```json
  {
    "message": "تم تحديد التنبيه كمقروء",
    "readBy": 1
  }
  ```

### 9.4 POST `/api/notifications/read-all`
- **Description**: Mark all notifications as read.
- **Role Clearance**: Authenticated Users
- **Response Success (200 OK)**:
  ```json
  {
    "message": "تم تحديد جميع التنبيهات كمقروءة",
    "modifiedCount": 1
  }
  ```

---

## 10. Batches API (`/api/batches`)

### 10.1 GET `/api/batches`
- **Description**: List all registered batches.
- **Role Clearance**: Authenticated Users
- **Response Success (200 OK)**:
  ```json
  [
    {
      "_id": "6688f111e111111111111111",
      "name": "Class of 2026",
      "code": "CS2026",
      "status": "active"
    }
  ]
  ```

### 10.2 POST `/api/batches`
- **Description**: Create a new academic batch.
- **Role Clearance**: `dean` or `leader`
- **Request Body**:
  ```json
  {
    "name": "Class of 2027",
    "code": "CS2027"
  }
  ```
- **Response Success (201 Created)**:
  ```json
  {
    "success": true,
    "message": "تم إنشاء الدفعة بنجاح",
    "batch": {
      "_id": "6688f111e111111111111119",
      "name": "Class of 2027",
      "code": "CS2027",
      "status": "active"
    }
  }
  ```

---

## 11. Videos & Discussions API (`/api/videos`)

### 11.1 GET `/api/videos`
- **Description**: List all educational videos in library.
- **Role Clearance**: Authenticated Users
- **Response Success (200 OK)**:
  ```json
  [
    {
      "_id": "60d0fe4f5311236168a109a8",
      "title": "React JS Crash Course",
      "subject": "60d0fe4f5311236168a109b1",
      "views": 25
    }
  ]
  ```

### 11.2 POST `/api/videos/:videoId/comments`
- **Description**: Post a comment/question regarding a video timeline.
- **Role Clearance**: Authenticated Users
- **Request Body**:
  ```json
  {
    "text": "How does the virtual DOM work?",
    "timestampSeconds": 120
  }
  ```
- **Response Success (201 Created)**:
  ```json
  {
    "success": true,
    "comment": {
      "_id": "60d0fe4f5311236168a1092b",
      "video": "60d0fe4f5311236168a109a8",
      "user": "60d0fe4f5311236168a109a4",
      "text": "How does the virtual DOM work?",
      "timestampSeconds": 120
    }
  }
  ```

---

## 12. Attendance API (`/api/attendance`)

### 12.1 POST `/api/attendance`
- **Description**: Record attendance for a lecture or academic event.
- **Role Clearance**: `dean`, `doctor`, or `leader`
- **Request Body**:
  ```json
  {
    "subjectId": "60d0fe4f5311236168a109b1",
    "lectureId": "60d0fe4f5311236168a109c1",
    "date": "2026-07-11",
    "records": [
      {
        "studentId": "60d0fe4f5311236168a109a4",
        "status": "present"
      }
    ]
  }
  ```
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "message": "تم تسجيل الحضور بنجاح"
  }
  ```
