const express = require("express");
const router = express.Router();
const Setting = require("../models/Setting");
const auth = require("../middleware/auth.middleware");
const restrictTo = require("../middleware/role.middleware");

// Get settings by keys (comma-separated, or all if empty)
router.get("/", auth, async (req, res) => {
  try {
    const keys = req.query.keys ? req.query.keys.split(',') : null;
    const query = keys ? { key: { $in: keys } } : {};
    
    const settings = await Setting.find(query);
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });
    
    res.json(settingsObj);
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل جلب الإعدادات" });
  }
});

// Update or Create settings (Admin/Dean only)
router.post("/", auth, restrictTo("admin", "dean"), async (req, res) => {
  try {
    const updates = req.body; // e.g. { bank_name: 'Bank X', bank_account: '123' }
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ success: false, message: "بيانات الإعدادات غير صالحة" });
    }

    for (const key of Object.keys(updates)) {
      await Setting.findOneAndUpdate(
        { key },
        { value: updates[key] },
        { upsert: true, returnDocument: 'after' }
      );
    }
    
    res.json({ success: true, message: "تم حفظ الإعدادات بنجاح" });
  } catch (err) {
    res.status(500).json({ success: false, message: "فشل حفظ الإعدادات" });
  }
});

module.exports = router;
