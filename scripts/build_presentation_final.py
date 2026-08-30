# -*- coding: utf-8 -*-
"""
مولّد العرض التقديمي النهائي الفاخر لنظام كلية النصر التقنية
بدون أي أقواس، وبتنسيق عربي انسيابي ناعم بخط Calibri
"""
import os
import shutil
import pptx
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

def c(hex_str):
    hex_str = hex_str.lstrip('#')
    return RGBColor(int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16))

# الألوان الراقية
C_NAVY_DEEP  = c('0A192F')
C_NAVY_CARD  = c('112240')
C_NAVY_BORDER= c('233554')

C_PRIMARY    = c('1D4ED8')  # أزرق ملكي
C_SECONDARY  = c('0F766E')  # تيل / بترولي أنيق
C_AMBER      = c('D97706')  # ذهبي دافئ
C_RED        = c('DC2626')  # أحمر تنبيهي هادئ
C_PURPLE     = c('7C3AED')  # بنفسجي تقني

C_BG_PAGE    = c('F8FAFC')  # خلفية نقية
C_CARD_WHITE = c('FFFFFF')  # بطاقة بيضاء
C_BORDER     = c('E2E8F0')  # حدود ناعمة

C_TEXT_HEAD  = c('0F172A')  # كحلي داكن مقروء
C_TEXT_BODY  = c('334155')  # رمادي داكن
C_TEXT_MUTED = c('64748B')  # نصوص توضيحية
C_TEXT_LIGHT = c('F8FAFC')
C_TEXT_SKY   = c('38BDF8')

FONT_FAMILY  = 'Times New Roman'

prs = pptx.Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
blank_layout = prs.slide_layouts[6]

W, H, M = 13.333, 7.5, 0.75

def new_slide(bg=C_BG_PAGE):
    slide = prs.slides.add_slide(blank_layout)
    bg_shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(W), Inches(H))
    bg_shape.fill.solid()
    bg_shape.fill.fore_color.rgb = bg
    bg_shape.line.fill.background()
    return slide

def apply_p(p, text, size, color, bold=False, align=PP_ALIGN.RIGHT, font=FONT_FAMILY, rtl=True):
    p.text = text
    p.alignment = align
    p.font.name = font
    p.font.size = Pt(size)
    p.font.bold = bold
    p.font.color.rgb = color
    if rtl:
        pPr = p._p.get_or_add_pPr()
        pPr.set('rtl', '1')

def make_header(slide, title, category=None, is_dark=False):
    # خط رأسي جانبي
    acc = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(M), Inches(0.42), Inches(0.06), Inches(0.65))
    acc.fill.solid()
    acc.fill.fore_color.rgb = C_AMBER if is_dark else C_PRIMARY
    acc.line.fill.background()

    tx = slide.shapes.add_textbox(Inches(M + 0.2), Inches(0.38), Inches(W - M * 2 - 0.2), Inches(0.95))
    tf = tx.text_frame
    tf.word_wrap = True
    tf.margin_top = tf.margin_bottom = tf.margin_left = tf.margin_right = 0

    if category:
        p_cat = tf.paragraphs[0]
        apply_p(p_cat, category, 12, C_TEXT_SKY if is_dark else C_PRIMARY, bold=True)
        p_title = tf.add_paragraph()
        p_title.space_before = Pt(3)
    else:
        p_title = tf.paragraphs[0]

    apply_p(p_title, title, 25, C_TEXT_LIGHT if is_dark else C_TEXT_HEAD, bold=True)

def sleek_card(slide, x, y, w, h, title, body='', tag=None, accent=C_PRIMARY, is_dark=False):
    box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    box.fill.solid()
    box.fill.fore_color.rgb = C_NAVY_CARD if is_dark else C_CARD_WHITE
    box.line.color.rgb = C_NAVY_BORDER if is_dark else C_BORDER
    box.line.width = Pt(1)

    acc = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x + w - 0.06), Inches(y), Inches(0.06), Inches(h))
    acc.fill.solid()
    acc.fill.fore_color.rgb = accent
    acc.line.fill.background()

    tx = slide.shapes.add_textbox(Inches(x + 0.25), Inches(y + 0.16), Inches(w - 0.5), Inches(h - 0.32))
    tf = tx.text_frame
    tf.word_wrap = True
    tf.margin_top = tf.margin_bottom = tf.margin_left = tf.margin_right = 0

    if tag:
        p_tag = tf.paragraphs[0]
        apply_p(p_tag, tag, 11, accent, bold=True)
        p_title = tf.add_paragraph()
        p_title.space_before = Pt(2)
    else:
        p_title = tf.paragraphs[0]

    apply_p(p_title, title, 15.5, C_TEXT_LIGHT if is_dark else C_TEXT_HEAD, bold=True)

    if body:
        p_body = tf.add_paragraph()
        p_body.space_before = Pt(5)
        apply_p(p_body, body, 11.5, C_TEXT_SKY if is_dark else C_TEXT_BODY)

def metric_card(slide, x, y, w, h, num, label, sub='', accent=C_PRIMARY):
    box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    box.fill.solid()
    box.fill.fore_color.rgb = C_CARD_WHITE
    box.line.color.rgb = C_BORDER
    box.line.width = Pt(1)

    top = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(0.05))
    top.fill.solid()
    top.fill.fore_color.rgb = accent
    top.line.fill.background()

    tx = slide.shapes.add_textbox(Inches(x + 0.15), Inches(y + 0.16), Inches(w - 0.3), Inches(h - 0.32))
    tf = tx.text_frame
    tf.word_wrap = True
    tf.margin_top = tf.margin_bottom = tf.margin_left = tf.margin_right = 0

    p_num = tf.paragraphs[0]
    apply_p(p_num, num, 38, accent, bold=True, align=PP_ALIGN.CENTER, rtl=False)

    p_lbl = tf.add_paragraph()
    p_lbl.space_before = Pt(3)
    apply_p(p_lbl, label, 13.5, C_TEXT_HEAD, bold=True, align=PP_ALIGN.CENTER)

    if sub:
        p_sub = tf.add_paragraph()
        p_sub.space_before = Pt(2)
        apply_p(p_sub, sub, 10.5, C_TEXT_MUTED, align=PP_ALIGN.CENTER)

# ════════════════════════════════════════════════════════════════════
# 1. الغلاف
# ════════════════════════════════════════════════════════════════════
s1 = new_slide(C_NAVY_DEEP)

acc1 = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(M), Inches(1.1), Inches(1.2), Inches(0.06))
acc1.fill.solid(); acc1.fill.fore_color.rgb = C_AMBER; acc1.line.fill.background()

tx1 = s1.shapes.add_textbox(Inches(M), Inches(1.3), Inches(W - M * 2), Inches(3.2))
tf1 = tx1.text_frame; tf1.word_wrap = True
tf1.margin_top = tf1.margin_bottom = tf1.margin_left = tf1.margin_right = 0

apply_p(tf1.paragraphs[0], 'كلية النصر التقنية — جامعة النصر التقنية', 15, C_TEXT_SKY, bold=True)
p1_1 = tf1.add_paragraph(); p1_1.space_before = Pt(10)
apply_p(p1_1, 'النظام الجامعي الرقمي المتكامل', 38, C_TEXT_LIGHT, bold=True)
p1_2 = tf1.add_paragraph(); p1_2.space_before = Pt(14)
apply_p(p1_2, 'منصة موحدة وشاملة لإدارة العمليات الأكاديمية والمالية والحضور والتواصل — عبر الويب وتطبيقات الهواتف الذكية', 15, c('CBD5E1'))

cover_metrics = [
    ('٥', 'أدوار بصلاحيات', 'عزل أمني تام', C_AMBER),
    ('٣٠', 'وحدة خدمية', 'API Backend', C_TEXT_SKY),
    ('٥٠', 'شاشة تفاعلية', 'واجهة مستخدم حديثة', C_SECONDARY),
    ('٢.١.٠', 'الإصدار المعتمد', 'جاهز للتشغيل الرسمي', C_PRIMARY)
]
for i, (n, l, s, col) in enumerate(cover_metrics):
    x = W - M - 2.75 - i * 2.95
    box = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(4.9), Inches(2.75), Inches(1.4))
    box.fill.solid(); box.fill.fore_color.rgb = C_NAVY_CARD
    box.line.color.rgb = C_NAVY_BORDER; box.line.width = Pt(1)

    top_l = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(4.9), Inches(2.75), Inches(0.04))
    top_l.fill.solid(); top_l.fill.fore_color.rgb = col; top_l.line.fill.background()

    tx = s1.shapes.add_textbox(Inches(x + 0.15), Inches(5.02), Inches(2.45), Inches(1.2))
    tf = tx.text_frame; tf.word_wrap = True
    tf.margin_top = tf.margin_bottom = tf.margin_left = tf.margin_right = 0
    apply_p(tf.paragraphs[0], n, 26, col, bold=True, align=PP_ALIGN.CENTER, rtl=False)
    p_l = tf.add_paragraph(); p_l.space_before = Pt(2)
    apply_p(p_l, l, 13, C_TEXT_LIGHT, bold=True, align=PP_ALIGN.CENTER)
    p_s = tf.add_paragraph()
    apply_p(p_s, s, 10.5, c('94A3B8'), align=PP_ALIGN.CENTER)

tx_foot = s1.shapes.add_textbox(Inches(M), Inches(6.7), Inches(W - M * 2), Inches(0.35))
apply_p(tx_foot.text_frame.paragraphs[0], 'عرض تقديمي موجه لمجلس الإدارة الأكاديمية والعمادة الموقرة', 11.5, c('64748B'))

# ════════════════════════════════════════════════════════════════════
# 2. الدافع: ما الذي يحلّه هذا النظام؟
# ════════════════════════════════════════════════════════════════════
s2 = new_slide()
make_header(s2, 'التحديات التشغيلية والحلول الجذرية التي يقدمها النظام', 'الرؤية والدافع')
problems = [
    ('تشتت المحتوى والمحاضرات', 'المحاضرات والواجبات موزعة بين مجموعات الواتساب غير الرسمية والأوراق، مما يعرضها للضياع ويصعب أرشفتها.', 'حفظ وأرشفة رقمية', C_RED),
    ('الرصد اليدوي والغياب المفاجئ', 'كشوف الحضور تُسجل وتُحسب يدوياً دون تنبيه مبكر للطالب قبل تجاوزه النسبة القانونية للحرمان.', 'متابعة الحضور المسبقة', C_RED),
    ('انفصال المالية عن السجل الأكاديمي', 'الرسوم تُدار في دفاتر منفصلة، ويضطر الطالب للانتظار اليدوي لمعرفة موقفه المالي وإيصالاته.', 'سجل مالي مترابط', C_RED),
    ('غياب المصدر الموحد للتقارير والقرار', 'تعدد مصادر البيانات يعيق استخراج مؤشرات الأداء الحقيقية ويؤخر اتخاذ القرارات الأكاديمية.', 'مصدر بيانات مركزي', C_RED)
]
for i, (t, b, tag, col) in enumerate(problems):
    sleek_card(s2, M + (i % 2) * 6.05, 1.75 + (i // 2) * 2.45, 5.75, 2.2, t, b, tag=tag, accent=col)

# ════════════════════════════════════════════════════════════════════
# 3. نظرة عامة بالأرقام
# ════════════════════════════════════════════════════════════════════
s3 = new_slide()
make_header(s3, 'النظام في أرقام واقعية مستخرجة من بنية الكود', 'نظرة عامة على المشروع')
stats_data = [
    ('٣٠', 'وحدة خدمية (API)', 'تغطي كافة الاحتياجات الأكاديمية', C_PRIMARY),
    ('٥٠', 'شاشة تفاعلية', 'مصممة للويب والهاتف بسلاسة', C_SECONDARY),
    ('٢٨', 'نموذج بيانات', 'بنية قوية ومترابطة في MongoDB', C_PURPLE),
    ('٥', 'أدوار بصلاحيات', 'عزل أمني تام ومحكم بين المستخدمين', C_AMBER)
]
for i, (n, l, sub, col) in enumerate(stats_data):
    metric_card(s3, M + i * 3.0, 1.75, 2.8, 2.0, n, l, sub, accent=col)

sleek_card(s3, M, 4.25, 11.8, 2.5, 
           'بنية موحدة تخدم الويب وتطبيقات الهواتف (Android & iOS) من مصدر واحد',
           'يعتمد النظام على خادم موحد حديث مبني بـ Node.js و Express وقاعدة بيانات MongoDB، يخدم البوابة الإلكترونية وتطبيقات الهواتف الذكية في وقت واحد. أي تحديث في المقررات أو الإعلانات يصل لجميع المستخدمين فوراً دون الحاجة لإعادة تثبيت التطبيق. كما يدعم العمل بدون اتصال بالإنترنت وحفظ المحاضرات للدراسة في أي وقت.',
           tag='بنية تقنية موحدة', accent=C_PRIMARY)

# ════════════════════════════════════════════════════════════════════
# 4. منظومة الصلاحيات (5 أدوار)
# ════════════════════════════════════════════════════════════════════
s4 = new_slide()
make_header(s4, 'خمسة مستويات صلاحية — عزل أمني دقيق ومفروض برمجياً', 'الحوكمة والأدوار')
roles_data = [
    ('الطالب (Student)', 'الوصول للمواد، المحاضرات والشيتات، تسليم الواجبات، بنك الاختبارات، الحضور، والسجل الأكاديمي والمالي الشخصي.', 'الدور الأول', C_PRIMARY),
    ('قائد الدفعة (Batch Leader)', 'صلاحيات الطالب، بالإضافة إلى تسهيل رفع محاضرات الدفعة، المساعدة في رصد الحضور، وإرسال التنبيهات المباشرة.', 'الدور الثاني', C_PURPLE),
    ('أستاذ المادة (Professor)', 'إدارة المواد والمحاضرات، إعداد الاختبارات وتحديد مددها، تصحيح وتقييم التكليفات، ورصد الحضور والتقارير الأكاديمية.', 'الدور الثالث', C_SECONDARY),
    ('العميد وإدارة الكلية (Dean)', 'صلاحيات إشرافية شاملة: إدارة المستخدمين والدفعات، متابعة المالية والرسوم، استخراج التقارير المركزية، ومراجعة البلاغات.', 'الدور الرابع', C_AMBER),
    ('مسؤول النظام (System Admin)', 'المراقبة التشغيلية للخوادم، إدارة النسخ الاحتياطي، ضبط إعدادات الإصدارات، ومتابعة الأداء واستقرار الخدمة.', 'الدور الخامس', C_TEXT_MUTED)
]
for i, (t, b, tag, col) in enumerate(roles_data):
    sleek_card(s4, M, 1.7 + i * 1.02, 11.8, 0.92, t, b, tag=tag, accent=col)

# ════════════════════════════════════════════════════════════════════
# 5. الدورة الأكاديمية
# ════════════════════════════════════════════════════════════════════
s5 = new_slide()
make_header(s5, 'إدارة الدورة الأكاديمية من المحاضرة حتى التقييم والرصد', 'المحور الأكاديمي')
flow_steps = [
    ('المواد والدفعات', 'إنشاء الدفعات وتخصيص المواد وإسناد الأساتذة المختصين.', 'المرحلة 1'),
    ('رفع المحاضرات', 'رفع ملفات PDF والفيديوهات مع ترتيب تسلسلي وإمكانية الحفظ للعمل دون اتصال.', 'المرحلة 2'),
    ('التكليفات والواجبات', 'طرح الواجبات بموعد استحقاق محدد، ورفع الحلول مع منع التأخير التلقائي.', 'المرحلة 3'),
    ('التصحيح والرصد', 'رصد الدرجات وكتابة الملاحظات مع إشعار الطالب بالنتيجة لحظياً.', 'المرحلة 4')
]
for i, (t, b, tag) in enumerate(flow_steps):
    sleek_card(s5, M + i * 3.0, 1.75, 2.8, 2.4, t, b, tag=tag, accent=C_PRIMARY)

sleek_card(s5, M, 4.5, 5.75, 2.2, 'إعادة التسليم لتحسين التحصيل الأكاديمي',
           'يمنح النظام فرصة للطلاب الحاصلين على أقل من 60% لإعادة تسليم التكليف خلال مهلة محددة (7 أيام) مع وسم المحاولة كمتأخرة أمام الأستاذ لضمان العدالة.',
           tag='تحسين التحصيل الأكاديمي', accent=C_AMBER)

sleek_card(s5, M + 6.05, 4.5, 5.75, 2.2, 'لوحة المتابعة للواجبات غير المسلمة',
           'تمكّن الأستاذ من استعراض قائمة الطلاب الذين لم يقوموا بتسليم الواجب بضغطة زر واحدة لتوجيه التذكيرات لهم قبل إغلاق الموعد النهائي.',
           tag='المتابعة المستمرة للواجبات', accent=C_SECONDARY)

# ════════════════════════════════════════════════════════════════════
# 6. الحضور والإنذار المبكر
# ════════════════════════════════════════════════════════════════════
s6 = new_slide()
make_header(s6, 'رصد الحضور الإلكتروني ونظام الإنذار المبكر للطلاب المتعثرين', 'حماية التحصيل الأكاديمي')
sleek_card(s6, M, 1.75, 5.75, 2.25, 'رصد الحضور اليومي السريع',
           'يقوم الأستاذ أو قائد الدفعة بتسجيل الحضور بضغطة زر لكل محاضرة. يعتمد النظام سجلاً موحداً يمنع تكرار الرصد ويوثق هوية الراصد وتوقيت العملية بدقة.',
           tag='الرصد الإلكتروني اليومي', accent=C_SECONDARY)

sleek_card(s6, M + 6.05, 1.75, 5.75, 2.25, 'التنبيه الآلي عند تخطي حاجز الغياب',
           'بمجرد انخفاض نسبة حضور الطالب إلى أقل من 75%، يقوم النظام تلقائياً بإرسال تنبيه مباشر إلى هاتفه يحذره من مخاطر الحرمان من الامتحان النهائي.',
           tag='الإنذار الآلي المبكر', accent=C_RED)

sleek_card(s6, M, 4.35, 11.8, 2.45, 'تقرير الإنذار المبكر الاستباقي (Early Warning System)',
           'لوحة استخبارات أكاديمية متقدمة للعميد ورؤساء الأقسام تجمع 3 محاور أساسية: (معدل تراجع الحضور + تراكم الواجبات غير المسلمة + نتائج الاختبارات الدورية). يصنف التقرير الطلاب إلى 3 مستويات خطر (مرتفع، متوسط، منخفض) ليتيح للكلية التدخل الإرشادي المبكر ومعالجة تعثر الطالب قبل الامتحانات النهائية.',
           tag='حوكمة ومتابعة استباقية', accent=C_NAVY_DEEP)

# ════════════════════════════════════════════════════════════════════
# 7. التقييم الإلكتروني
# ════════════════════════════════════════════════════════════════════
s7 = new_slide()
make_header(s7, 'منظومة الاختبارات الإلكترونية وأرشيف بنك الامتحانات السابقة', 'التقييم المستمر')
eval_cards = [
    ('اختبارات دورية موقوتة من الخادم', 'يحدد الأستاذ نافذة إتاحة الاختبار ومدته بالدقائق. يتم احتساب الوقت بدقة عبر الخادم لضمان عدم التلاعب بالمؤقت حتى لو أُغلقت الصفحة.', 'اختبارات موقوتة', C_PRIMARY),
    ('تصحيح آلي فوري وإعلان النتائج', 'أسئلة اختيار من متعدد مع درجات مخصصة وتغذية راجعة، وتظهر النتيجة مع تفاصيل الإجابات الصحيحة لحظة التسليم فوراً.', 'تصحيح آلي فوري', C_SECONDARY),
    ('بنك الامتحانات النهائية السابقة', 'أرشيف رقمي منظم يحتوي على نماذج امتحانات السنوات السابقة مصنفة حسب المادة والفصل الدراسي لتمكين الطلاب من الاستعداد الأمثل.', 'أرشيف الامتحانات', C_PURPLE),
    ('محاكاة الامتحانات وتشخيص المستوى', 'يتيح للطالب خوض تجربة امتحان سابق كامل بنظام المحاكاة، ويمنحه تقريراً فورياً بنقاط القوة والمواضيع التي تحتاج إلى تركيز ومراجعة.', 'محاكاة وتشخيص', C_AMBER)
]
for i, (t, b, tag, col) in enumerate(eval_cards):
    sleek_card(s7, M + (i % 2) * 6.05, 1.75 + (i // 2) * 2.5, 5.75, 2.25, t, b, tag=tag, accent=col)

# ════════════════════════════════════════════════════════════════════
# 8. كيدي (Kedy AI)
# ════════════════════════════════════════════════════════════════════
s8 = new_slide(C_NAVY_DEEP)
make_header(s8, 'المساعد الأكاديمي الذكي «كيدي» — مرتبط بمناهج الكلية الفعلية', 'الذكاء الاصطناعي الأكاديمي', is_dark=True)

tx_ai_intro = s8.shapes.add_textbox(Inches(M), Inches(1.55), Inches(W - M * 2), Inches(0.75))
apply_p(tx_ai_intro.text_frame.paragraphs[0], 
        'ليس مجرد روبوت محادثة عام: يقرأ كيدي ملفات ومحاضرات المواد الفعلية المرفوعة في النظام، ويجيب الطلاب بدقة من صلب المنهج الدراسي المعتمد للكلية.',
        14.5, C_TEXT_SKY)

ai_features = [
    ('التلخيص والشرح التفاعلي', 'تلخيص المحاضرات الطويلة واستخراج النقاط المفتاحية وتبسيط المفاهيم المعقدة باللغة المناسبة للطالب.', 'خاصية التلخيص'),
    ('توليد بطاقات الاستذكار (Flashcards)', 'استخراج الأسئلة السريعة والإجابات من محتوى الشيتات وتحويلها إلى بطاقات مراجعة تفاعلية.', 'بطاقات المراجعة'),
    ('بناء اختبارات تدريبية تجريبية', 'توليد أسئلة امتحانية متوقعة ومتنوعة الصعوبة بناءً على ما تم شرحه في المحاضرات للمراجعة الذاتية.', 'الاختبارات التجريبية'),
    ('مساعد تصحيح الأكواد البرمجية', 'شرح رسائل الخطأ البرمجية وتقديم توجيهات وحلول لطلاب تقنية المعلومات مع الحفاظ على الأمان الأكاديمي.', 'تصحيح البرمجة')
]
for i, (t, b, tag) in enumerate(ai_features):
    sleek_card(s8, M + (i % 2) * 6.05, 2.45 + (i // 2) * 1.95, 5.75, 1.75, t, b, tag=tag, is_dark=True, accent=C_AMBER)

tx_ai_foot = s8.shapes.add_textbox(Inches(M), Inches(6.6), Inches(W - M * 2), Inches(0.4))
apply_p(tx_ai_foot.text_frame.paragraphs[0], 
        'موثوقية تشغيلية وتكلفة صفرية: يعمل النظام بالتناوب الذكي التلقائي بين 4 مزودين عالميين (Gemini · Qwen · Cohere · Groq).', 
        12.5, C_TEXT_SKY)

# ════════════════════════════════════════════════════════════════════
# 9. أدوات الطلاب
# ════════════════════════════════════════════════════════════════════
s9 = new_slide()
make_header(s9, 'بيئة تعليمية متكاملة تدعم الطالب داخل وخارج القاعة الدراسية', 'أدوات الطلاب')
student_tools = [
    ('مختبر البرمجة السحابي (Code Lab)', 'بيئة لكتابة وتنفيذ أكواد C++ وتشغيلها مباشرة من المتصفح أو الهاتف دون الحاجة لتثبيت برامج إضافية.', 'مختبر برمجي سحابي', C_PRIMARY),
    ('غرف المذاكرة الجماعية (Study Pods)', 'غرف افتراضية لكل دفعة تتضمن مؤقت بومودورو للمذاكرة متزامن لحظياً بين الطلاب وقائمة مهام مشتركة.', 'مذاكرة جماعية متزامنة', C_PURPLE),
    ('بطاقات الاستذكار الرقمية', 'أداة مراجعة سريعة للمصطلحات والمفاهيم تمكن الطالب من صناعة بطاقاته الخاصة أو توليدها آلياً.', 'بطاقات استذكار رقمية', C_SECONDARY),
    ('لوحة المتصدرين والتحفيز', 'نظام نقاط ومكافآت على تسليم الواجبات والتفوق في الاختبارات لخلق بيئة تنافسية إيجابية ومحفزة.', 'لوحة التنافس والتحفيز', C_AMBER),
    ('السجل الأكاديمي الرقمي الموثق', 'سجل شامل بإنجازات الطالب ونسب الحضور والدرجات مع رمز تحقق وبصمة أمان إلكترونية.', 'سجل أكاديمي موثق', C_NAVY_DEEP),
    ('استبيانات جودة المقررات', 'تقييم فصلي مجهول الهوية يقيس رضا الطلاب عن المقررات والأداء الأكاديمي لضمان الجودة.', 'استبيانات الجودة', C_TEXT_MUTED)
]
for i, (t, b, tag, col) in enumerate(student_tools):
    sleek_card(s9, M + (i % 3) * 4.0, 1.75 + (i // 3) * 2.45, 3.8, 2.25, t, b, tag=tag, accent=col)

# ════════════════════════════════════════════════════════════════════
# 10. المالية
# ════════════════════════════════════════════════════════════════════
s10 = new_slide()
make_header(s10, 'إدارة الرسوم الدراسية وعمليات السداد بأعلى معايير الدقة', 'الوحدة المالية')
sleek_card(s10, M, 1.75, 3.8, 2.4, 'إسناد الرسوم والخصومات',
           'إمكانية إضافة الرسوم لطالب محدد أو للدفعة بالكامل، مع تحديد مواعيد الاستحقاق وتطبيق المنح والخصومات المعتمدة وإشعار الطالب فوراً.',
           tag='تحديد الرسوم والمنح', accent=C_NAVY_DEEP)

sleek_card(s10, M + 4.0, 1.75, 3.8, 2.4, 'التخصيص التلقائي (FIFO)',
           'تخصيص أي دفعة تسديد تلقائياً لأقدم رسم مستحق داخل معاملة واحدة (Transaction) تضمن استحالة حدوث أي خطأ أو تضارب محاسبي.',
           tag='تخصيص محاسبي آلي', accent=C_SECONDARY)

sleek_card(s10, M + 8.0, 1.75, 3.8, 2.4, 'رفع ومراجعة الإيصالات',
           'يرفع الطالب صورة إشعار التحويل البنكي عبر هاتفه، وتتولى الإدارة المالية فحص الطلب والموافقة عليه أو رفضه مع إبداء السبب.',
           tag='تدقيق ومراجعة الإيصالات', accent=C_PRIMARY)

sleek_card(s10, M, 4.45, 11.8, 2.35, 'لوحة متابعة الأرصدة والتقارير المالية المركزية',
           'عرض شامل لإجمالي الرسوم، المبالغ المسددة، والمتبقي لكل طالب، مع تقرير تفصيلي بالمتأخرات وإمكانية إرسال تذكيرات آلية للطلاب المتأخرين عن السداد. جميع الأرقام مترابطة من قاعدة بيانات واحدة.',
           tag='التقارير المالية المركزية', accent=C_AMBER)

# ════════════════════════════════════════════════════════════════════
# 11. التواصل
# ════════════════════════════════════════════════════════════════════
s11 = new_slide()
make_header(s11, 'شبكة تواصل فورية وتنبيهات مخصصة تربط الكلية بطلابها', 'التواصل والتنبيهات')
comm_items = [
    ('إشعارات Push فورية على الهواتف', 'تصل مباشرة إلى شاشة هاتف المستخدم كإشعار نظام حقيقي — عند رصد درجة، تنبيه غياب، أو إعلان عاجل.', 'إشعار نظام فوري', C_PRIMARY),
    ('توجيه ذكي ومستهدف للإعلانات', 'إمكانية إرسال الإشعار لدفعة محددة، أو تخصص معين، أو طالب بعينه دون إزعاج باقي المستخدمين.', 'توجيه دقيق للإعلانات', C_SECONDARY),
    ('التقويم الأكاديمي الشامل', 'تقويم موحد يعرض مواعيد الامتحانات، تسليم التكليفات، الفعاليات والعطلات الرسمية للكلية.', 'تقويم أكاديمي مركزي', C_AMBER),
    ('طرح الأسئلة المباشرة على الفيديو', 'يتيح للطالب كتابة استفساره عند دقيقة محددة من المحاضرة المسجلة ليجيب عليه الأستاذ في سياق الشرح.', 'استفسار الفيديو الموقوت', C_PURPLE)
]
for i, (t, b, tag, col) in enumerate(comm_items):
    sleek_card(s11, M, 1.75 + i * 1.05, 11.8, 0.95, t, b, tag=tag, accent=col)

sleek_card(s11, M, 6.2, 11.8, 0.75, 
           'نظام متكامل للإبلاغ عن المحتوى المسيء وحظر المخالفين مع التزام المراجعة خلال 24 ساعة (متطلب رسمي للمتاجر)',
           tag='حوكمة وحماية المجتمع', accent=C_RED)

# ════════════════════════════════════════════════════════════════════
# 12. الأمان
# ════════════════════════════════════════════════════════════════════
s12 = new_slide()
make_header(s12, 'أعلى معايير الحماية والتشفير والامتثال لمعايير الخصوصية', 'الأمان والحوكمة')
security_items = [
    ('تشفير كلمات المرور المتقدم', 'تشفير كامل غير قابل للعكس باستخدام bcrypt مع فرض تغيير كلمة المرور الافتراضية عند أول تسجيل دخول.', 'تشفير bcrypt قوي', C_NAVY_DEEP),
    ('الدخول الحيوي بالبصمة والوجه', 'دعم مصادقة Passkeys والبصمة عبر أجهزة الهواتف لتسهيل الوصول الآمن دون كتابة كلمة المرور.', 'مصادقة بيومترية', C_PRIMARY),
    ('إدارة الجلسات ومنع الازدواج', 'حصر الحساب في جلسة دخول نشطة واحدة، حيث يؤدي تسجيل الدخول من جهاز جديد لإنهاء الجلسة السابقة.', 'جلسة نشطة موحدة', C_PURPLE),
    ('عزل البيانات على مستوى الخادم', 'ضمان برمجي يمنع أي مستخدم من الوصول لبيانات أو تقارير دفعة أخرى حتى في حال محاولة التلاعب بالروابط.', 'عزل برمجي محكم', C_SECONDARY),
    ('حماية الملفات والمستندات الحساسة', 'ملفات تسليم الواجبات وإيصالات السداد المالية مشفرة ومحمية ولا تفتح إلا للمصرح لهم فقط.', 'حماية الملفات الحساسة', C_AMBER),
    ('حذف الحساب والبيانات الذاتي', 'إتاحة خيار حذف الحساب والبيانات الشخصية للطالب من داخل التطبيق وفق اشتراطات الخصوصية الدولية.', 'الامتثال للخصوصية', C_RED)
]
for i, (t, b, tag, col) in enumerate(security_items):
    sleek_card(s12, M + (i % 3) * 4.0, 1.75 + (i // 3) * 2.45, 3.8, 2.25, t, b, tag=tag, accent=col)

# ════════════════════════════════════════════════════════════════════
# 13. تطبيقات الهواتف
# ════════════════════════════════════════════════════════════════════
s13 = new_slide()
make_header(s13, 'تطبيقات أصلية للأندرويد والآيفون مع دعم العمل دون إنترنت', 'تطبيقات الهواتف')
sleek_card(s13, M, 1.75, 5.75, 2.4, 'تطبيق الأندرويد (Android) — جاهز 100%',
           'التطبيق مبني ومختبر ويعمل بكفاءة عالية مع دعم الإشعارات اللحظية والدخول بالبصمة وإمكانية حفظ المحاضرات والملفات للعمل دون إنترنت.',
           tag='منصة أندرويد الرسمية', accent=C_SECONDARY)

sleek_card(s13, M + 6.05, 1.75, 5.75, 2.4, 'تطبيق الآيفون (iOS) — مبني ومهيأ عبر GitHub Actions',
           'تم إعداد وتجميع حزمة التطبيق (IPA) بنجاح عبر سحابة أبل على GitHub Actions، وهو مستوفٍ لكافة معايير وشروط متجر App Store.',
           tag='منصة iOS الرسمية', accent=C_PRIMARY)

mobile_caps = [
    ('العمل دون اتصال (Offline First)', 'قراءة المحاضرات والشيتات المحفوظة مسبقاً وتصفح واجهات التطبيق في حال انقطاع شبكة الإنترنت.', 'ميزة العمل أوفلاين', C_PRIMARY),
    ('إشعارات النظام التفاعلية', 'استقبال الإشعارات والتحذيرات الأكاديمية على الهاتف مباشرة حتى عندما يكون التطبيق مغلقاً بالكامل.', 'إشعارات النظام اللحظية', C_AMBER),
    ('واجهة عربية متكيفة بالكامل', 'تصميم متوافق مع كافة مقاسات الشاشات من الهواتف الصغيرة وحتى الأجهزة اللوحية مع دعم الوضع الليلي.', 'تصميم متجاوب بالكامل', C_PURPLE)
]
for i, (t, b, tag, col) in enumerate(mobile_caps):
    sleek_card(s13, M + i * 4.0, 4.45, 3.8, 2.3, t, b, tag=tag, accent=col)

# ════════════════════════════════════════════════════════════════════
# 14. الخاتمة
# ════════════════════════════════════════════════════════════════════
s14 = new_slide(C_NAVY_DEEP)
make_header(s14, 'المنصة جاهزة للتشغيل الكامل — التوصيات والقرارات المقترحة', 'الخاتمة وخطة العمل', is_dark=True)
decisions = [
    ('اعتماد التشغيل الرسمي للنظام', 'إقرار المنصة كمرجع رسمي معتمد لرصد الحضور وتكليفات الواجبات والدرجات بدلاً من الطرق التقليدية لضمان التزام كافة الأطراف.', 'القرار الأول', C_AMBER),
    ('ورشة تدريبية قصيرة للأساتذة', 'تنظيم جلسة تعريفية عملية لأساتذة المواد لشرح آليات رفع المحاضرات وبنك الأسئلة ورصد الحضور والتقييم السريع.', 'القرار الثاني', C_TEXT_SKY),
    ('تدشين تطبيق الآيفون على App Store', 'حساب مطور أبل جاهز، والعمل جارٍ لرفع التطبيق واعتماده رسمياً على متجر App Store لإتاحته لطلاب الكلية.', 'القرار الثالث', C_SECONDARY),
    ('تعيين مسؤول مراجعة البلاغات', 'تكليف موظف إداري بمتابعة بلاغات المحتوى لضمان الاستجابة السريعة خلال 24 ساعة كمتطلب استمرار في المتاجر.', 'القرار الرابع', C_PRIMARY)
]
for i, (t, b, tag, col) in enumerate(decisions):
    sleek_card(s14, M + (i % 2) * 6.05, 1.95 + (i // 2) * 2.2, 5.75, 2.0, t, b, tag=tag, is_dark=True, accent=col)

tx_foot_final = s14.shapes.add_textbox(Inches(M), Inches(6.65), Inches(W - M * 2), Inches(0.4))
apply_p(tx_foot_final.text_frame.paragraphs[0], 
        'كلية النصر التقنية — النظام الجامعي الرقمي المتكامل · الإصدار المعتمد ٢.١.٠ · شكر وتقدير لمجلس الكلية والعمادة', 
        12.0, c('64748B'))

out_file = 'عرض-نظام-كلية-النصر-التقنية-النهائي.pptx'
prs.save(out_file)

# حفظ نسخة مخصصة أيضاً باسم صريح
prs.save('عرض-نظام-كلية-النصر-التقنية-Times-New-Roman.pptx')

desktop = os.path.expanduser('~/Desktop')
downloads = os.path.expanduser('~/Downloads')
for p in [desktop, downloads]:
    if os.path.exists(p):
        for name in ['عرض-نظام-كلية-النصر-التقنية-النهائي.pptx', 'عرض-نظام-كلية-النصر-التقنية-Times-New-Roman.pptx', 'عرض-نظام-كلية-النصر-التقنية.pptx']:
            try:
                shutil.copy2(out_file, os.path.join(p, name))
            except Exception:
                pass

print('SUCCESS_TIMES_NEW_ROMAN_SAVED')
