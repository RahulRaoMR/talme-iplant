const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
require("../src/load-env").loadLocalEnv();
process.env.DB_PATH = ":memory:";
process.env.DATABASE_URL = "";
process.env.TRUST_PROXY = "";
const bcrypt = require("bcrypt");
const fixture = { id: 1, full_name: "Counter Fixture", email: "counter@example.test", phone: "9000000000", role: "super_admin", is_active: true, approval_status: "APPROVED", password_hash: bcrypt.hashSync("Counter-Test-123!", 12) };
const auth = require("../src/auth-store");
const sessions = new Map();
auth.hasPostgresAuth = () => true;
auth.consumeSecurityLimit = async () => ({ allowed: true, attempts: 1, retryAfter: 60 });
auth.clearSecurityLimit = async () => {};
auth.findAuthUsersByEmail = async email => email === fixture.email ? [fixture] : [];
auth.createAuthSession = async input => {
  for (const item of sessions.values()) if (item.email === input.email && item.userAgent === input.userAgent) item.is_active = false;
  sessions.set(input.sessionKey, { ...fixture, ...input, session_key: input.sessionKey, is_active: true, csrf_token: input.csrfToken });
};
auth.findAuthSessionByKey = async key => sessions.get(key)?.is_active ? sessions.get(key) : null;
auth.touchAuthSession = async () => {};
auth.revokeAuthSessionByKey = async key => { if (sessions.has(key)) sessions.get(key).is_active = false; };
auth.revokeAuthSessionsByEmail = async email => { for (const item of sessions.values()) if (item.email === email) item.is_active = false; };
auth.getRegisteredUserCounts = async () => ({ totalRegisteredUsers: 1, totalActiveUsers: 1 });
const { requestHandler } = require("../src/server");
const { db } = require("../src/db");
function call(url, { method = "GET", body, login, ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0" } = {}) {
  const text = body ? JSON.stringify(body) : "";
  const request = Readable.from(text ? [Buffer.from(text)] : []);
  const peer = /iPad/.test(ua) ? "127.0.0.4" : /Android/.test(ua) ? /Mobile/.test(ua) ? "127.0.0.2" : "127.0.0.3" : "127.0.0.1";
  Object.assign(request, { method, url, headers: { host: "localhost", "content-type": "application/json", "user-agent": ua,
    "content-length": String(Buffer.byteLength(text)), ...(login ? { authorization: `Bearer ${login.accessToken}`, "x-csrf-token": login.csrfToken } : {}) }, socket: { remoteAddress: peer } });
  return new Promise((resolve, reject) => {
    const headers = {};
    const response = { statusCode: 200, setHeader(k, v) { headers[k] = v; }, getHeader(k) { return headers[k]; },
      writeHead(code) { this.statusCode = code; }, end(value) { resolve({ status: this.statusCode, body: JSON.parse(String(value)) }); } };
    requestHandler(request, response).catch(reject);
  });
}
const body = { email: fixture.email, password: "Counter-Test-123!", role: fixture.role };
async function signIn(ua) {
  const result = await call("/api/auth/login", { method: "POST", body, ua });
  assert.equal(result.status, 200); return result.body;
}
async function live(login) {
  const result = await call("/api/admin/security/live?days=1", { login });
  assert.equal(result.status, 200); return result.body;
}
(async () => {
  try {
    assert.equal((await call("/api/admin/security/live")).status, 401);
    assert.equal((await call("/api/auth/login", { method: "POST", body: { ...body, password: "" } })).status, 400);
    assert.equal((await call("/api/auth/login", { method: "POST", body: { ...body, role: "" } })).status, 400);
    assert.equal((await call("/api/auth/login", { method: "POST", body: { ...body, password: "Incorrect-password" } })).status, 401);
    let admin = await signIn();
    await signIn("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0 Mobile Safari/537.36");
    const tabletUa = "Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/120.0 Safari/537.36";
    await signIn(tabletUa);
    const ipadUa = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1";
    await signIn(ipadUa);
    const ipad = await signIn(ipadUa);
    let result = await live(admin);
    assert.equal(result.stats.totalLoggedInToday, 5);
    assert.equal(result.stats.totalLoggedOutToday, 0);
    assert.equal(result.stats.failedLoginAttempts, 3);
    assert.equal(result.stats.activeDevices, 4);
    assert.equal(result.stats.tabletDevices, 2);
    assert.equal(result.stats.mobileDevices, 1);
    assert.equal(result.stats.desktopDevices, 1);
    assert.equal(result.range.timezone, "Asia/Kolkata");
    assert.equal(result.activity[0].logins, 5);
    assert.equal((await call("/api/auth/logout", { method: "POST", login: ipad })).status, 200);
    assert.equal((await call("/api/auth/logout", { method: "POST", login: ipad })).status, 401);
    result = await live(admin);
    assert.equal(result.stats.totalLoggedOutToday, 1); assert.equal(result.stats.tabletDevices, 1);
    assert.equal((await call("/api/auth/logout-all", { method: "POST", login: admin })).status, 200);
    assert.equal((await call("/api/auth/logout-all", { method: "POST", login: admin })).status, 401);
    admin = await signIn();
    result = await live(admin);
    assert.equal(result.stats.totalLoggedInToday, 6); assert.equal(result.stats.totalLoggedOutToday, 2);
    assert.equal(result.stats.activeDevices, 1); assert.equal(result.stats.tabletDevices, 0);
    const closing = await signIn(tabletUa);
    for (let i = 0; i < 2; i++) assert.equal((await call("/api/auth/tab-close", { method: "POST", body: { accessToken: closing.accessToken }, ua: tabletUa })).status, 200);
    result = await live(admin);
    assert.equal(result.stats.totalLoggedInToday, 7); assert.equal(result.stats.totalLoggedOutToday, 3);
    assert.equal(result.stats.failedLoginAttempts, 3); assert.equal(result.stats.tabletDevices, 0);
    assert.equal(result.activity[0].logins, 7); assert.equal(result.activity[0].logouts, 3);
    assert.equal(result.recentActivity.filter(row => row.action === "Logout from All Devices").length, 1);
    console.log("Admin counter auth tests passed: actual login, failed validation/password attempts, mobile/iPad/Android tablet sessions, duplicate-device logins, logout, logout-all, tab-close, replay protection and live metric/chart updates.");
  } finally { db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
