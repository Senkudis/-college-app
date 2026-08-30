'use strict';

const mongoose = require('mongoose');

const AIReviewSchema = new mongoose.Schema({
  promptHash: { type: String, required: true, index: true },
  answerHash: { type: String, required: true },
  rating: { type: String, enum: ['helpful', 'needs_improvement'], required: true },
  locale: { type: String, enum: ['ar-sd', 'ar', 'en', 'other'], default: 'ar-sd' },
  route: { type: String, enum: ['ask', 'quiz', 'summary', 'other'], default: 'ask' },
  createdAt: { type: Date, default: Date.now, expires: 180 * 24 * 60 * 60 }
}, { versionKey: false });

module.exports = mongoose.model('AIReview', AIReviewSchema);
