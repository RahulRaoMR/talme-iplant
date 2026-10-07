const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
require("../src/load-env").loadLocalEnv();
process.env.DB_PATH = ":memory:";
process.env.DATABASE_URL = "";
const authStore = require("../src/auth-store");
let registeredAccounts = null;
let registeredCountError = null;
authStore.getRegisteredUserCounts = async () => {
  if (registeredCountError) throw registeredCountError;
  return registeredAccounts === null ? null : {
    totalRegisteredUsers: registeredAccounts.length,
    totalActiveUsers: registeredAccounts.filter(user => user.status === "active").length
  };
};
authStore.listRegisteredUsers = async () => registeredAccounts;
const { requestHandler } = require("../src/server");
const { db, createUser, now } = require("../src/db");
const { signJwt } = require("../src/security");

function call(url, token) {
  const request = Readable.from([]);
  Object.assign(request, { method: "GET", url, headers: { host: "localhost", "user-agent": "admin-monitor-test", ...(token ? { authorization: `Bearer ${token}` } : {}) }, socket: { remoteAddress: "192.0.2.1" } });
  return new Promise((resolve, reject) => {
    const headers = {};
    const response = { statusCode: 200, setHeader(key, value) { headers[key] = value; }, getHeader(key) { return headers[key]; }, writeHead(code) { this.statusCode = code; }, end(text) { resolve({ status: this.statusCode, body: JSON.parse(String(text)) }); } };
    requestHandler(request, response).catch(reject);
  });
}

function session(role) {
  const userId = createUser({ name: role, email: `${role}@example.test`, password: "Test-password-123!", roleSlug: role });
  const sessionId = Number(db.prepare("INSERT INTO sessions(user_id,refresh_token_hash,csrf_token,expires_at,last_seen_at,created_at) VALUES (?,?,?,?,?,?)").run(userId, `test-${role}`, "csrf", new Date(Date.now() + 3600000).toISOString(), now(), now()).lastInsertRowid);
  return { userId, token: signJwt({ sub: userId, sid: sessionId }) };
}

(async () => {
  try {
    const admin = session("super_admin");
    const platform = session("platform_admin");
    const hr = session("hr_manager");
    const company = session("company_admin");
    const insert = db.prepare("INSERT INTO login_history(user_id,email,success,action,ip_address,device,browser,timestamp) VALUES (?,?,?,?,?,?,?,?)");
    for (const [action, success] of [["Login", 1], ["Logout", 1], ["Tab Closed Logout", 1], ["Failed Login", 0]]) insert.run(admin.userId, "super_admin@example.test", success, action, "192.0.2.1", "Windows", "Chrome", now());
    assert.equal((await call("/api/admin/security/live")).status, 401);
    for (const user of [hr, company]) {
      assert.equal((await call("/api/admin/security/live", user.token)).status, 403);
      assert.equal((await call("/api/admin/registered-devices", user.token)).status, 403);
    }
    for (const user of [admin, platform]) {
      const response = await call("/api/admin/security/live?days=7", user.token);
      assert.equal(response.status, 200);
      assert.equal(response.body.stats.totalLoggedInToday, 1);
      assert.equal(response.body.stats.totalLoggedOutToday, 2);
      assert.equal(response.body.stats.failedLoginAttempts, 1);
      assert.equal(response.body.recentActivity.length, 3);
      assert.equal(response.body.failedAttempts[0].attempts, 1);
      assert.equal(response.body.activity.length, 7);
      assert.equal(response.body.stats.totalRegisteredUsers, 4);
      assert.equal(response.body.locationAvailable, false);
      assert.equal((await call("/api/admin/security/live?days=30", user.token)).body.activity.length, 30);
      assert.equal((await call("/api/admin/security/live?days=999", user.token)).status, 400);
      assert.equal((await call("/api/admin/security/live?days=7%20OR%201%3D1", user.token)).status, 400);
    }
    assert.equal((await call("/api/admin/registered-users", admin.token)).body.items.length, 4);
    registeredAccounts = [
      { id: 101, name: "Registered Admin", email: "shared@example.test", roles: "super_admin", status: "active" },
      { id: 102, name: "Registered HR", email: "shared@example.test", roles: "hr_manager", status: "active" },
      { id: 103, name: "Disabled Account", email: "disabled@example.test", roles: "hr_manager", status: "inactive" }
    ];
    createUser({ name: "Imported Employee", email: "imported@example.test", password: "Import-test-123!", roleSlug: "employee" });
    for (const user of [admin, platform]) {
      const live = await call("/api/admin/security/live", user.token);
      assert.equal(live.status, 200);
      assert.equal(live.body.stats.totalRegisteredUsers, 3, "Use all role-specific registrations, not local imported accounts or unique emails.");
      assert.equal(live.body.stats.totalActiveUsers, 2, "Enabled registration count excludes inactive auth accounts.");
    }
    const registered = await call("/api/admin/registered-users", admin.token);
    assert.equal(registered.status, 200);
    assert.deepEqual(registered.body.items, registeredAccounts);
    assert.equal((await call("/api/admin/registered-users")).status, 401);
    for (const user of [hr, company, platform]) assert.equal((await call("/api/admin/registered-users", user.token)).status, 403);
    registeredAccounts = [];
    const empty = await call("/api/admin/security/live", admin.token);
    assert.equal(empty.body.stats.totalRegisteredUsers, 0, "A real zero must not fall back to imported users.");
    assert.equal(empty.body.stats.totalActiveUsers, 0);
    assert.deepEqual((await call("/api/admin/registered-users", admin.token)).body.items, []);
    registeredCountError = Object.assign(new Error("Authentication database unavailable"), { statusCode: 503, expose: true });
    assert.equal((await call("/api/admin/security/live", admin.token)).status, 503, "Do not use misleading local totals when the auth database fails.");
    console.log("Admin monitoring API tests passed: admin/platform access, permission denial, local and registered-account statistics, account list, zero counts, database failure, history, and ranges.");
  } finally { db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
