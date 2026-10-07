const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createAuthTestDatabase } = require("./auth-test-database");
const { PENDING_MESSAGE } = require("../src/registration-policy");

async function main() {
  const fixture = await createAuthTestDatabase();
  const auth = require("../src/auth-store");
  const { requestHandler } = require("../src/server");
  const { db } = require("../src/db");
  const { signJwt, verifyJwt } = require("../src/security");
  let requestId = 0;
  let admin;
  function call(url, { method = "GET", body, login, csrf = true, cookie } = {}) {
    const text = body ? JSON.stringify(body) : "";
    const request = Readable.from(text ? [Buffer.from(text)] : []);
    Object.assign(request, { method, url, headers: { host: "localhost", "content-type": "application/json", "user-agent": "approval-test",
      "content-length": String(Buffer.byteLength(text)), ...(cookie ? { cookie } : {}),
      ...(login ? { authorization: `Bearer ${login.accessToken}`, ...(csrf ? { "x-csrf-token": login.csrfToken } : {}) } : {}) },
      socket: { remoteAddress: `127.0.0.${++requestId}` } });
    return new Promise((resolve, reject) => {
      const headers = {};
      const response = { statusCode: 200, setHeader(key, value) { headers[key.toLowerCase()] = value; }, getHeader(key) { return headers[key.toLowerCase()]; },
        writeHead(code, extra = {}) { this.statusCode = code; Object.assign(headers, extra); },
        end(value) { resolve({ status: this.statusCode, body: JSON.parse(String(value)), headers }); } };
      requestHandler(request, response).catch(reject);
    });
  }
  const signIn = body => call("/api/auth/login", { method: "POST", body });
  let registrationNumber = 2;
  const register = (email, type = "talme_hr") => call("/api/auth/register", { method: "POST", body: {
    type, name: "Pending User", email, phone: String(9000000000 + registrationNumber++), password: fixture.admin.password,
    confirmPassword: fixture.admin.password, approvalStatus: "APPROVED", is_active: true } });
  const action = (id, decision, login) => call(`/api/admin/registered-users/${id}${decision === "delete" ? "" : `/${decision}`}`, {
    method: decision === "delete" ? "DELETE" : "POST", login, body: { confirmed: true, currentPassword: fixture.admin.password,
      confirmationEmail: id === admin.user.authUserId ? fixture.admin.email : "pending@example.test" } });
  const cookieOf = response => String(response.headers["set-cookie"]).split(";")[0];
  try {
    assert.equal((await auth.findAuthUserByEmail(fixture.admin.email, fixture.admin.role)).approval_status, "APPROVED");
    assert.equal((await auth.findAuthUserByEmail("inactive@example.test", "hr_manager")).approval_status, "REJECTED");
    let adminResponse = await signIn(fixture.admin);
    assert.equal(adminResponse.status, 200);
    admin = adminResponse.body;
    const email = "pending@example.test";
    const credentials = { email, password: fixture.admin.password, role: "hr_manager" };
    const registration = await register(email);
    assert.equal(registration.status, 201);
    assert.equal(registration.body.message, PENDING_MESSAGE);
    assert.equal(registration.body.approvalStatus, "PENDING");
    assert.equal(registration.body.accessToken, undefined);
    const target = await auth.findAuthUserByEmail(email, credentials.role);
    assert.equal(target.approval_status, "PENDING"); assert.equal(target.is_active, false);
    assert.equal((await signIn(credentials)).body.message, PENDING_MESSAGE);
    assert.equal((await signIn(credentials)).status, 403);
    assert.equal((await signIn({ ...credentials, password: "wrong" })).status, 401);
    assert.equal((await call("/hr/dashboard")).status, 401);
    assert.equal((await call("/api/auth/forgot-password", { method: "POST", body: credentials })).status, 403);
    assert.equal((await action(target.id, "approve")).status, 401);
    assert.equal((await call(`/api/admin/registered-users/${target.id}/approve`, { method: "POST", login: admin, csrf: false })).status, 403);
    const list = await call("/api/admin/registered-users", { login: admin });
    assert.equal(list.status, 200);
    assert(list.body.items.some(item => item.id === target.id && item.phone && item.status === "PENDING"));
    assert(!JSON.stringify(list.body).includes("password_hash"));
    assert.equal((await action(target.id, "approve", admin)).status, 200);
    console.log("Verified pending registration, authorization and approval.");
    assert.equal((await action(target.id, "approve", admin)).status, 409, "Duplicate approval must not revoke a valid session");
    let approved = await signIn(credentials);
    assert.equal(approved.status, 200);
    assert.equal((await call("/hr/dashboard", { login: approved.body })).status, 200);
    assert.equal((await action(target.id, "reject", approved.body)).status, 403);
    assert.equal((await call("/api/auth/refresh", { method: "POST", cookie: cookieOf(approved) })).status, 200);
    const legacyPayload = verifyJwt(approved.body.accessToken); delete legacyPayload.authSid;
    assert.equal((await call("/api/me", { login: { ...approved.body, accessToken: signJwt(legacyPayload) } })).status, 401);
    // Same-email Admin and HR registrations must never inherit one another's permissions.
    assert.equal((await register(fixture.admin.email)).status, 201);
    const sibling = await auth.findAuthUserByEmail(fixture.admin.email, "hr_manager");
    assert.equal((await action(sibling.id, "approve", admin)).status, 200);
    const siblingLogin = await signIn({ ...fixture.admin, role: "hr_manager" });
    assert.equal(siblingLogin.status, 200);
    assert.equal((await call("/api/admin/registered-users", { login: siblingLogin.body })).status, 403);
    assert.equal((await call("/api/admin/registered-users", { login: admin })).status, 200);
    assert.equal((await action(target.id, "approve", siblingLogin.body)).status, 403);
    assert.equal((await action(sibling.id, "reject", admin)).status, 200);
    assert.equal((await call("/api/me", { login: siblingLogin.body })).status, 401);
    assert.equal((await call("/api/me", { login: admin })).status, 200);
    console.log("Verified approved access, refresh tokens and same-email role isolation.");
    await auth.createPasswordResetOtp({ authUserId: target.id, email, otpHash: "fixture-otp", expiresAt: new Date(Date.now() + 60000) });
    assert.equal((await action(target.id, "reject", admin)).status, 200);
    assert.equal((await call("/api/me", { login: approved.body })).status, 401);
    assert.equal((await call("/hr/dashboard", { login: approved.body })).status, 401);
    assert.equal((await call("/api/auth/refresh", { method: "POST", cookie: cookieOf(approved) })).status, 401);
    assert.match((await signIn(credentials)).body.message, /rejected/);
    assert((await fixture.pool.query("SELECT used_at FROM auth_password_otps WHERE auth_user_id = $1", [target.id])).rows.every(row => row.used_at));
    assert.equal((await action(target.id, "approve", admin)).status, 200);
    assert.equal((await call("/api/me", { login: approved.body })).status, 401, "Reapproval must not resurrect an old session");
    approved = await signIn(credentials);
    assert.equal(approved.status, 200);
    console.log("Verified rejection, session revocation and safe reapproval.");
    // Persistent sessions still enforce approval after local session storage is lost.
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(approved.body.user.id);
    assert.equal((await call("/api/me", { login: approved.body })).status, 200);
    const renewed = await call("/api/auth/refresh", { method: "POST", cookie: cookieOf(approved) });
    assert.equal(renewed.status, 200);
    assert.equal((await call("/api/me", { login: renewed.body })).status, 200);
    console.log("Verified recovery without local session storage.");
    assert.equal((await action(target.id, "delete", admin)).status, 200);
    assert.equal((await call("/api/me", { login: renewed.body })).status, 401);
    assert.equal((await call("/api/auth/refresh", { method: "POST", cookie: cookieOf(approved) })).status, 401);
    assert.match((await signIn(credentials)).body.message, /deleted/);
    assert.equal((await register(email.toUpperCase())).status, 403);
    assert.equal((await action(target.id, "approve", admin)).status, 409);
    assert.equal((await action(target.id, "delete", admin)).status, 409);
    assert.equal((await action(admin.user.authUserId, "delete", admin)).status, 409);
    assert.equal((await action(admin.user.authUserId, "reject", admin)).status, 409);
    assert.equal((await action("99999999", "approve", admin)).status, 404);
    const counts = await auth.getRegisteredUserCounts();
    assert.deepEqual(counts, { totalRegisteredUsers: 3, totalActiveUsers: 1 });
    const reviews = (await fixture.pool.query("SELECT * FROM auth_registration_reviews WHERE auth_user_id = $1 ORDER BY id", [target.id])).rows;
    assert.deepEqual(reviews.map(row => row.status), ["APPROVED", "REJECTED", "APPROVED", "DELETED"]);
    assert(reviews.every(row => String(row.reviewer_auth_user_id) === admin.user.authUserId));
    // Admin registrations also require approval and cannot self-approve.
    assert.equal((await register("new-admin@example.test", "admin")).status, 201);
    assert.equal((await signIn({ ...fixture.admin, email: "new-admin@example.test" })).status, 403);
    console.log("Registration approval tests passed: real PostgreSQL migration, pending registration, admin authorization/CSRF, approval, rejection, permanent deletion, session/refresh revocation, persistent-session recovery, same-email role isolation, counters and durable review history. Only an isolated temporary schema was used.");
  } finally {
    await auth.closeAuthStore();
    db.close();
    await fixture.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
