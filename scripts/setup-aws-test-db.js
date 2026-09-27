const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { loadLocalEnv } = require("../src/load-env");

loadLocalEnv();

const schemaPath = path.join(__dirname, "aws-rds-schema.sql");
const targetUrl = process.env.AWS_DATABASE_URL || process.env.TARGET_DATABASE_URL;
const apply = process.argv.includes("--apply");
const requiredTables = [
  "Candidate",
  "auth_users",
  "auth_sessions",
  "auth_password_otps",
  "employee_record_audits",
  "hr_employee_imports",
  "hr_employee_records"
];

function requireTargetUrl() {
  if (!targetUrl) {
    throw new Error("AWS_DATABASE_URL or TARGET_DATABASE_URL is required for AWS test schema setup.");
  }
  if (/neon\.tech/i.test(targetUrl)) {
    throw new Error("Refusing to run AWS test schema setup against a Neon host.");
  }
}

function poolFor(url) {
  return new Pool({
    connectionString: url,
    ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
  });
}

async function verifySchema(client) {
  const tableResult = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  const tables = tableResult.rows.map(row => row.table_name);

  const indexResult = await client.query(
    `SELECT tablename, indexname
     FROM pg_indexes
     WHERE schemaname = 'public'
     ORDER BY tablename, indexname`
  );

  const constraintResult = await client.query(
    `SELECT tc.table_name, tc.constraint_name, tc.constraint_type
     FROM information_schema.table_constraints tc
     WHERE tc.table_schema = 'public'
     ORDER BY tc.table_name, tc.constraint_name`
  );

  const existingRequiredTables = requiredTables.filter(table => tables.includes(table));
  const countResult = existingRequiredTables.length
    ? await client.query(
        existingRequiredTables
          .map((table, index) => `SELECT $${index + 1}::text AS table_name, COUNT(*)::bigint AS row_count FROM "${table}"`)
          .join(" UNION ALL "),
        existingRequiredTables
      )
    : { rows: [] };

  return {
    tables,
    requiredTablesPresent: requiredTables.every(table => tables.includes(table)),
    rowCounts: Object.fromEntries(countResult.rows.map(row => [row.table_name, Number(row.row_count)])),
    indexes: indexResult.rows,
    constraints: constraintResult.rows
  };
}

async function main() {
  requireTargetUrl();
  if (!fs.existsSync(schemaPath)) throw new Error(`Schema file not found: ${schemaPath}`);
  const pool = poolFor(targetUrl);
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (apply) {
        await client.query(fs.readFileSync(schemaPath, "utf8"));
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
      }
      const report = await verifySchema(client);
      console.log(JSON.stringify({
        mode: apply ? "apply" : "verify-only",
        applied: apply,
        ...report
      }, null, 2));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
