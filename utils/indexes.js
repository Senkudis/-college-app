const mongoose = require('mongoose');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const Fee = require('../models/Fee');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const Attendance = require('../models/Attendance');
const AcademicEvent = require('../models/AcademicEvent');
const Batch = require('../models/Batch');
const ActivityLog = require('../models/ActivityLog');

async function createIndexes() {
  console.log('📦 Creating database indexes...');

  // User indexes
  await User.collection.createIndex({ email: 1 }, { unique: true });
  await User.collection.createIndex({ batch: 1 });
  await User.collection.createIndex({ batches: 1 });
  await User.collection.createIndex({ roles: 1 });
  await User.collection.createIndex({ isActive: 1 });
  await User.collection.createIndex({ points: -1 });
  await User.collection.createIndex({ deletedAt: 1 });

  // Subject indexes
  await Subject.collection.createIndex({ doctor: 1 });
  await Subject.collection.createIndex({ batches: 1 });
  await Subject.collection.createIndex({ level: 1 });

  // Quiz indexes
  await Quiz.collection.createIndex({ batch: 1, published: 1, startsAt: 1 });
  await Quiz.collection.createIndex({ subject: 1 });
  await Quiz.collection.createIndex({ createdBy: 1 });

  // QuizAttempt indexes
  await QuizAttempt.collection.createIndex({ quiz: 1, student: 1 }, { unique: true });
  await QuizAttempt.collection.createIndex({ quiz: 1, score: -1 });
  await QuizAttempt.collection.createIndex({ student: 1, submittedAt: -1 });

  // Fee indexes
  await Fee.collection.createIndex({ student: 1, status: 1 });
  await Fee.collection.createIndex({ batch: 1 });
  await Fee.collection.createIndex({ dueDate: 1 });
  await Fee.collection.createIndex({ createdBy: 1 });

  // Payment indexes
  await Payment.collection.createIndex({ student: 1, paymentDate: -1 });
  await Payment.collection.createIndex({ reference: 1 }, { unique: true });
  await Payment.collection.createIndex({ recordedBy: 1 });
  await Payment.collection.createIndex({ paymentMethod: 1 });

  // Notification indexes
  await Notification.collection.createIndex({ type: 1, createdAt: -1 });
  await Notification.collection.createIndex({ createdBy: 1, createdAt: -1 });
  await Notification.collection.createIndex({ target: 1 });
  await Notification.collection.createIndex({ batches: 1 });
  await Notification.collection.createIndex({ recipients: 1 });
  await Notification.collection.createIndex({ readBy: 1 });
  await Notification.collection.createIndex({ shownInDashboard: 1 });

  // Attendance indexes
  await Attendance.collection.createIndex({ subject: 1, date: 1, recordedBy: 1 }, { unique: true });
  await Attendance.collection.createIndex({ recordedBy: 1, date: -1 });
  await Attendance.collection.createIndex({ 'students.student': 1 });

  // AcademicEvent indexes
  await AcademicEvent.collection.createIndex({ batch: 1, startsAt: 1 });
  await AcademicEvent.collection.createIndex({ subject: 1 });
  await AcademicEvent.collection.createIndex({ type: 1 });

  // Batch indexes
  await Batch.collection.createIndex({ code: 1 }, { unique: true });
  await Batch.collection.createIndex({ status: 1 });

  // ActivityLog indexes
  await ActivityLog.collection.createIndex({ user: 1, createdAt: -1 });
  await ActivityLog.collection.createIndex({ batch: 1, action: 1 });
  await ActivityLog.collection.createIndex({ action: 1 });

  // TTL indexes for auto-cleanup
  await Notification.collection.createIndex(
    { createdAt: 1 }, 
    { expireAfterSeconds: 30 * 24 * 60 * 60 } // 30 days
  );

  console.log('✅ Database indexes created');
}

module.exports = { createIndexes };