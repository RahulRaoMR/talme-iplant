const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
require("../src/load-env").loadLocalEnv();
process.env.DB_PATH = ":memory:";
process.env.DATABASE_URL = "";
process.env.TRUST_PROXY = "";
const bcrypt = require("bcrypt");
const fixture = { id: 1, full_name: "Location Fixture", email: "location@example.test", phone: "9000000000", role: "super_admin", is_active: true, approval_status: "APPROVED", password_hash: bcrypt.hashSync("Location-Test-123!", 12) };
const geo = require("geoip-lite");
geo.lookup = ip => ip === "8.8.8.8" ? { country: "IN", region: "KA", city: "Bengaluru", ll: [12.9716, 77.5946] }
  : ip === "1.1.1.1" ? { country: "GB", region: "ENG", city: "London", ll: [51.5074, -.1278] } : null;
const authStore = require("../src/auth-store");
const sessions = new Map();
authStore.hasPostgresAuth = () => true;
authStore.consumeSecurityLimit = async () => ({ allowed: true, attempts: 1, retryAfter: 60 });
authStore.clearSecurityLimit = async () => {};
authStore.findAuthUsersByEmail = async email => email === fixture.email ? [fixture] : [];
authStore.createAuthSession = async session => { sessions.set(session.sessionKey, { ...fixture, ...session, session_key: session.sessionKey, is_active: true, csrf_token: session.csrfToken }); };
authStore.findAuthSessionByKey = async key => sessions.get(key);
authStore.touchAuthSession = async () => {};
authStore.getRegisteredUserCounts = async () => null;
const { requestHandler } = require("../src/server");
const { db } = require("../src/db");

function call(url, { method = "GET", body, token, peer = "127.0.0.1", forwarded } = {}) {
  const text = body ? JSON.stringify(body) : "";
  const request = Readable.from(text ? [Buffer.from(text)] : []);
  Object.assign(request, { method, url, headers: { host: "localhost", "user-agent": "geo-api-test", "content-type": "application/json",
    "content-length": String(Buffer.byteLength(text)), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(forwarded ? { "x-forwarded-for": forwarded } : {}) }, socket: { remoteAddress: peer } });
  return new Promise((resolve, reject) => {
    const headers = {};
    const response = { statusCode: 200, setHeader(key, value) { headers[key] = value; }, getHeader(key) { return headers[key]; },
      writeHead(code) { this.statusCode = code; }, end(value) { resolve({ status: this.statusCode, body: JSON.parse(String(value)) }); } };
    requestHandler(request, response).catch(reject);
  });
}

(async () => {
  try {
    const body = { email: fixture.email, password: "Location-Test-123!", role: "super_admin" };
    let response = await call("/api/auth/login", { method: "POST", body, peer: "8.8.8.8", forwarded: "1.1.1.1" });
    assert.equal(response.status, 200);
    let row = db.prepare("SELECT * FROM login_history ORDER BY id DESC LIMIT 1").get();
    assert.equal(row.ip_address, "8.8.8.8");
    assert.equal(JSON.parse(row.location_json).location, "Bengaluru, India");
    response = await call("/api/auth/login", { method: "POST", body, peer: "::ffff:127.0.0.1", forwarded: "1.1.1.1" });
    assert.equal(response.status, 200);
    row = db.prepare("SELECT * FROM login_history ORDER BY id DESC LIMIT 1").get();
    assert.equal(row.ip_address, "127.0.0.1");
    assert.equal(JSON.parse(row.location_json).status, "local");
    process.env.TRUST_PROXY = "loopback";
    const proxied = await call("/api/auth/login", { method: "POST", body, forwarded: "8.8.8.8" });
    assert.equal(proxied.status, 200);
    assert.equal(JSON.parse(db.prepare("SELECT location_json FROM login_history ORDER BY id DESC LIMIT 1").get().location_json).city, "Bengaluru");
    response = await call("/api/auth/login", { method: "POST", body: { ...body, password: "Wrong-password-123!" }, peer: "1.1.1.1" });
    assert.equal(response.status, 401);
    row = db.prepare("SELECT * FROM login_history ORDER BY id DESC LIMIT 1").get();
    assert.equal(row.success, 0);
    assert.equal(JSON.parse(row.location_json).location, "London, United Kingdom");
    response = await call("/api/auth/login", { method: "POST", body, peer: "9.9.9.9", forwarded: "8.8.8.8" });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(db.prepare("SELECT location_json FROM login_history ORDER BY id DESC LIMIT 1").get().location_json).status, "unavailable");
    assert.equal((await call("/api/admin/security/live")).status, 401);
    const live = await call("/api/admin/security/live", { token: proxied.body.accessToken });
    assert.equal(live.status, 200);
    assert.equal(live.body.locationAvailable, true);
    assert.equal(live.body.locations[0].location, "Bengaluru, India");
    assert.equal(live.body.locations[0].logins, 2);
    assert.equal(live.body.locations[0].users, 1);
    assert.equal(live.body.locationSummary.localNetworkLogins, 1);
    assert.equal(live.body.locationSummary.unavailableLogins, 1);
    assert.equal(live.body.failedAttempts[0].location, "London, United Kingdom");
    assert(live.body.recentActivity.every(item => typeof item.location === "string"));
    console.log("IP location API tests passed: real login/failed-login capture, persistence, IPv6 normalization, local networks, trusted proxies, spoof rejection, provider misses, and protected monitoring responses.");
  } finally { db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
