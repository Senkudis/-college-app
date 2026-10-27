const mongoose = require('mongoose');

const DEFAULT_CONFIG = {
  latestVersion: '2.3.0',
  latestVersionCode: 30,
  minSupportedVersion: '2.1.0',
  minSupportedVersionCode: 28,
  forceUpdate: false,
  title: 'تحديث جديد متوفر للتطبيق 🚀',
  message: 'يتوفر إصدار جديد من تطبيق كلية النصر التقنية يتضمن ميزات تفاعلية ذكية جديدة وتحسينات شاملة في الواجهات والأداء.',
  releaseNotes: [
    'بطاقة الهوية الجامعية الرقمية التفاعلية مع رمز QR الذكي',
    'ودجت العد التنازلي للمحاضرة القادمة والتنبيهات المباشرة',
    'قائمة الإجراءات السريعة العائمة (FAB)',
    'حاسبة ومحاكي المعدل التراكمي الذكي (GPA Simulator)',
    'تحسينات استقرار واجهات النظام والعمل بدون إنترنت'
  ],
  downloadUrl: 'https://elnasrcsit.website/download',
  directApkUrl: 'https://elnasrcsit.website/app-release.apk',
  playStoreUrl: '',
  updatedAt: new Date()
};

const appVersionConfigSchema = new mongoose.Schema({
  latestVersion: {
    type: String,
    required: true,
    default: DEFAULT_CONFIG.latestVersion
  },
  latestVersionCode: {
    type: Number,
    required: true,
    default: DEFAULT_CONFIG.latestVersionCode
  },
  minSupportedVersion: {
    type: String,
    required: true,
    default: DEFAULT_CONFIG.minSupportedVersion
  },
  minSupportedVersionCode: {
    type: Number,
    required: true,
    default: DEFAULT_CONFIG.minSupportedVersionCode
  },
  forceUpdate: {
    type: Boolean,
    default: DEFAULT_CONFIG.forceUpdate
  },
  title: {
    type: String,
    default: DEFAULT_CONFIG.title
  },
  message: {
    type: String,
    default: DEFAULT_CONFIG.message
  },
  releaseNotes: {
    type: [String],
    default: DEFAULT_CONFIG.releaseNotes
  },
  downloadUrl: {
    type: String,
    default: DEFAULT_CONFIG.downloadUrl
  },
  directApkUrl: {
    type: String,
    default: DEFAULT_CONFIG.directApkUrl
  },
  playStoreUrl: {
    type: String,
    default: DEFAULT_CONFIG.playStoreUrl
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

/**
 * جلب الإعدادات الحالية أو القيم الافتراضية
 */
appVersionConfigSchema.statics.getEffectiveConfig = async function() {
  try {
    const config = await this.findOne().sort({ updatedAt: -1 }).lean();
    if (config) {
      return { ...DEFAULT_CONFIG, ...config };
    }
  } catch (err) {
    // في حال عدم توفر اتصال قاعدة البيانات (مثل وضع الاختبارات المعزولة)
  }
  return { ...DEFAULT_CONFIG };
};

module.exports = mongoose.models.AppVersionConfig || mongoose.model('AppVersionConfig', appVersionConfigSchema);
