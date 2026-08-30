'use strict';

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');
const { snapshot } = require('../utils/observability');
const AIReview = require('../models/AIReview');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');

router.get('/observability', authMiddleware, roleMiddleware('admin', 'dean'), async (req, res) => {
  try {
    const data = snapshot(true);
    const routeCount = (prefix) => (data.topRoutes || [])
      .filter(item => item.route.startsWith(prefix))
      .reduce((sum, item) => sum + item.count, 0);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [reviewGroups, notificationCount, activityGroups] = await Promise.all([
      AIReview.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$rating', count: { $sum: 1 } } }]),
      Notification.countDocuments({ createdAt: { $gte: since } }),
      ActivityLog.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$action', count: { $sum: 1 } } }])
    ]);
    res.json({
      success: true,
      data: {
        health: {
          status: data.status,
          uptimeSec: data.uptimeSec,
          memoryMb: data.memoryMb,
          errors: data.errors,
          lastErrorAt: data.lastErrorAt
        },
        usage: {
          kedyRequests: routeCount('/api/ai'),
          notificationRequests: routeCount('/api/notifications'),
          totalRequests: data.requests,
          notificationsLast30Days: notificationCount,
          kedyFeedbackLast30Days: Object.fromEntries(reviewGroups.map(item => [item._id, item.count])),
          activityLast30Days: Object.fromEntries(activityGroups.map(item => [item._id, item.count]))
        },
        topRoutes: data.topRoutes || [],
        byStatus: data.byStatus
      },
      requestId: req.id
    });
  } catch (err) {
    res.status(503).json({ success: false, message: 'تعذر تحميل مؤشرات المراقبة', requestId: req.id });
  }
});

module.exports = router;
