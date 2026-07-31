package com.elnasrcsit.cbs;

import android.content.res.Configuration;
import android.os.Bundle;

import androidx.activity.EdgeToEdge;
import androidx.appcompat.app.ActionBar;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * ملاحظات "العرض حتى حافة الشاشة" (Edge-to-Edge):
 *
 * بدءاً من أندرويد 15 (SDK 35) يفرض النظام رسم التطبيق خلف شريط الحالة وشريط
 * التنقل. نستدعي EdgeToEdge.enable() للتوافق مع الإصدارات الأقدم أيضاً، ولا
 * نستخدم إطلاقاً الدوال المتوقّفة نهائياً setStatusBarColor/setNavigationBarColor
 * ولا أعلام SYSTEM_UI_FLAG_*.
 *
 * الحواف الآمنة (insets) تُعالَج في طبقة الويب عبر env(safe-area-inset-*)
 * في www/css/style.css، وهي تعمل لأن كل الصفحات تستخدم viewport-fit=cover.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // عارض PDF أصلي (PDFium) — يعرض الخطوط العربية غير المضمّنة بشكل صحيح
        registerPlugin(NativePdfPlugin.class);
        // مزامنة شريط الحالة مع سمة التطبيق (نهاري/ليلي)
        registerPlugin(SystemBarsPlugin.class);

        /* ترتيب مهم: EdgeToEdge.enable() كان يُستدعى قبل super.onCreate()، وهو
           يلمس getWindow() فتُبنى نافذة النشاط بالثيم السائد آنذاك — قبل أن
           يبدّله BridgeActivity إلى AppTheme.NoActionBar — فيظهر شريط عنوان
           داكن يحمل أيقونة التطبيق و"IT College" فوق ترويسة الويب.
           BridgeActivity ينفّذ setTheme ثم setContentView داخل super.onCreate،
           لذا نُفعّل العرض حتى الحافة بعده. */
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);

        // احتياط: لو فُرض شريط العنوان من ثيم آخر، نُخفيه صراحةً
        ActionBar actionBar = getSupportActionBar();
        if (actionBar != null) {
            actionBar.hide();
        }

        applySystemBarsAppearance();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // تبديل الوضع الليلي على مستوى النظام يجب أن يعيد ضبط لون الأيقونات
        applySystemBarsAppearance();
    }

    /**
     * يضبط لون أيقونات شريط الحالة/التنقل حسب سمة النظام.
     *
     * كانت القيمة ثابتة (أيقونات فاتحة دائماً)، وبما أن المحتوى صار يُرسم خلف
     * الأشرطة مباشرةً فإن ترويسة التطبيق البيضاء في الوضع الفاتح كانت تُخفي
     * الأيقونات البيضاء تماماً.
     */
    private void applySystemBarsAppearance() {
        int nightMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        boolean isNight = nightMode == Configuration.UI_MODE_NIGHT_YES;

        WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());

        // في الوضع الفاتح: أيقونات داكنة فوق خلفية فاتحة، والعكس في الوضع الليلي
        controller.setAppearanceLightStatusBars(!isNight);
        controller.setAppearanceLightNavigationBars(!isNight);
    }
}
