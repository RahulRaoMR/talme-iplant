const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { spawnSync } = require("node:child_process");
const { createAuthTestDatabase } = require("./auth-test-database");

async function main() {
  const fixture = await createAuthTestDatabase();
  const auth = require("../src/auth-store");
  const { requestHandler } = require("../src/server");
  const { db } = require("../src/db");
  const { sha256, signJwt, verifyJwt } = require("../src/security");
  const { jwtSecret } = require("../src/config");
  let requestId = 10;
  function call(url, { method = "GET", body, login, ip, cookie, csrf = true } = {}) {
    const text = body ? JSON.stringify(body) : "";
    const request = Readable.from(text ? [Buffer.from(text)] : []);
    Object.assign(request, { method, url, headers: { host: "localhost", "content-type": "application/json", "user-agent": "security-test",
      "content-length": String(Buffer.byteLength(text)), ...(cookie ? { cookie } : {}),
      ...(login ? { authorization: `Bearer ${login.accessToken}`, ...(csrf ? { "x-csrf-token": login.csrfToken } : {}) } : {}) },
      socket: { remoteAddress: ip || `127.0.0.${++requestId}` } });
    return new Promise((resolve, reject) => {
      const headers = {};
      const response = { statusCode: 200, setHeader(key, value) { headers[key.toLowerCase()] = value; }, getHeader(key) { return headers[key.toLowerCase()]; },
        writeHead(code, extra = {}) { this.statusCode = code; for (const [key, value] of Object.entries(extra)) this.setHeader(key, value); },
        end(value) { resolve({ status: this.statusCode, body: JSON.parse(String(value)), headers }); } };
      requestHandler(request, response).catch(reject);
    });
  }
  const signIn = (credentials, extra = {}) => call("/api/auth/login", { method: "POST", body: credentials, ...extra });
  const cookieOf = response => String(response.headers["set-cookie"]).split(";")[0];
  try {
    const target = await auth.createAuthUser({ fullName: "Security Fixture", email: "security@example.test", phone: "9000000003", password: fixture.admin.password, role: "hr_manager" });
    await fixture.pool.query("UPDATE auth_users SET approval_status = 'APPROVED', is_active = true WHERE id = $1", [target.id]);
    const credentials = { email: target.email, role: target.role, password: fixture.admin.password };
    await fixture.pool.query("INSERT INTO auth_security_limits (key, attempts, expires_at) VALUES ('expired-fixture', 5, NOW() - INTERVAL '2 days')");
    const initial = await signIn(credentials);
    assert.equal(initial.status, 200);
    assert.equal((await fixture.pool.query("SELECT COUNT(*)::int AS count FROM auth_security_limits WHERE key = 'expired-fixture'")).rows[0].count, 0);
    const failureKey = `login-fail:${sha256(JSON.stringify([target.email, target.role]))}`;
    for (let i = 0; i < 5; i++) {
      const result = await signIn({ ...credentials, email: i % 2 ? target.email.toUpperCase() : target.email, password: "Wrong-Password-123!" });
      assert.equal(result.status, i === 4 ? 429 : 401);
      if (i === 4) assert(Number(result.headers["retry-after"]) > 0);
    }
    assert.equal((await signIn(credentials)).status, 429, "A correct password must not bypass a current login lockout");
    assert.equal((await call("/api/me", { login: initial.body })).status, 200, "An attacker must not log an existing user out by guessing passwords");
    const otherRole = await auth.createAuthUser({ fullName: "Separate Role Fixture", email: target.email, phone: "9000000004", password: fixture.admin.password, role: "super_admin" });
    await fixture.pool.query("UPDATE auth_users SET approval_status = 'APPROVED', is_active = true WHERE id = $1", [otherRole.id]);
    assert.equal((await signIn({ ...credentials, role: "super_admin" })).status, 200, "A separate registration role must not inherit another role's lockout");
    const restarted = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "-e", `
      const auth = require('./src/auth-store');
      (async()=>{if(await auth.getSecurityLimit(process.env.TEST_LIMIT_KEY,5)<=0)throw new Error('Lockout lost on restart');await auth.closeAuthStore()})().catch(e=>{console.error(e.message);process.exitCode=1});
    `], { env: { ...process.env, TEST_LIMIT_KEY: failureKey }, encoding: "utf8", timeout: 20000 });
    assert.equal(restarted.status, 0, restarted.stderr);
    await fixture.pool.query("UPDATE auth_security_limits SET expires_at = NOW() - INTERVAL '1 second' WHERE key = $1", [failureKey]);
    assert.equal((await signIn(credentials)).status, 200, "Expired lockouts must recover automatically");
    assert.equal(await auth.getSecurityLimit(failureKey, 1), 0, "Successful login clears failed attempts");
    const ip = "127.0.0.220";
    for (let i = 0; i < 8; i++) assert.equal((await signIn({ ...credentials, email: `missing${i}@example.test` }, { ip })).status, 404);
    const ipDenied = await signIn({ ...credentials, email: "missing9@example.test" }, { ip });
    assert.equal(ipDenied.status, 429); assert(Number(ipDenied.headers["retry-after"]) > 0);
    const ipKey = `login-ip:${sha256(ip)}`;
    assert.equal(await auth.getSecurityLimit(ipKey, 8) > 0, true);
    const reservations = await Promise.all(Array.from({ length: 12 }, () => auth.consumeSecurityLimit("parallel-fixture", 5, 900)));
    assert.equal(reservations.filter(result => result.allowed).length, 5, "Concurrent requests must not bypass the shared limit");
    console.log("Verified durable login lockout, expiry, role/email normalization, IP throttling and atomic concurrent reservations.");

    const adminResponse = await signIn(fixture.admin);
    assert.equal(adminResponse.status, 200);
    const admin = adminResponse.body;
    const deleteBody = { confirmed: true, currentPassword: fixture.admin.password, confirmationEmail: target.email };
    const deleteTarget = body => call(`/api/admin/registered-users/${target.id}`, { method: "DELETE", login: admin, body });
    assert.equal((await deleteTarget({})).status, 400);
    assert.equal((await deleteTarget({ confirmed: true })).status, 400);
    assert.equal((await deleteTarget({ ...deleteBody, confirmationEmail: "another@example.test" })).status, 400);
    const passKey = `admin-password:${admin.user.authUserId}`;
    await auth.clearSecurityLimit(passKey);
    for (let i = 0; i < 5; i++) {
      const denied = await deleteTarget({ ...deleteBody, currentPassword: "Wrong-Password-123!" });
      assert.equal(denied.status, i === 4 ? 429 : 403);
      assert.equal((await auth.findAuthUserByEmail(target.email, target.role)).approval_status, "APPROVED");
      assert(!JSON.stringify(denied.body).includes("Wrong-Password"));
    }
    assert.equal((await deleteTarget(deleteBody)).status, 429, "A valid password cannot bypass deletion verification lockout");
    await fixture.pool.query("UPDATE auth_security_limits SET expires_at = NOW() - INTERVAL '1 second' WHERE key = $1", [passKey]);
    assert.equal((await deleteTarget(deleteBody)).status, 200);
    assert.equal((await auth.findAuthUserByEmail(target.email, target.role)).approval_status, "DELETED");
    assert.equal(await auth.getSecurityLimit(passKey, 1), 0);
    const history = db.prepare("SELECT metadata FROM audit_logs WHERE action_type = 'Admin Password Verification Failed'").all();
    assert.equal(history.length, 5);
    assert(!JSON.stringify(history).includes("Password-123"));
    const actionKey = `admin-review:${admin.user.authUserId}`;
    await auth.clearSecurityLimit(actionKey);
    for (let i = 0; i < 20; i++) {
      const response = await call(`/api/admin/registered-users/${800000 + i}/approve`, { method: "POST", login: admin, body: { confirmed: true } });
      assert.equal(response.status, 404);
    }
    const rateDenied = await call("/api/admin/registered-users/900000/reject", { method: "POST", login: admin, body: { confirmed: true } });
    assert.equal(rateDenied.status, 429); assert(Number(rateDenied.headers["retry-after"]) > 0);
    console.log("Verified confirmations, delete password/email checks, failed-password cooldown, secret-free audit logs and shared admin limits across account IDs and actions.");

    const idle = await signIn({ ...fixture.admin, rememberMe: false });
    assert.equal(idle.status, 200);
    const payload = verifyJwt(idle.body.accessToken);
    await fixture.pool.query("UPDATE auth_sessions SET last_seen_at = NOW() - INTERVAL '31 minutes' WHERE session_key = $1", [payload.authSid]);
    db.prepare("DELETE FROM sessions").run();
    assert.equal((await call("/api/me", { login: idle.body })).status, 401);
    assert.equal((await call("/api/auth/refresh", { method: "POST", cookie: cookieOf(idle) })).status, 401, "Refresh cannot revive an idle session");
    const remembered = await signIn({ ...fixture.admin, rememberMe: true });
    assert.equal(remembered.status, 200);
    await fixture.pool.query("UPDATE auth_sessions SET last_seen_at = NOW() - INTERVAL '31 minutes' WHERE session_key = $1", [verifyJwt(remembered.body.accessToken).authSid]);
    assert.equal((await call("/api/auth/refresh", { method: "POST", cookie: cookieOf(remembered) })).status, 200, "Remembered sessions retain their explicit lifetime");
    const me = await call("/api/me", { login: remembered.body });
    assert.equal(me.headers["cache-control"], "no-store");
    assert.equal(me.headers["x-frame-options"], "DENY");
    const now = Math.floor(Date.now() / 1000);
    function crafted(header, claims) {
      const raw = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
      return `${raw}.${crypto.createHmac("sha256", jwtSecret).update(raw).digest("base64url")}`;
    }
    const claims = { sub: 1, iat: now, exp: now + 60 };
    assert(verifyJwt(signJwt({ sub: 1 })));
    assert.equal(verifyJwt(crafted({ alg: "none", typ: "JWT" }, claims)), null);
    assert.equal(verifyJwt(crafted({ alg: "HS512", typ: "JWT" }, claims)), null);
    assert.equal(verifyJwt(crafted({ alg: "HS256", typ: "JWT" }, { sub: 1, iat: now })), null);
    assert.equal(verifyJwt(crafted({ alg: "HS256", typ: "JWT" }, { ...claims, exp: now })), null);
    assert.equal(verifyJwt(crafted({ alg: "HS256", typ: "JWT" }, { ...claims, iat: now + 100, exp: now + 200 })), null);
    assert.equal(verifyJwt(signJwt({ sub: 1 }) + ".extra"), null);
    console.log("Auth protection tests passed: PostgreSQL-backed limits, password reauthentication, idle/refresh enforcement, strict JWT validation and uncached protected responses. Production accounts were not modified.");
  } finally {
    await auth.closeAuthStore(); db.close(); await fixture.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
