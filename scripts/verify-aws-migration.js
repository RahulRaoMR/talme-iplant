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
const targetUrl = process.env.TARGET_DATABASE_URL || process.env.AWS_DATABASE_URL;

function requireUrls() {
  if (!sourceUrl) throw new Error("SOURCE_DATABASE_URL is required. DATABASE_URL is intentionally not used by this script.");
  if (!targetUrl) throw new Error("TARGET_DATABASE_URL or AWS_DATABASE_URL is required.");
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

function hashList(values) {
  const hash = crypto.createHash("sha256");
  for (const value of values.map(value => String(value || "").trim().toLowerCase()).sort()) {
    hash.update(value);
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function tableExists(client, table) {
  const result = await client.query("SELECT to_regclass($1) AS name", [`public.${table}`]);
  return Boolean(result.rows[0]?.name);
}

async function tableColumns(client, table) {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return result.rows.map(row => row.column_name);
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

async function duplicateCount(client, table, column) {
  const result = await client.query(
    `SELECT COUNT(*)::bigint AS duplicate_groups
     FROM (
       SELECT ${quoteIdent(column)}
       FROM ${quoteIdent(table)}
       WHERE ${quoteIdent(column)} IS NOT NULL AND ${quoteIdent(column)} <> ''
       GROUP BY ${quoteIdent(column)}
       HAVING COUNT(*) > 1
     ) duplicates`
  );
  return Number(result.rows[0]?.duplicate_groups || 0);
}

async function columnHash(client, table, column) {
  const result = await client.query(
    `SELECT ${quoteIdent(column)} AS value
     FROM ${quoteIdent(table)}
     WHERE ${quoteIdent(column)} IS NOT NULL AND ${quoteIdent(column)} <> ''`
  );
  return hashList(result.rows.map(row => row.value));
}

async function tableReport(client, table) {
  if (!await tableExists(client, table)) return { exists: false };
  const columns = await tableColumns(client, table);
  const primaryKey = await primaryKeyColumns(client, table);
  const report = { exists: true, columns: columns.length, primaryKey };
  report.rowCount = Number((await client.query(`SELECT COUNT(*)::bigint AS n FROM ${quoteIdent(table)}`)).rows[0].n);

  if (primaryKey.length === 1) {
    const pk = primaryKey[0];
    const range = await client.query(
      `SELECT MIN(${quoteIdent(pk)}) AS min, MAX(${quoteIdent(pk)}) AS max FROM ${quoteIdent(table)}`
    );
    report.primaryKeyRange = range.rows[0];
  }

  report.nullCounts = {};
  report.duplicateCounts = {};
  report.hashes = {};
  for (const column of ["record_key", "employee_code", "email", "phone", "resume_s3_key"]) {
    if (!columns.includes(column)) continue;
    report.nullCounts[column] = Number((await client.query(
      `SELECT COUNT(*)::bigint AS n FROM ${quoteIdent(table)} WHERE ${quoteIdent(column)} IS NULL`
    )).rows[0].n);
    report.duplicateCounts[column] = await duplicateCount(client, table, column);
    if (["email", "phone", "record_key", "employee_code"].includes(column)) {
      report.hashes[column] = await columnHash(client, table, column);
    }
  }
  return report;
}

async function databaseReport(pool) {
  const client = await pool.connect();
  try {
    const tables = {};
    for (const table of tableOrder) tables[table] = await tableReport(client, table);
    return tables;
  } finally {
    client.release();
  }
}

function compareReports(source, target) {
  return tableOrder.map(table => {
    const left = source[table] || {};
    const right = target[table] || {};
    return {
      table,
      sourceRows: left.rowCount ?? null,
      targetRows: right.rowCount ?? null,
      rowCountMatches: left.rowCount === right.rowCount,
      sourceExists: Boolean(left.exists),
      targetExists: Boolean(right.exists),
      primaryKeyRangeMatches: JSON.stringify(left.primaryKeyRange || null) === JSON.stringify(right.primaryKeyRange || null),
      hashMatches: JSON.stringify(left.hashes || {}) === JSON.stringify(right.hashes || {}),
      nullCountsMatch: JSON.stringify(left.nullCounts || {}) === JSON.stringify(right.nullCounts || {}),
      duplicateCountsMatch: JSON.stringify(left.duplicateCounts || {}) === JSON.stringify(right.duplicateCounts || {})
    };
  });
}

async function main() {
  requireUrls();
  const sourcePool = poolFor(sourceUrl);
  const targetPool = poolFor(targetUrl);
  try {
    const [source, target] = await Promise.all([
      databaseReport(sourcePool),
      databaseReport(targetPool)
    ]);
    console.log(JSON.stringify({
      verifiedAt: new Date().toISOString(),
      comparison: compareReports(source, target),
      source,
      target
    }, null, 2));
  } finally {
    await Promise.all([sourcePool.end(), targetPool.end()]);
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
