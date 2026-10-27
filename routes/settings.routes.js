const express = require("express");
const router = express.Router();
const Setting = require("../models/Setting");
const auth = require("../middleware/auth.middleware");
const restrictTo = require("../middleware/role.middleware");
const { success, fail, serverError } = require("../utils/response");

// Safe settings keys allowed for non-admin/non-dean users (students, doctors, leaders)
const PUBLIC_SETTINGS_KEYS = new Set([
  'college_name', 'academic_year', 'semester_name',
  'bank_name', 'bank_account', 'bank_account_name', 'bank_iban', 'bank_beneficiary',
  'support_phone', 'support_email', 'announcement_banner'
]);

// Get settings by keys (comma-separated, or all if empty for staff)
router.get("/", auth, async (req, res) => {
  try {
    const isStaff = req.user?.roles?.some(r => r === "admin" || r === "dean");
    const requestedKeys = req.query.keys ? req.query.keys.split(',').map(k => k.trim()).filter(Boolean) : null;
    
    let query = {};
    if (!isStaff) {
      // Non-staff may only request whitelisted public settings
      const safeKeys = requestedKeys 
        ? requestedKeys.filter(k => PUBLIC_SETTINGS_KEYS.has(k))
        : Array.from(PUBLIC_SETTINGS_KEYS);
      query = { key: { $in: safeKeys } };
    } else if (requestedKeys && requestedKeys.length) {
      query = { key: { $in: requestedKeys } };
    }
    
    const settings = await Setting.find(query).lean();
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });
    
    res.json(settingsObj);
  } catch (err) {
    serverError(res, err, "جلب الإعدادات");
  }
});

// Update or Create settings (Admin/Dean only)
router.post("/", auth, restrictTo("admin", "dean"), async (req, res) => {
  try {
    const updates = req.body; // e.g. { bank_name: 'Bank X', bank_account: '123' }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return fail(res, "بيانات الإعدادات غير صالحة", 400);
    }

    const keys = Object.keys(updates);
    if (keys.length > 0) {
      const ops = keys.map(key => ({
        updateOne: {
          filter: { key },
          update: { $set: { value: updates[key] } },
          upsert: true
        }
      }));
      await Setting.bulkWrite(ops);
    }
    
    return success(res, null, "تم حفظ الإعدادات بنجاح");
  } catch (err) {
    serverError(res, err, "حفظ الإعدادات");
  }
});

module.exports = router;
