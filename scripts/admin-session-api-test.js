const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createAuthTestDatabase } = require("./auth-test-database");

(async () => {
  const fixture = await createAuthTestDatabase();
  const geo = require("geoip-lite");
  geo.lookup = ip => ip === "8.8.8.8" ? { country: "IN", city: "Bengaluru", region: "KA", ll: [12.97,77.59] }
    : ip === "1.1.1.1" ? { country: "GB", city: "London", region: "ENG", ll: [51.5,-.12] } : null;
  const { requestHandler } = require("../src/server");
  const { db } = require("../src/db");
  const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0";
  const android = "Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";
  const ipad = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1";
  function call(url, { method = "GET", body, session, ip = "8.8.8.8", agent = windows } = {}) {
    const text = body ? JSON.stringify(body) : "";
    const request = Readable.from(text ? [text] : []);
    Object.assign(request, { method, url, headers: { host: "localhost", "content-type": "application/json", "user-agent": agent,
      "content-length": Buffer.byteLength(text), ...(session ? { authorization: `Bearer ${session.accessToken}`, "x-csrf-token": session.csrfToken } : {}) }, socket: { remoteAddress: ip } });
    return new Promise((resolve, reject) => {
      const headers = {};
      const response = { statusCode: 200, setHeader(key,value) { headers[key] = value; }, getHeader(key) { return headers[key]; },
        writeHead(code) { this.statusCode = code; }, end(value) { resolve({ status: this.statusCode, body: JSON.parse(String(value)) }); } };
      requestHandler(request,response).catch(reject);
    });
  }
  async function login(email, role, options = {}) {
    const response = await call("/api/auth/login", { method: "POST", body: { email, role, password: fixture.admin.password }, ...options });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  }
  async function monitor(session, query = {}) {
    const response = await call(`/api/admin/security/live?${new URLSearchParams(query)}`, { session });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  }
  try {
    for (const role of ["hr_manager", "candidate", "platform_admin"]) {
      await fixture.pool.query(`INSERT INTO auth_users(full_name,email,phone,password_hash,role,is_active,approval_status)
        SELECT $1,$2,$3,password_hash,$4,true,'APPROVED' FROM auth_users WHERE email=$5`,
      [`Member ${role}`, role === "platform_admin" ? "inspector@example.test" : "member@example.test", role === "platform_admin" ? "9000000004" : "9000000003", role, fixture.admin.email]);
    }
    const admin = await login(fixture.admin.email, "super_admin");
    const desktop = await login("member@example.test", "hr_manager");
    const mobile = await login("member@example.test", "hr_manager", { agent: android, ip: "1.1.1.1" });
    const tablet = await login("member@example.test", "candidate", { agent: ipad, ip: "9.9.9.9" });
    assert.equal((await call("/api/me", { session: desktop })).status, 200, "A second device must not revoke the first device");
    assert.equal((await call("/api/me", { session: mobile })).status, 200);
    assert.equal((await call("/api/admin/security/live", { session: desktop })).status, 403);
    assert.equal((await call("/api/admin/security/live")).status, 401);
    const initial = await monitor(admin);
    assert.equal(initial.source, "persistent-auth-sessions");
    assert.equal(initial.stats.totalLoggedInToday, 4);
    assert.equal(initial.stats.desktopDevices, 2);
    assert.equal(initial.stats.mobileDevices, 1);
    assert.equal(initial.stats.tabletDevices, 1);
    assert.equal(initial.activityPagination.total, 4);
    assert.equal(initial.sessionDetails.filter(row => row.email === "member@example.test").length, 3);
    assert(initial.sessionDetails.some(row => row.location === "London, United Kingdom" && row.device === "Android"));
    console.log("Passed: all members, role-specific registrations, simultaneous devices, platform metrics, locations, and permissions.");
    const logout = await call("/api/auth/logout", { method: "POST", session: mobile, agent: android, ip: "1.1.1.1" });
    assert.equal(logout.status, 200);
    assert.equal((await call("/api/me", { session: mobile })).status, 401);
    assert.equal((await call("/api/me", { session: desktop })).status, 200);
    const failed = await call("/api/auth/login", { method: "POST", body: { email: "member@example.test", role: "hr_manager", password: "Wrong-password-123!" }, ip: "8.8.4.4" });
    assert.equal(failed.status, 401);
    assert.equal((await fixture.pool.query("SELECT created_at FROM auth_login_attempts ORDER BY id DESC LIMIT 1")).rows[0].created_at.toISOString(),
      db.prepare("SELECT timestamp FROM login_history WHERE success=0 ORDER BY id DESC LIMIT 1").get().timestamp,
      "Local and shared history must use the same timestamp so recovery can skip existing events");
    // An empty local cache models a different worker or a serverless cold start.
    db.prepare("DELETE FROM sessions").run();
    db.prepare("DELETE FROM devices").run();
    db.prepare("DELETE FROM login_history").run();
    const restored = await monitor(admin);
    const mobileHistory = restored.sessionDetails.find(row => row.device === "Android");
    assert.equal(mobileHistory.session_status, "Logged out");
    assert(mobileHistory.created_at && mobileHistory.revoked_at);
    assert.equal(mobileHistory.logout_reason, "Logout");
    assert.equal(restored.stats.totalLoggedOutToday, 1);
    assert.equal(restored.stats.failedLoginAttempts, 1);
    assert.equal(restored.failedAttempts[0].email, "member@example.test");
    const devices = await call("/api/admin/registered-devices", { session: admin });
    assert.equal(devices.status, 200);
    assert.equal(devices.body.items.length, 4);
    const closed = await call("/api/auth/tab-close", { method: "POST", body: { accessToken: desktop.accessToken } });
    assert.equal(closed.status, 200); assert.equal(closed.body.message, "Session closed");
    assert.equal((await call("/api/me", { session: desktop })).status, 401);
    assert.equal((await call("/api/me", { session: tablet })).status, 200);
    console.log("Passed: independent logout, failed login persistence, cold-start history/devices, and cross-worker tab-close logout.");
    await fixture.pool.query(`INSERT INTO auth_sessions(session_key,email,role,refresh_token_hash,csrf_token,expires_at,last_seen_at,created_at,revoked_at,logout_reason,ip_address,user_agent)
      SELECT 'history-'||n,'history-'||n||'@example.test','employee','history-hash-'||n,'fixture',NOW()+INTERVAL '1 day',NOW(),NOW()-INTERVAL '1 minute',NOW(),'Logout','8.8.8.8',$1
      FROM generate_series(1,120) n`, [windows]);
    await fixture.pool.query(`INSERT INTO auth_sessions(session_key,email,role,refresh_token_hash,csrf_token,expires_at,last_seen_at,created_at)
      VALUES('expired-fixture','expired@example.test','employee','expired-hash','fixture',NOW()+INTERVAL '1 day',NOW()-INTERVAL '1 hour',NOW()-INTERVAL '2 hours')`);
    const pages = [];
    for (let page = 1; page <= 3; page++) pages.push(await monitor(admin, { page: String(page), limit: "50" }));
    assert.equal(pages[0].activityPagination.total, 125);
    assert.equal(pages[0].sessionDetails.length, 50);
    assert.equal(pages[2].sessionDetails.length, 25);
    assert.equal(new Set(pages.flatMap(page => page.sessionDetails.map(row => row.session_id))).size, 125);
    const london = await monitor(admin, { search: "London" });
    assert.equal(london.activityPagination.total, 1);
    assert.equal(london.sessionDetails[0].device, "Android");
    const expired = await monitor(admin, { search: "expired@example.test" });
    assert.equal(expired.sessionDetails[0].session_status, "Expired");
    assert.equal(expired.sessionDetails[0].revoked_at, null);
    assert(expired.sessionDetails[0].expired_at);
    for (const key of ["session_key", "refresh_token_hash", "csrf_token", "password_hash"]) assert(!JSON.stringify(pages).includes(`"${key}"`));
    assert.equal((await call("/api/admin/security/live?days=999", { session: admin })).status, 400);
    const inspector = await login("inspector@example.test", "platform_admin", { ip: "8.8.4.4" });
    const secondAdmin = await login(fixture.admin.email, "super_admin", { agent: android, ip: "1.0.0.1" });
    assert.equal((await call("/api/auth/logout-all", { method: "POST", session: admin })).status, 200);
    assert.equal((await call("/api/me", { session: secondAdmin })).status, 401);
    const final = await monitor(inspector, { search: fixture.admin.email });
    assert.equal(final.sessionDetails.length, 2);
    assert(final.sessionDetails.every(row => row.revoked_at && row.logout_reason === "Logout from All Devices"));
    console.log("Passed: 125 sessions across pages, location search, expiry status, no credential exposure, date ranges, and logout from all devices.");
    const blockedIp = "8.8.4.5";
    await fixture.pool.query("INSERT INTO auth_security_limits(key,attempts,expires_at) VALUES($1,8,NOW()+INTERVAL '5 minutes')",
      [`login-ip:${require("../src/security").sha256(blockedIp)}`]);
    const blocked = await call("/api/auth/login", { method: "POST", ip: blockedIp,
      body: { email: "blocked@example.test", role: "hr_manager", password: "Wrong-password-123!" } });
    assert.equal(blocked.status, 429);
    db.prepare("DELETE FROM login_history").run();
    const withBlocked = await monitor(inspector);
    assert.equal(withBlocked.stats.failedLoginAttempts, 2);
    assert(withBlocked.failedAttempts.some(row => row.email === "blocked@example.test" && row.ip_address === blockedIp && row.attempts === 1));
    assert.equal((await fixture.pool.query("SELECT reason FROM auth_login_attempts WHERE ip_address=$1", [blockedIp])).rows[0].reason,
      "Too many login attempts from this IP");
    console.log("Passed: IP-throttled failed attempts are recorded and remain visible without local login history.");
  } finally {
    await require("../src/auth-store").closeAuthStore();
    await require("../src/employee-store").closeEmployeeStore();
    db.close();
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
