const express = require('express');
const router = express.Router();
const AppVersionConfig = require('../models/AppVersionConfig');
const verifyToken = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');

/**
 * مقارنة بسيطة للإصدارات الدلالية (SemVer) كإجراء احتياطي إذا لم يتوفر رقم البناء
 */
function compareSemver(v1, v2) {
  if (!v1 || !v2) return 0;
  const p1 = String(v1).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const p2 = String(v2).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * GET /api/app-version/check
 * نقطة نهاية عامة وخفيفة لفحص إصدار التطبيق
 */
router.get('/check', async (req, res) => {
  try {
    const clientVer = req.query.v || req.query.version || '';
    const clientCode = parseInt(req.query.code || req.query.build || '0', 10);
    const platform = req.query.platform || 'all';

    const config = await AppVersionConfig.getEffectiveConfig();

    let isOutdated = false;
    let isMandatory = false;

    // متصفح الويب (Web) لا يخضع لتحديثات التطبيقات وملفات APK لأنه يعمل على أحدث كود حي من السيرفر
    if (platform === 'web') {
      isOutdated = false;
      isMandatory = false;
    } else if (clientCode > 0) {
      isOutdated = clientCode < config.latestVersionCode;
      isMandatory = isOutdated && (config.forceUpdate || (clientCode < config.minSupportedVersionCode));
    } else if (clientVer) {
      isOutdated = compareSemver(clientVer, config.latestVersion) < 0;
      isMandatory = isOutdated && (config.forceUpdate || (compareSemver(clientVer, config.minSupportedVersion) < 0));
    }

    return res.json({
      success: true,
      data: {
        latestVersion: config.latestVersion,
        latestVersionCode: config.latestVersionCode,
        minSupportedVersion: config.minSupportedVersion,
        minSupportedVersionCode: config.minSupportedVersionCode,
        isOutdated,
        isMandatory,
        title: config.title,
        message: config.message,
        releaseNotes: config.releaseNotes || [],
        downloadUrl: config.downloadUrl,
        directApkUrl: config.directApkUrl,
        playStoreUrl: config.playStoreUrl,
        serverTime: new Date().toISOString()
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'تعذر التحقق من إصدار التطبيق',
      error: err.message
    });
  }
});

/**
 * GET /api/app-version/admin
 * جلب الإعدادات الكاملة للإصدار (للعميد فقط)
 */
router.get('/admin', verifyToken, roleMiddleware('dean', 'admin'), async (req, res) => {
  try {
    const config = await AppVersionConfig.getEffectiveConfig();
    return res.json({
      success: true,
      data: config
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'فشل تحميل إعدادات الإصدار',
      error: err.message
    });
  }
});

/**
 * POST /api/app-version/admin
 * تعديل أو حفظ إعدادات الإصدار والتحديث الإجباري (للعميد فقط)
 */
router.post('/admin', verifyToken, roleMiddleware('dean', 'admin'), async (req, res) => {
  try {
    const {
      latestVersion,
      latestVersionCode,
      minSupportedVersion,
      minSupportedVersionCode,
      forceUpdate,
      title,
      message,
      releaseNotes,
      downloadUrl,
      directApkUrl,
      playStoreUrl
    } = req.body;

    const updateDoc = {};
    if (latestVersion !== undefined) updateDoc.latestVersion = String(latestVersion).trim();
    if (latestVersionCode !== undefined) updateDoc.latestVersionCode = Number(latestVersionCode);
    if (minSupportedVersion !== undefined) updateDoc.minSupportedVersion = String(minSupportedVersion).trim();
    if (minSupportedVersionCode !== undefined) updateDoc.minSupportedVersionCode = Number(minSupportedVersionCode);
    if (forceUpdate !== undefined) updateDoc.forceUpdate = Boolean(forceUpdate);
    if (title !== undefined) updateDoc.title = String(title).trim();
    if (message !== undefined) updateDoc.message = String(message).trim();
    if (Array.isArray(releaseNotes)) updateDoc.releaseNotes = releaseNotes.map(n => String(n).trim()).filter(Boolean);
    if (downloadUrl !== undefined) updateDoc.downloadUrl = String(downloadUrl).trim();
    if (directApkUrl !== undefined) updateDoc.directApkUrl = String(directApkUrl).trim();
    if (playStoreUrl !== undefined) updateDoc.playStoreUrl = String(playStoreUrl).trim();
    updateDoc.updatedBy = req.user.id || req.user._id;
    updateDoc.updatedAt = new Date();

    let config = await AppVersionConfig.findOne().sort({ updatedAt: -1 });
    if (config) {
      Object.assign(config, updateDoc);
      await config.save();
    } else {
      config = await AppVersionConfig.create(updateDoc);
    }

    return res.json({
      success: true,
      message: 'تم حفظ إعدادات إصدار التطبيق بنجاح',
      data: config
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'فشل حفظ إعدادات الإصدار',
      error: err.message
    });
  }
});

module.exports = router;
