const nodemailer = require("nodemailer");

// إنشاء ناقل البريد الإلكتروني (Transporter)
const createTransporter = () => {
  const host = process.env.SMTP_HOST || "elnasrcsit.website";
  const port = parseInt(process.env.SMTP_PORT, 10) || 465;
  const secure = process.env.SMTP_SECURE === "false" ? false : (port === 465);
  const user = process.env.SMTP_USER || "help@elnasrcsit.website";
  const pass = process.env.SMTP_PASS || "";

  return nodemailer.createTransport({
    host,
    port,
    secure, // true لـ 465 SSL، false لـ 587 TLS
    auth: { user, pass },
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === "production" && process.env.SMTP_ALLOW_SELFSIGNED !== "true"
    }
  });
};

// دالة عامة لإرسال البريد الإلكتروني
const sendEmail = async ({ to, subject, html }) => {
  try {
    const user = process.env.SMTP_USER || "help@elnasrcsit.website";
    const pass = process.env.SMTP_PASS;

    // إذا لم تتوفر كلمة المرور وتم وضع البيئة كـ development، نطبع في الكونسول للمعاينة
    if (!pass && process.env.NODE_ENV === "development") {
      console.log("=== DEVELOPMENT EMAIL (NO SMTP PASS SET) ===");
      console.log("To:", to);
      console.log("Subject:", subject);
      console.log("HTML:", html);
      console.log("==========================================");
      return true;
    }

    const transporter = createTransporter();
    const fromAddress = process.env.SMTP_FROM || `"كلية النصر التقنية" <${user}>`;

    const info = await transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      html
    });

    console.log("✅ Email sent successfully:", info.messageId);
    return true;
  } catch (error) {
    console.error("❌ Email sending error:", error);
    return false;
  }
};

// دالة إرسال كود إعادة تعيين كلمة المرور
const sendResetCodeEmail = async (user, code) => {
  const html = `
    <div dir="rtl" style="font-family: 'Cairo', Tahoma, Arial, sans-serif; background-color: #f8fafc; padding: 24px; color: #1e293b;">
      <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
        <div style="background: linear-gradient(135deg, #1e1b4b, #312e81, #4338ca); padding: 20px; text-align: center; color: #ffffff;">
          <h2 style="margin: 0; font-size: 1.25rem;">جامعة النصر التقنية</h2>
          <p style="margin: 4px 0 0; font-size: 0.85rem; opacity: 0.9;">كلية النصر التقنية</p>
        </div>
        <div style="padding: 24px;">
          <h3 style="color: #1e1b4b; margin-top: 0;">رمز إعادة تعيين كلمة المرور 🔑</h3>
          <p>مرحباً <strong>${user.name || 'عزيزي المستخدم'}</strong>،</p>
          <p>لقد طلبت إعادة تعيين كلمة المرور لحسابك في نظام كلية النصر التقنية.</p>
          <div style="font-size: 28px; font-weight: 800; color: #4338ca; padding: 14px; background: #eef2ff; text-align: center; border-radius: 8px; letter-spacing: 4px; margin: 20px 0; border: 1px dashed #6366f1;">
            ${code}
          </div>
          <p style="font-size: 0.85rem; color: #64748b;">هذا الرمز صالح لمدة <strong>20 دقيقة</strong> فقط.</p>
          <p style="font-size: 0.85rem; color: #64748b;">إذا لم تطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذه الرسالة وأمان حسابك في حماية.</p>
        </div>
        <div style="background: #f1f5f9; padding: 12px; text-align: center; font-size: 0.75rem; color: #64748b; border-top: 1px solid #e2e8f0;">
          جميع الحقوق محفوظة &copy; النظام الجامعي المتكامل — كلية النصر التقنية
        </div>
      </div>
    </div>
  `;

  return await sendEmail({
    to: user.email,
    subject: "كود إعادة تعيين كلمة المرور — كلية النصر التقنية",
    html
  });
};

module.exports = {
  sendEmail,
  sendResetCodeEmail
};
