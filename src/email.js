const { loadLocalEnv } = require("./load-env");

loadLocalEnv();

const appUrl = process.env.APP_URL || "https://iplant.talme.in";
const verifiedDomain = "iplant.talme.in";
const defaultEmailFrom = "Talme HR <noreply@iplant.talme.in>";

function senderAddress(from) {
  const match = String(from || "").match(/<([^<>@\s]+@[^<>@\s]+)>|([^<>@\s]+@[^<>@\s]+)/);
  return (match?.[1] || match?.[2] || "").toLowerCase();
}

function getEmailConfig() {
  const resendFromEmail = process.env.RESEND_FROM_EMAIL || "";
  return {
    resendApiKey: process.env.RESEND_API_KEY || "",
    emailFrom: process.env.AUTH_EMAIL_FROM || process.env.EMAIL_FROM || (resendFromEmail ? `Talme HR <${resendFromEmail}>` : defaultEmailFrom)
  };
}

function requireEmailConfig() {
  const config = getEmailConfig();
  if (!config.resendApiKey) {
    throw Object.assign(new Error("Email service is not configured: RESEND_API_KEY is required."), { statusCode: 503, expose: true });
  }
  if (!senderAddress(config.emailFrom).endsWith(`@${verifiedDomain}`)) {
    throw Object.assign(new Error(`Email service is not configured: sender must use ${verifiedDomain}.`), { statusCode: 503, expose: true });
  }
  return config;
}

async function sendEmail({ to, subject, text, html }) {
  const { resendApiKey, emailFrom } = requireEmailConfig();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: emailFrom,
      to: [to],
      subject,
      text,
      html
    })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw Object.assign(new Error(payload.message || "Unable to send email."), { statusCode: 502 });
  }
}

async function sendPasswordResetOtpEmail({ to, name, otp }) {
  const safeName = name || "Talme user";
  await sendEmail({
    to,
    subject: "Talme password reset OTP",
    text: [
      `Hello ${safeName},`,
      "",
      `Your Talme password reset OTP is ${otp}.`,
      "This OTP expires in 10 minutes.",
      "",
      "If you did not request this, you can ignore this email.",
      appUrl
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.5">
        <h2>Talme password reset</h2>
        <p>Hello ${escapeHtml(safeName)},</p>
        <p>Your password reset OTP is:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px">${otp}</p>
        <p>This OTP expires in 10 minutes.</p>
        <p>If you did not request this, you can ignore this email.</p>
      </div>
    `
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

module.exports = {
  requireEmailConfig,
  sendPasswordResetOtpEmail
};
