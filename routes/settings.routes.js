const express = require("express");
const router = express.Router();
const Setting = require("../models/Setting");
const auth = require("../middleware/auth.middleware");
const restrictTo = require("../middleware/role.middleware");
const { success, fail, serverError } = require("../utils/response");

// Get settings by keys (comma-separated, or all if empty)
router.get("/", auth, async (req, res) => {
  try {
    const keys = req.query.keys ? req.query.keys.split(',').map(k => k.trim()).filter(Boolean) : null;
    const query = keys && keys.length ? { key: { $in: keys } } : {};
    
    const settings = await Setting.find(query);
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

    for (const key of Object.keys(updates)) {
      await Setting.findOneAndUpdate(
        { key },
        { value: updates[key] },
        { upsert: true, returnDocument: 'after' }
      );
    }
    
    return success(res, null, "تم حفظ الإعدادات بنجاح");
  } catch (err) {
    serverError(res, err, "حفظ الإعدادات");
  }
});

module.exports = router;
