const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");
const { loadLocalEnv } = require("../src/load-env");

loadLocalEnv();

const rootDir = path.join(__dirname, "..");
const sqlitePath = path.join(rootDir, "data", "talme.sqlite");
const importedJsonPath = path.join(rootDir, "data", "imported-employees.json");
const databaseUrl = process.env.DATABASE_URL;

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email || "";
}

function sourceKey(row) {
  return `${normalizeEmail(row.email)}|${String(row.phone || "")}`;
}

function readSourceReport() {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  let sqliteRows;
  try {
    sqliteRows = db.prepare(`
      SELECT CASE WHEN lower(u.email) LIKE 'local-import-%@talme.local' THEN '' ELSE u.email END AS email,
             u.phone
      FROM employee_accounts ea
      JOIN users u ON u.id = ea.user_id
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE r.slug = 'employee'
    `).all();
  } finally {
    db.close();
  }

  const importedPayload = fs.existsSync(importedJsonPath)
    ? JSON.parse(fs.readFileSync(importedJsonPath, "utf8"))
    : { items: [] };
  const importedRows = Array.isArray(importedPayload.items) ? importedPayload.items : [];
  const keys = new Set();
  for (const row of [...sqliteRows, ...importedRows]) keys.add(sourceKey(row));
  return {
    sqliteRows: sqliteRows.length,
    importedRows: importedRows.length,
    rawRows: sqliteRows.length + importedRows.length,
    mergedDeduplicatedEmployees: keys.size,
    duplicateCount: sqliteRows.length + importedRows.length - keys.size,
    keys
  };
}

async function readDestinationReport(pool) {
  const counts = await pool.query(`
    SELECT
      COUNT(*)::int AS active_records,
      COUNT(*) FILTER (WHERE source_type <> 'imported')::int AS database_records,
      COUNT(*) FILTER (WHERE source_type = 'imported')::int AS imported_records,
      COUNT(DISTINCT COALESCE(LOWER(email), '') || '|' || COALESCE(phone, ''))::int AS merged_deduplicated_employees
    FROM hr_employee_records
    WHERE archived_at IS NULL
  `);
  const rows = await pool.query(`
    SELECT email, phone
    FROM hr_employee_records
    WHERE archived_at IS NULL
  `);
  return {
    activeRecords: Number(counts.rows[0].active_records || 0),
    databaseRecords: Number(counts.rows[0].database_records || 0),
    importedRecords: Number(counts.rows[0].imported_records || 0),
    mergedDeduplicatedEmployees: Number(counts.rows[0].merged_deduplicated_employees || 0),
    keys: new Set(rows.rows.map(sourceKey))
  };
}

async function main() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to verify the PostgreSQL destination.");
  }

  const source = readSourceReport();
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
  });

  try {
    const destination = await readDestinationReport(pool);
    let missingInDestination = 0;
    for (const key of source.keys) {
      if (!destination.keys.has(key)) missingInDestination += 1;
    }
    let extraInDestination = 0;
    for (const key of destination.keys) {
      if (!source.keys.has(key)) extraInDestination += 1;
    }

    console.log(JSON.stringify({
      source: {
        sqliteRows: source.sqliteRows,
        importedRows: source.importedRows,
        rawRows: source.rawRows,
        mergedDeduplicatedEmployees: source.mergedDeduplicatedEmployees,
        duplicateCount: source.duplicateCount
      },
      destination: {
        activeRecords: destination.activeRecords,
        databaseRecords: destination.databaseRecords,
        importedRecords: destination.importedRecords,
        mergedDeduplicatedEmployees: destination.mergedDeduplicatedEmployees
      },
      reconciliation: {
        missingDedupedEmployeesInDestination: missingInDestination,
        extraDedupedEmployeesInDestination: extraInDestination
      }
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
