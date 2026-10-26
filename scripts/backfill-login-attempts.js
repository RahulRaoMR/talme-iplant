const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");
const fs = require("node:fs");
const { resolveIpLocation } = require("../src/ip-location");

async function backfillLoginAttempts({ sqlitePath, pool, dryRun = false } = {}) {
  require("../src/load-env").loadLocalEnv();
  sqlitePath = sqlitePath || require("../src/config").dbPath;
  if (!fs.existsSync(sqlitePath)) throw new Error("The local login-history database does not exist.");
  const local = new DatabaseSync(sqlitePath, { readOnly: true });
  let rows;
  try {
    rows = local.prepare(`SELECT email,reason,ip_address,device,browser,timestamp,location_json
      FROM login_history WHERE success=0 AND action='Failed Login' ORDER BY id`).all();
  } finally { local.close(); }
  const records = rows.filter(row => Number.isFinite(Date.parse(row.timestamp))).map(row => {
    let location;
    try { location = JSON.parse(row.location_json); } catch { /* Resolve missing legacy snapshots from the recorded IP. */ }
    return { email: row.email, reason: row.reason, ip_address: row.ip_address, device: row.device, browser: row.browser,
      created_at: new Date(row.timestamp).toISOString(), location_json: location || resolveIpLocation(row.ip_address) };
  });
  const owned = !pool;
  if (owned) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required to preserve login attempts.");
    pool = new Pool({ connectionString: url, ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined });
  }
  let client;
  try {
    client = await pool.connect();
    if (!(await client.query("SELECT to_regclass('auth_login_attempts') IS NOT NULL AS ready")).rows[0].ready) {
      throw new Error("Apply the persistent_login_monitoring migration before importing failed attempts.");
    }
    const source = `FROM jsonb_to_recordset($1::jsonb) AS x(email text,reason text,ip_address text,device text,browser text,created_at timestamptz,location_json jsonb)
      WHERE NOT EXISTS(SELECT 1 FROM auth_login_attempts a
        WHERE LOWER(COALESCE(a.email,''))=LOWER(COALESCE(x.email,'')) AND a.created_at=x.created_at
          AND COALESCE(a.reason,'')=COALESCE(x.reason,'') AND COALESCE(a.ip_address,'')=COALESCE(x.ip_address,'')
          AND COALESCE(a.device,'')=COALESCE(x.device,'') AND COALESCE(a.browser,'')=COALESCE(x.browser,''))`;
    const payload = [JSON.stringify(records)];
    let count;
    if (dryRun) count = (await client.query(`SELECT COUNT(*)::int AS total ${source}`, payload)).rows[0].total;
    else {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('talme-login-attempt-backfill'))");
      const result = await client.query(`INSERT INTO auth_login_attempts(email,reason,ip_address,device,browser,created_at,location_json)
        SELECT x.email,x.reason,x.ip_address,x.device,x.browser,x.created_at,x.location_json ${source}`, payload);
      count = result.rowCount;
      await client.query("COMMIT");
    }
    return { dryRun, sourceRows: rows.length, imported: dryRun ? 0 : count, wouldImport: dryRun ? count : 0,
      alreadyStored: records.length - count, invalidDates: rows.length - records.length };
  } catch (error) {
    if (client && !dryRun) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release();
    if (owned) await pool.end();
  }
}

if (require.main === module) backfillLoginAttempts({ dryRun: process.argv.includes("--dry-run") })
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { backfillLoginAttempts };
