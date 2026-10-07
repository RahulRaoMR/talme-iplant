const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

async function createAuthTestDatabase() {
  require("../src/load-env").loadLocalEnv();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for isolated authentication tests.");
  const originalUrl = process.env.DATABASE_URL;
  const schema = `auth_test_${crypto.randomBytes(8).toString("hex")}`;
  const config = url => ({ connectionString: url, ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined });
  const control = new Pool(config(originalUrl));
  let pool;
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(originalUrl);
    url.searchParams.set("options", `-c search_path=${schema} -c statement_timeout=15000 -c lock_timeout=5000`);
    process.env.DATABASE_URL = url.toString();
    process.env.DB_PATH = ":memory:";
    pool = new Pool(config(process.env.DATABASE_URL));
    const migration = name => fs.readFileSync(path.join(__dirname, "../backend/prisma/migrations", name, "migration.sql"), "utf8");
    for (const name of ["20260806103000_create_auth_users", "20260807103000_create_auth_password_otps", "20260810120000_add_auth_password_otp_attempt_count", "20260811100000_create_auth_sessions", "20260812110000_allow_auth_email_per_role"]) await pool.query(migration(name));
    const admin = { email: "approval-admin@example.test", password: "Approval-Test-123!", role: "super_admin" };
    await pool.query(`INSERT INTO auth_users (full_name,email,phone,password_hash,role,is_active)
      VALUES ('Approval Admin',$1,'9000000000',$2,'super_admin',true),
      ('Inactive Fixture','inactive@example.test','9000000001',$2,'hr_manager',false)`, [admin.email, await bcrypt.hash(admin.password, 12)]);
    await pool.query(migration("20261007120000_registration_approval"));
    await pool.query(migration("20261007130000_auth_security_limits"));
    return { pool, admin, async close() {
      await pool.end();
      await control.query(`DROP SCHEMA "${schema}" CASCADE`);
      await control.end();
      process.env.DATABASE_URL = originalUrl;
    } };
  } catch (error) {
    if (pool) await pool.end();
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await control.end();
    process.env.DATABASE_URL = originalUrl;
    throw error;
  }
}

module.exports = { createAuthTestDatabase };
