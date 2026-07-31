package com.elnasrcsit.cbs;

import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * ضبط مظهر شريط الحالة ليتبع سمة التطبيق (لا سمة النظام).
 *
 * لماذا: مع "العرض حتى حافة الشاشة" يُرسم محتوى التطبيق خلف شريط الحالة، فتظهر
 * أيقوناته فوق ترويسة التطبيق مباشرةً. وكان لونها مشتقاً من وضع النظام الليلي،
 * فإن كان النظام ليلياً واختار المستخدم الوضع النهاري داخل التطبيق تبقى
 * الأيقونات بيضاء على ترويسة بيضاء — غير مرئية إطلاقاً.
 *
 * نستخدم WindowInsetsControllerCompat فقط — لا دوال متوقّفة نهائياً
 * مثل setStatusBarColor، ولا حاجة لتثبيت إضافة @capacitor/status-bar.
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    /**
     * @param light صحيح إذا كانت خلفية التطبيق فاتحة (⇒ أيقونات داكنة)
     */
    @PluginMethod
    public void setAppearance(PluginCall call) {
        final boolean light = call.getBoolean("light", true);
        getActivity().runOnUiThread(() -> {
            try {
                WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(
                    getActivity().getWindow(),
                    getActivity().getWindow().getDecorView()
                );
                controller.setAppearanceLightStatusBars(light);
                controller.setAppearanceLightNavigationBars(light);
                call.resolve();
            } catch (Exception e) {
                call.reject("تعذر ضبط شريط الحالة: " + e.getMessage());
            }
        });
    }
}
