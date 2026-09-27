const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { loadLocalEnv } = require("../src/load-env");

loadLocalEnv();

const tableOrder = [
  "Candidate",
  "auth_users",
  "auth_sessions",
  "auth_password_otps",
  "employee_record_audits",
  "hr_employee_imports",
  "hr_employee_records"
];

const importPath = path.resolve(process.argv[2] || path.join(__dirname, "..", "tmp", "production-db-export.json"));
const targetUrl = process.env.TARGET_DATABASE_URL || process.env.AWS_DATABASE_URL;
const apply = process.argv.includes("--apply");

function requireTargetUrl() {
  if (!targetUrl) {
    throw new Error("TARGET_DATABASE_URL or AWS_DATABASE_URL is required.");
  }
  if (/neon\.tech/i.test(targetUrl)) {
    throw new Error("Refusing to import into a Neon host. Set TARGET_DATABASE_URL to the AWS RDS/test PostgreSQL target.");
  }
}

function poolFor(url) {
  return new Pool({
    connectionString: url,
    ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
  });
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function tableExists(client, table) {
  const result = await client.query("SELECT to_regclass($1) AS name", [`public.${table}`]);
  return Boolean(result.rows[0]?.name);
}

async function targetColumns(client, table) {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return result.rows.map(row => row.column_name);
}

function upsertSql(table, columns, primaryKey) {
  const quotedColumns = columns.map(quoteIdent);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const conflict = primaryKey.map(quoteIdent).join(", ");
  const updates = columns
    .filter(column => !primaryKey.includes(column))
    .map(column => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`);
  const updateClause = updates.length ? `DO UPDATE SET ${updates.join(", ")}` : "DO NOTHING";
  return `
    INSERT INTO ${quoteIdent(table)} (${quotedColumns.join(", ")})
    VALUES (${placeholders.join(", ")})
    ON CONFLICT (${conflict}) ${updateClause}
  `;
}

async function resetSequence(client, table, primaryKey) {
  if (primaryKey.length !== 1) return;
  const column = primaryKey[0];
  const sequenceResult = await client.query("SELECT pg_get_serial_sequence($1, $2) AS sequence_name", [`public.${table}`, column]);
  const sequenceName = sequenceResult.rows[0]?.sequence_name;
  if (!sequenceName) return;
  await client.query(
    `SELECT setval($1, COALESCE((SELECT MAX(${quoteIdent(column)}) FROM ${quoteIdent(table)}), 1), true)`,
    [sequenceName]
  );
}

async function importTable(client, table, payload) {
  if (!payload?.exists) return { table, skipped: true, reason: "not present in export" };
  if (!await tableExists(client, table)) {
    throw new Error(`Target table is missing: ${table}. Prepare schema before importing.`);
  }
  if (!payload.primaryKey?.length) {
    throw new Error(`No primary key metadata for ${table}; idempotent import requires a primary key.`);
  }

  const availableColumns = new Set(await targetColumns(client, table));
  const exportColumns = payload.columns.map(column => column.column_name);
  const columns = exportColumns.filter(column => availableColumns.has(column));
  const sql = upsertSql(table, columns, payload.primaryKey);
  let imported = 0;

  for (const row of payload.rows || []) {
    const values = columns.map(column => row[column]);
    await client.query(sql, values);
    imported += 1;
  }

  await resetSequence(client, table, payload.primaryKey);
  return { table, imported };
}

async function main() {
  requireTargetUrl();
  if (!fs.existsSync(importPath)) throw new Error(`Export file not found: ${importPath}`);
  const payload = JSON.parse(fs.readFileSync(importPath, "utf8"));
  const pool = poolFor(targetUrl);
  const report = { mode: apply ? "apply" : "dry-run", importPath, tables: [] };

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const table of tableOrder) {
        report.tables.push(await importTable(client, table, payload.tables?.[table]));
      }
      if (apply) {
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify(report, null, 2));
  if (!apply) console.log("Dry run complete. Re-run with --apply only against a verified AWS/test target.");
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
