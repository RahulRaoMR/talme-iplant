const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { adminActivity, adminTodayStats, adminDeviceStats, monitoringRange } = require("../src/admin-monitor");
const { getDeviceType, getDeviceName } = require("../src/security");
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, email TEXT);
  CREATE TABLE login_history(id INTEGER PRIMARY KEY, user_id INTEGER, email TEXT, action TEXT,
    success INTEGER, device TEXT, browser TEXT, ip_address TEXT, timestamp TEXT, location_json TEXT);
  CREATE TABLE devices(id INTEGER PRIMARY KEY, device TEXT, user_agent TEXT);
  CREATE TABLE sessions(id INTEGER PRIMARY KEY, device_id INTEGER, user_agent TEXT, revoked_at TEXT, expires_at TEXT);`);
try {
  const at = new Date("2026-10-06T18:45:00Z");
  const range = monitoringRange(1, at);
  assert.equal(range.start.toISOString(), "2026-10-06T18:30:00.000Z");
  assert.equal(range.end.toISOString(), "2026-10-07T18:30:00.000Z");
  assert.equal(range.startDate, "2026-10-07");
  assert.equal(range.endDate, "2026-10-07");
  assert.equal(range.timezone, "Asia/Kolkata");
  assert.deepEqual(adminTodayStats(db, at), { totalLoggedInToday: 0, totalLoggedOutToday: 0, failedLoginAttempts: 0 });
  const insert = db.prepare("INSERT INTO login_history(action,success,timestamp) VALUES(?,?,?)");
  insert.run("Login", 1, "2026-10-06T18:29:59.999Z");
  insert.run("Login", 1, "2026-10-06T18:30:00.000Z");
  insert.run("Registration Login", 1, "2026-10-06T18:40:00.000Z");
  insert.run("google Login", 1, "2026-10-07T01:00:00.000Z");
  insert.run("Logout", 1, "2026-10-06T18:41:00.000Z");
  insert.run("Logout from All Devices", 1, "2026-10-07T17:00:00.000Z");
  insert.run("Tab Closed Logout", 1, "2026-10-07T18:29:59.999Z");
  insert.run("Failed Login", 0, "2026-10-07T01:30:00.000Z");
  insert.run("Failed Login", 0, "2026-10-07T18:30:00.000Z");
  insert.run("Password Reset", 0, "2026-10-07T01:40:00.000Z");
  insert.run("Login", 1, "2026-10-07T18:30:00.000Z");
  const expected = { totalLoggedInToday: 3, totalLoggedOutToday: 3, failedLoginAttempts: 1 };
  assert.deepEqual(adminTodayStats(db, at), expected);
  assert.deepEqual(adminTodayStats(db, new Date("2026-10-07T12:00:00Z")), expected);
  const chart = adminActivity(db, 1, at);
  assert.deepEqual(chart.activity, [{ date: "2026-10-07", logins: 3, logouts: 3 }]);
  assert.equal(chart.failedAttempts.length, 1);
  assert.equal(chart.failedAttempts[0].attempts, 1);
  assert.deepEqual(chart.range, { days: 1, start: "2026-10-07", end: "2026-10-07", timezone: "Asia/Kolkata" });
  const agents = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0", "desktop"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0 Mobile Safari/537.36", "mobile"],
    ["Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/120.0 Safari/537.36", "tablet"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1", "tablet"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148", "mobile"],
    ["Unknown client", "other"]
  ];
  for (const [ua, type] of agents) assert.equal(getDeviceType(ua), type);
  assert.equal(getDeviceName(agents[2][0]), "Android Tablet");
  assert.equal(getDeviceName(agents[3][0]), "iPad");
  const device = db.prepare("INSERT INTO devices(id,device,user_agent) VALUES(?,?,?)");
  const session = db.prepare("INSERT INTO sessions(device_id,expires_at,revoked_at) VALUES(?,?,?)");
  agents.forEach(([ua], index) => { device.run(index + 1, getDeviceName(ua), ua); session.run(index + 1, "2026-10-08T00:00:00Z", null); });
  session.run(3, "2026-10-08T00:00:00Z", null);
  session.run(3, "2026-10-06T00:00:00Z", null);
  session.run(4, "2026-10-08T00:00:00Z", "2026-10-06T18:40:00Z");
  assert.deepEqual(adminDeviceStats(db, at), { activeDevices: 6, desktopDevices: 1, mobileDevices: 2, tabletDevices: 2 });
  db.prepare("UPDATE sessions SET revoked_at=? WHERE device_id IN (3,4)").run(at.toISOString());
  assert.equal(adminDeviceStats(db, at).tabletDevices, 0);
  console.log("Admin counter tests passed: IST midnight boundaries, daily chart alignment, login variants, logout variants, failure classification, phone/tablet distinction, distinct devices and expired/revoked sessions.");
} finally { db.close(); }
