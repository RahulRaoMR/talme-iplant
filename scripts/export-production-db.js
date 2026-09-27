const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
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

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const outputPath = path.resolve(process.argv[2] || path.join(__dirname, "..", "tmp", "production-db-export.json"));

function requireSourceUrl() {
  if (!sourceUrl) {
    throw new Error("SOURCE_DATABASE_URL is required for read-only export. DATABASE_URL is intentionally not used by this script.");
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

function hashValue(value) {
  if (value == null || value === "") return null;
  return crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}

async function tableExists(client, table) {
  const result = await client.query(
    "SELECT to_regclass($1) AS name",
    [`public.${table}`]
  );
  return Boolean(result.rows[0]?.name);
}

async function tableColumns(client, table) {
  const result = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return result.rows;
}

async function primaryKeyColumns(client, table) {
  const result = await client.query(
    `SELECT a.attname AS column_name
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary
     ORDER BY array_position(i.indkey, a.attnum)`,
    [`public.${table}`]
  );
  return result.rows.map(row => row.column_name);
}

async function tableSummary(client, table) {
  const columns = (await tableColumns(client, table)).map(column => column.column_name);
  const selectParts = ["COUNT(*)::bigint AS total_rows"];
  for (const column of ["record_key", "employee_code", "email", "phone"]) {
    if (columns.includes(column)) {
      selectParts.push(`COUNT(${quoteIdent(column)})::bigint AS ${quoteIdent(`${column}_present`)}`);
      selectParts.push(`COUNT(*) FILTER (WHERE ${quoteIdent(column)} IS NULL)::bigint AS ${quoteIdent(`${column}_nulls`)}`);
      selectParts.push(`COUNT(DISTINCT ${quoteIdent(column)})::bigint AS ${quoteIdent(`${column}_distinct`)}`);
    }
  }
  const result = await client.query(`SELECT ${selectParts.join(", ")} FROM ${quoteIdent(table)}`);
  const summary = result.rows[0] || {};

  if (columns.includes("email")) {
    const hashes = await client.query(
      `SELECT encode(digest(lower(email), 'sha256'), 'hex') AS hash
       FROM ${quoteIdent(table)}
       WHERE email IS NOT NULL AND email <> ''
       ORDER BY hash`
    ).catch(() => ({ rows: [] }));
    summary.email_hash_sample = hashes.rows.slice(0, 25).map(row => row.hash);
  }
  if (columns.includes("phone")) {
    const rows = await client.query(`SELECT phone FROM ${quoteIdent(table)} WHERE phone IS NOT NULL AND phone <> '' ORDER BY phone LIMIT 25`);
    summary.phone_hash_sample = rows.rows.map(row => hashValue(row.phone));
  }
  return summary;
}

async function readRows(client, table, pkColumns) {
  const orderBy = pkColumns.length
    ? ` ORDER BY ${pkColumns.map(quoteIdent).join(", ")}`
    : "";
  const result = await client.query(`SELECT * FROM ${quoteIdent(table)}${orderBy}`);
  return result.rows;
}

async function main() {
  requireSourceUrl();
  const pool = poolFor(sourceUrl);
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    source: "postgresql",
    tables: {}
  };

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      for (const table of tableOrder) {
        if (!await tableExists(client, table)) {
          exportPayload.tables[table] = { exists: false, columns: [], primaryKey: [], rows: [], summary: {} };
          continue;
        }
        const columns = await tableColumns(client, table);
        const primaryKey = await primaryKeyColumns(client, table);
        const summary = await tableSummary(client, table);
        const rows = await readRows(client, table, primaryKey);
        exportPayload.tables[table] = { exists: true, columns, primaryKey, summary, rows };
        console.log(JSON.stringify({ table, rows: rows.length }));
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(exportPayload, null, 2)}\n`);
  console.log(JSON.stringify({ exported: outputPath, tables: Object.keys(exportPayload.tables).length }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
