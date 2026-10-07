const { spawnSync } = require("node:child_process");
const { Readable } = require("node:stream");
const { Pool } = require("pg");

require("../src/load-env").loadLocalEnv();

if (!process.env.DATABASE_URL) {
  console.log("Password reset test skipped: DATABASE_URL is required to verify PostgreSQL-backed password reset.");
  process.exit(0);
}

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "test_resend_key";
process.env.AUTH_EMAIL_FROM = "Talme HR <noreply@iplant.talme.in>";
process.env.APP_URL = process.env.APP_URL || "https://iplant.talme.in";

const resendRequests = [];
global.fetch = async (url, options = {}) => {
  if (url !== "https://api.resend.com/emails") {
    throw new Error(`Unexpected fetch call: ${url}`);
  }
  const payload = JSON.parse(options.body || "{}");
  resendRequests.push({ url, options, payload });
  return {
    ok: true,
    status: 200,
    async json() {
      return { id: `email-${resendRequests.length}` };
    }
  };
};

let requestHandler, deleteAuthUserByEmail, closeAuthStore, db, directPool;

function call(method, url, payload, headers = {}) {
  const body = payload == null ? "" : JSON.stringify(payload);
  const req = Readable.from(body ? [body] : []);
  Object.assign(req, {
    method,
    url,
    headers: {
      host: "localhost",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "user-agent": "password-reset-test",
      ...headers
    },
    socket: { remoteAddress: "127.0.0.1" }
  });

  return new Promise((resolve, reject) => {
    const responseHeaders = {};
    const res = {
      statusCode: 200,
      setHeader(key, value) {
        responseHeaders[key.toLowerCase()] = value;
      },
      getHeader(key) {
        return responseHeaders[key.toLowerCase()];
      },
      writeHead(code, headers = {}) {
        this.statusCode = code;
        for (const [key, value] of Object.entries(headers)) this.setHeader(key, value);
      },
      end(chunk = "") {
        const text = String(chunk);
        resolve({
          status: this.statusCode,
          headers: responseHeaders,
          body: text ? JSON.parse(text) : {}
        });
      }
    };
    requestHandler(req, res).catch(reject);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoSensitiveResponse(payload, otp) {
  const serialized = JSON.stringify(payload);
  assert(!serialized.includes(otp), "API response must not include OTP");
  assert(!serialized.toLowerCase().includes("password_hash"), "API response must not include password hash");
}

function latestOtpFromResend() {
  const request = resendRequests.at(-1);
  assert(request, "Expected Resend request");
  const text = String(request.payload.text || "");
  const match = text.match(/OTP is (\d{6})/);
  assert(match, "Expected OTP in outbound Resend email body");
  return match[1];
}

function cookieHeaderFrom(response, name) {
  const setCookie = response.headers["set-cookie"];
  const values = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean);
  const cookieValue = values.find(value => String(value).startsWith(`${name}=`));
  assert(cookieValue, `Expected ${name} cookie`);
  return String(cookieValue).split(";")[0];
}

async function newestOtpRow(email) {
  const result = await directPool.query(
    `SELECT id, otp_hash, attempt_count, expires_at, verified_at, used_at
     FROM auth_password_otps
     WHERE LOWER(email) = LOWER($1)
     ORDER BY created_at DESC
     LIMIT 1`,
    [email]
  );
  return result.rows[0] || null;
}

async function assertRestartPersistence(email, password) {
  const script = `
    const { Pool } = require("pg");
    const bcrypt = require("bcrypt");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
    });
    (async () => {
      const result = await pool.query("SELECT password_hash FROM auth_users WHERE LOWER(email) = LOWER($1) AND role = $2 LIMIT 1", [process.env.TEST_EMAIL, process.env.TEST_ROLE]);
      if (!result.rows[0]) throw new Error("User missing after restart");
      if (!await bcrypt.compare(process.env.TEST_PASSWORD, result.rows[0].password_hash)) throw new Error("Password did not persist");
      await pool.end();
    })().catch(async error => {
      console.error(error.message);
      await pool.end().catch(() => {});
      process.exit(1);
    });
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, TEST_EMAIL: email, TEST_PASSWORD: password, TEST_ROLE: "hr_manager" },
    encoding: "utf8"
  });
  assert(result.status === 0, `Restart persistence check failed: ${result.stderr || result.stdout}`);
}

async function main() {
  const fixture = await require("./auth-test-database").createAuthTestDatabase();
  ({ requestHandler } = require("../src/server"));
  ({ deleteAuthUserByEmail, closeAuthStore } = require("../src/auth-store"));
  ({ db } = require("../src/db"));
  directPool = fixture.pool;
  const email = `reset-test-${Date.now()}@talme.test`;
  const missingEmail = `missing-reset-${Date.now()}@talme.test`;
  const phone = `6${String(Date.now()).slice(-9)}`;
  const oldPassword = `Old-${Date.now()}-Aa1!`;
  const newPassword = `New-${Date.now()}-Aa1!`;

  try {
    const registration = await call("POST", "/api/auth/register", {
      type: "talme_hr",
      name: "Password Reset Test User",
      email,
      phone,
      password: oldPassword,
      confirmPassword: oldPassword
    });
    assert(registration.status === 201, `Expected registration 201, got ${registration.status}`);
    await directPool.query("UPDATE auth_users SET approval_status = 'APPROVED', is_active = true WHERE email = $1 AND role = 'hr_manager'", [email]);

    const missing = await call("POST", "/api/auth/forgot-password", { email: missingEmail, role: "hr_manager" });
    assert(missing.status === 404, `Expected unregistered email 404, got ${missing.status}`);
    assert(missing.body.message === "Email address is not registered.", "Expected unregistered email message");

    const forgot = await call("POST", "/api/auth/forgot-password", { email, role: "hr_manager" });
    assert(forgot.status === 200, `Expected forgot password 200, got ${forgot.status}`);
    assert(forgot.body.message === "OTP has been sent to your registered email.", "Expected OTP sent message");
    assert(resendRequests.length === 1, "Expected one Resend request");
    assert(resendRequests[0].payload.from === "Talme HR <noreply@iplant.talme.in>", "Expected verified Resend sender");
    assert(resendRequests[0].payload.to[0] === email, "Expected Resend request to registered email");
    const firstOtp = latestOtpFromResend();
    assertNoSensitiveResponse(forgot.body, firstOtp);
    const firstOtpRow = await newestOtpRow(email);
    assert(firstOtpRow, "Expected persisted OTP row");
    assert(firstOtpRow.otp_hash !== firstOtp, "OTP must not be stored in plain text");

    const wrongOtp = await call("POST", "/api/auth/forgot-password/verify", { email, role: "hr_manager", otp: "000000" });
    assert(wrongOtp.status === 401, `Expected wrong OTP 401, got ${wrongOtp.status}`);
    assert(wrongOtp.body.message === "Invalid OTP.", "Expected invalid OTP message");

    const verify = await call("POST", "/api/auth/forgot-password/verify", { email, role: "hr_manager", otp: firstOtp });
    assert(verify.status === 200, `Expected correct OTP 200, got ${verify.status}`);
    assert(verify.body.message === "OTP verified.", "Expected OTP verified message");
    assert(!JSON.stringify(verify.body).includes(firstOtp), "Verify response must not include OTP");
    assert(!verify.body.resetToken, "Verify response must not expose reset token");
    const resetCookie = cookieHeaderFrom(verify, "talme_reset");

    const reusedOtp = await call("POST", "/api/auth/forgot-password/verify", { email, role: "hr_manager", otp: firstOtp });
    assert(reusedOtp.status === 401, `Expected reused OTP 401, got ${reusedOtp.status}`);
    assert(reusedOtp.body.message === "Invalid OTP.", "Expected reused OTP invalid message");

    const { sha256 } = require("../src/security");
    const limitKey = `login-fail:${sha256(JSON.stringify([email, "hr_manager"]))}`;
    for (let i = 0; i < 5; i++) await require("../src/auth-store").consumeSecurityLimit(limitKey, 5, 900);
    const reset = await call("POST", "/api/auth/reset-password", {
      email,
      role: "hr_manager",
      password: ` ${newPassword} `,
      confirmPassword: ` ${newPassword} `
    }, { cookie: resetCookie });
    assert(reset.status === 200, `Expected reset password 200, got ${reset.status}`);
    assert(reset.body.message === "Password reset successfully. You can now login with your new password.", "Expected reset success message");
    assert(await require("../src/auth-store").getSecurityLimit(limitKey, 1) === 0, "Verified password reset must clear the login lockout");

    const reusedPassword = `Again-${Date.now()}-Aa1!`;
    const reusedResetCookie = await call("POST", "/api/auth/reset-password", {
      email,
      role: "hr_manager",
      password: reusedPassword,
      confirmPassword: reusedPassword
    }, { cookie: resetCookie });
    assert(reusedResetCookie.status === 401, `Expected reused reset token 401, got ${reusedResetCookie.status}`);
    assert(reusedResetCookie.body.message === "Invalid OTP.", "Expected reused reset token invalid message");

    const newLogin = await call("POST", "/api/auth/login", {
      email,
      password: ` ${newPassword} `,
      role: "hr_manager"
    });
    assert(newLogin.status === 200, `Expected new password login 200, got ${newLogin.status}`);

    const oldLogin = await call("POST", "/api/auth/login", {
      email,
      password: oldPassword,
      role: "hr_manager"
    });
    assert(oldLogin.status === 401, `Expected old password login 401, got ${oldLogin.status}`);
    assert(oldLogin.body.message === "Invalid password.", "Expected old password invalid message");

    const expiredForgot = await call("POST", "/api/auth/forgot-password", { email, role: "hr_manager" });
    assert(expiredForgot.status === 200, `Expected expired-flow forgot 200, got ${expiredForgot.status}`);
    const expiredOtp = latestOtpFromResend();
    const expiredRow = await newestOtpRow(email);
    await directPool.query(
      "UPDATE auth_password_otps SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
      [expiredRow.id]
    );
    const expiredVerify = await call("POST", "/api/auth/forgot-password/verify", { email, role: "hr_manager", otp: expiredOtp });
    assert(expiredVerify.status === 410, `Expected expired OTP 410, got ${expiredVerify.status}`);
    assert(expiredVerify.body.message === "OTP has expired. Please request a new OTP.", "Expected expired OTP message");

    const savedResendKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "";
    const missingConfig = await call("POST", "/api/auth/forgot-password", { email, role: "hr_manager" });
    process.env.RESEND_API_KEY = savedResendKey;
    assert(missingConfig.status === 503, `Expected missing Resend key 503, got ${missingConfig.status}`);
    assert(missingConfig.body.error === "Email service is not configured: RESEND_API_KEY is required.", "Expected missing Resend key message");
    assert(resendRequests.length === 2, "Missing Resend key must not call Resend");

    await assertRestartPersistence(email, newPassword);

    console.log("Password reset test passed: registered/unregistered email, Resend request, OTP verify/reject/expire/reuse, password update, old/new login, missing RESEND_API_KEY, and restart persistence.");
  } finally {
    await deleteAuthUserByEmail(email).catch(() => {});
    db.prepare("DELETE FROM users WHERE lower(email) = lower(?)").run(email);
    await closeAuthStore().catch(() => {});
    db.close();
    await fixture.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
