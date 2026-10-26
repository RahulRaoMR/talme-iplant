const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createAuthTestDatabase } = require("./auth-test-database");
const { backfillLoginAttempts } = require("./backfill-login-attempts");

(async () => {
  const fixture = await createAuthTestDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "talme-failed-logins-"));
  const sqlitePath = path.join(directory, "history.sqlite");
  try {
    const local = new DatabaseSync(sqlitePath);
    const timestamp = new Date(Date.now() - 60000).toISOString();
    const location = { location: "Bengaluru, India", status: "resolved", city: "Bengaluru", countryCode: "IN" };
    try {
      local.exec(`CREATE TABLE login_history(id INTEGER PRIMARY KEY,email TEXT,reason TEXT,ip_address TEXT,
        device TEXT,browser TEXT,timestamp TEXT,location_json TEXT,success INTEGER,action TEXT)`);
      const insert = local.prepare("INSERT INTO login_history(email,reason,ip_address,device,browser,timestamp,location_json,success,action) VALUES(?,?,?,?,?,?,?,?,?)");
      insert.run("legacy@example.test", "Incorrect password", "8.8.8.8", "Windows", "Chrome", timestamp, JSON.stringify(location), 0, "Failed Login");
      insert.run("already@example.test", "Incorrect password", "1.1.1.1", "Android", "Chrome", timestamp, null, 0, "Failed Login");
      insert.run("invalid@example.test", "Incorrect password", "127.0.0.1", "Windows", "Chrome", "invalid", null, 0, "Failed Login");
      insert.run("success@example.test", null, "127.0.0.1", "Windows", "Chrome", timestamp, null, 1, "Login");
      insert.run("other@example.test", null, "127.0.0.1", "Windows", "Chrome", timestamp, null, 0, "Other Event");
    } finally { local.close(); }
    await fixture.pool.query(`INSERT INTO auth_login_attempts(email,reason,ip_address,device,browser,created_at)
      VALUES('ALREADY@example.test','Incorrect password','1.1.1.1','Android','Chrome',$1)`, [timestamp]);
    const options = { sqlitePath, pool: fixture.pool };
    assert.deepEqual(await backfillLoginAttempts({ ...options, dryRun: true }),
      { dryRun: true, sourceRows: 3, imported: 0, wouldImport: 1, alreadyStored: 1, invalidDates: 1 });
    assert.equal((await fixture.pool.query("SELECT COUNT(*)::int AS total FROM auth_login_attempts")).rows[0].total, 1);
    assert.equal((await backfillLoginAttempts(options)).imported, 1);
    assert.equal((await backfillLoginAttempts(options)).imported, 0, "Repeated recovery must not duplicate existing attempts");
    assert.equal((await backfillLoginAttempts({ ...options, dryRun: true })).wouldImport, 0);
    const rows = (await fixture.pool.query("SELECT * FROM auth_login_attempts ORDER BY id")).rows;
    assert.equal(rows.length, 2);
    const imported = rows.find(row => row.email === "legacy@example.test");
    assert.equal(imported.created_at.toISOString(), timestamp);
    assert.equal(imported.ip_address, "8.8.8.8");
    assert.equal(imported.reason, "Incorrect password");
    assert.deepEqual(imported.location_json, location);
    assert.equal(imported.role, null, "Legacy recovery must not invent an account role");
    console.log("Passed: failed-login recovery preserves timestamps, IPs and locations; excludes successes and invalid dates; supports dry runs; and skips existing attempts without duplicates.");
  } finally {
    fs.unlinkSync(sqlitePath);
    fs.rmdirSync(directory);
    await fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
