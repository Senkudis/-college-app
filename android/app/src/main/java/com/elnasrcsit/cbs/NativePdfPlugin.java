package com.elnasrcsit.cbs;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;

/**
 * عرض ملفات PDF بمحرك أندرويد الأصلي (PdfRenderer / PDFium).
 *
 * لماذا: pdf.js يرسم الحروف من الخط المضمّن في الملف. وملفات المحاضرات
 * المصدَّرة من PowerPoint/Word كثيراً ما لا تُضمّن الخط العربي، فيضطر pdf.js
 * لاستبداله بخط لا يعرف تشكيل العربية — فتظهر الحروف منفصلة ومبعثرة.
 * محرك أندرويد الأصلي يملك خطوطاً عربية للنظام ويطبّق التشكيل، فيعرضها سليمة.
 *
 * نعرض الصفحات صوراً داخل التطبيق — لا حاجة لفتح الملف بتطبيق خارجي.
 */
@CapacitorPlugin(name = "NativePdf")
public class NativePdfPlugin extends Plugin {

    private static final String CACHE_NAME = "nativepdf_view.pdf";

    private File cacheFile() {
        return new File(getContext().getCacheDir(), CACHE_NAME);
    }

    /** يكتب الملف في الذاكرة المؤقتة ويُعيد عدد صفحاته */
    @PluginMethod
    public void load(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("لم يتم تمرير محتوى الملف");
            return;
        }
        ParcelFileDescriptor pfd = null;
        PdfRenderer renderer = null;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            File file = cacheFile();
            FileOutputStream out = new FileOutputStream(file);
            out.write(bytes);
            out.close();

            pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
            renderer = new PdfRenderer(pfd);

            JSObject ret = new JSObject();
            ret.put("pageCount", renderer.getPageCount());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("تعذر فتح الملف: " + e.getMessage());
        } finally {
            closeQuietly(renderer, pfd);
        }
    }

    /** يرسم صفحة واحدة ويُعيدها صورة JPEG بترميز base64 */
    @PluginMethod
    public void renderPage(PluginCall call) {
        int index = call.getInt("page", 0);
        int targetWidth = call.getInt("width", 1080);
        // حدّ أعلى يمنع استهلاك ذاكرة مفرطاً على الأجهزة الضعيفة
        if (targetWidth > 2000) targetWidth = 2000;
        if (targetWidth < 200) targetWidth = 200;

        ParcelFileDescriptor pfd = null;
        PdfRenderer renderer = null;
        PdfRenderer.Page page = null;
        Bitmap bitmap = null;
        try {
            File file = cacheFile();
            if (!file.exists()) {
                call.reject("لم يُحمَّل أي ملف بعد");
                return;
            }
            pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
            renderer = new PdfRenderer(pfd);

            if (index < 0 || index >= renderer.getPageCount()) {
                call.reject("رقم صفحة خارج النطاق");
                return;
            }

            page = renderer.openPage(index);
            int width = targetWidth;
            int height = Math.max(1, (int) ((float) page.getHeight() / page.getWidth() * width));

            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            bitmap.eraseColor(Color.WHITE); // بدونها تخرج الشفافية سوداء
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out);

            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            ret.put("width", width);
            ret.put("height", height);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("تعذر رسم الصفحة: " + e.getMessage());
        } finally {
            if (bitmap != null) bitmap.recycle();
            if (page != null) {
                try { page.close(); } catch (Exception ignored) {}
            }
            closeQuietly(renderer, pfd);
        }
    }

    private void closeQuietly(PdfRenderer renderer, ParcelFileDescriptor pfd) {
        if (renderer != null) {
            try { renderer.close(); } catch (Exception ignored) {}
        }
        if (pfd != null) {
            try { pfd.close(); } catch (Exception ignored) {}
        }
    }
}
