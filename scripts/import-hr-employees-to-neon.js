const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");
const { loadLocalEnv } = require("../src/load-env");

loadLocalEnv();

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const rootDir = path.join(__dirname, "..");
const sqlitePath = path.join(rootDir, "data", "talme.sqlite");
const importedJsonPath = path.join(rootDir, "data", "imported-employees.json");
const databaseUrl = process.env.DATABASE_URL;

function usage() {
  console.log("Usage:");
  console.log("  node scripts/import-hr-employees-to-neon.js --dry-run");
  console.log("  node scripts/import-hr-employees-to-neon.js --apply");
  console.log("");
  console.log("Default mode is --dry-run. DATABASE_URL is required for destination checks and --apply.");
}

if (args.has("--help")) {
  usage();
  process.exit(0);
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email || null;
}

function normalizeText(value) {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

function readSqliteEmployees() {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite source not found: ${sqlitePath}`);
  }
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    return db.prepare(`
      SELECT u.id AS local_user_id,
             ea.id AS local_employee_account_id,
             ea.company_id AS local_company_id,
             ur.role_id AS local_role_id,
             ur.company_id AS local_role_company_id,
             ur.assigned_at AS local_role_assigned_at,
             ea.employee_code,
             u.name,
             u.email AS raw_email,
             CASE WHEN lower(u.email) LIKE 'local-import-%@talme.local' THEN '' ELSE u.email END AS email,
             u.phone,
             u.status,
             u.email_verified,
             u.phone_verified,
             ea.designation,
             ea.department,
             ea.location,
             ea.keywords,
             ea.experience,
             ea.current_company,
             ea.current_designation,
             ea.cv_file_name,
             ea.cv_stored_name,
             ea.created_at AS source_created_at,
             u.updated_at AS source_updated_at
      FROM employee_accounts ea
      JOIN users u ON u.id = ea.user_id
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE r.slug = 'employee'
      ORDER BY u.name
    `).all();
  } finally {
    db.close();
  }
}

function readImportedEmployees() {
  if (!fs.existsSync(importedJsonPath)) {
    return {
      source: "imported-employees.json",
      generatedAt: null,
      totalRows: 0,
      importedRows: 0,
      skippedRows: 0,
      skippedPreview: [],
      items: []
    };
  }
  const payload = JSON.parse(fs.readFileSync(importedJsonPath, "utf8"));
  return {
    source: payload.source || "imported-employees.json",
    generatedAt: payload.generatedAt || null,
    totalRows: Number(payload.totalRows || 0),
    importedRows: Number(payload.importedRows || 0),
    skippedRows: Number(payload.skippedRows || 0),
    skippedPreview: Array.isArray(payload.skippedPreview) ? payload.skippedPreview : [],
    items: Array.isArray(payload.items) ? payload.items : []
  };
}

function sqliteRecordKey(row) {
  return [
    "sqlite",
    row.local_user_id,
    row.local_role_id,
    row.local_role_company_id == null ? "none" : row.local_role_company_id
  ].join(":");
}

function importedRecordKey(item) {
  const key = item.id || item.employee_code || item.email || item.phone || item.rowNumber;
  return `imported:${String(key || "").toLowerCase()}`;
}

function sqliteRecord(row) {
  return {
    recordKey: sqliteRecordKey(row),
    sourceType: "sqlite",
    sourceId: String(row.local_user_id),
    sourceFile: "data/talme.sqlite",
    rowNumber: null,
    localUserId: row.local_user_id,
    localEmployeeAccountId: row.local_employee_account_id,
    localCompanyId: row.local_company_id,
    localRoleId: row.local_role_id,
    localRoleCompanyId: row.local_role_company_id,
    localRoleAssignedAt: row.local_role_assigned_at,
    employeeCode: row.employee_code,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status || "active",
    emailVerified: Boolean(row.email_verified),
    phoneVerified: Boolean(row.phone_verified),
    designation: row.designation,
    department: row.department,
    location: row.location,
    keywords: row.keywords,
    experience: row.experience,
    currentCompany: row.current_company,
    currentDesignation: row.current_designation,
    cvFileName: row.cv_file_name,
    cvStoredName: row.cv_stored_name,
    sourceCreatedAt: row.source_created_at,
    sourceUpdatedAt: row.source_updated_at,
    sourcePayload: row
  };
}

function importedRecord(item) {
  return {
    recordKey: importedRecordKey(item),
    sourceType: "imported",
    sourceId: String(item.id || item.employee_code || item.rowNumber || importedRecordKey(item)),
    sourceFile: item.source || "imported-employees.json",
    rowNumber: item.rowNumber == null ? null : Number(item.rowNumber),
    employeeCode: item.employee_code,
    name: item.name,
    email: item.email,
    phone: item.phone,
    status: "active",
    emailVerified: item.email ? true : null,
    phoneVerified: item.phone ? true : null,
    designation: item.designation,
    department: item.department,
    location: item.location,
    keywords: item.keywords,
    experience: item.experience,
    currentCompany: item.current_company,
    currentDesignation: item.current_designation,
    cvFileName: item.cv_file_name,
    cvStoredName: item.cv_stored_name,
    sourceCreatedAt: null,
    sourceUpdatedAt: item.updatedAt,
    sourcePayload: item
  };
}

function mergedCount(records) {
  const seen = new Set();
  let count = 0;
  for (const record of records) {
    const key = `${normalizeEmail(record.email) || ""}|${String(record.phone || "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

function employeeRecordValues(record, importId = null) {
  return [
    record.recordKey,
    record.sourceType,
    record.sourceId,
    record.sourceFile,
    record.rowNumber,
    importId,
    record.localUserId == null ? null : Number(record.localUserId),
    record.localEmployeeAccountId == null ? null : Number(record.localEmployeeAccountId),
    record.localCompanyId == null ? null : Number(record.localCompanyId),
    record.localRoleId == null ? null : Number(record.localRoleId),
    record.localRoleCompanyId == null ? null : Number(record.localRoleCompanyId),
    normalizeTimestamp(record.localRoleAssignedAt),
    normalizeText(record.employeeCode),
    normalizeText(record.name) || "Unnamed employee",
    normalizeEmail(record.email),
    normalizeText(record.phone),
    normalizeText(record.status) || "active",
    record.emailVerified == null ? null : Boolean(record.emailVerified),
    record.phoneVerified == null ? null : Boolean(record.phoneVerified),
    normalizeText(record.designation) || "Employee",
    normalizeText(record.department),
    normalizeText(record.location),
    normalizeText(record.keywords),
    normalizeNumber(record.experience),
    normalizeText(record.currentCompany),
    normalizeText(record.currentDesignation) || normalizeText(record.designation) || "Employee",
    normalizeText(record.cvFileName),
    normalizeText(record.cvStoredName),
    normalizeTimestamp(record.sourceCreatedAt),
    normalizeTimestamp(record.sourceUpdatedAt),
    JSON.stringify(record.sourcePayload || {})
  ];
}

async function requireDestinationTables(pool) {
  const result = await pool.query(`
    SELECT
      to_regclass('public.hr_employee_records') IS NOT NULL AS has_records,
      to_regclass('public.hr_employee_imports') IS NOT NULL AS has_imports
  `);
  return Boolean(result.rows[0]?.has_records && result.rows[0]?.has_imports);
}

async function destinationRecordKeySet(pool, keys) {
  const found = new Set();
  for (let index = 0; index < keys.length; index += 5000) {
    const batch = keys.slice(index, index + 5000);
    const result = await pool.query(
      "SELECT record_key FROM hr_employee_records WHERE record_key = ANY($1::text[])",
      [batch]
    );
    for (const row of result.rows) found.add(row.record_key);
  }
  return found;
}

async function insertImportMetadata(client, importedPayload) {
  const result = await client.query(`
    INSERT INTO hr_employee_imports
      (source, generated_at, total_rows, imported_rows, skipped_rows, skipped_preview)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    RETURNING id
  `, [
    importedPayload.source,
    normalizeTimestamp(importedPayload.generatedAt),
    importedPayload.totalRows,
    importedPayload.importedRows,
    importedPayload.skippedRows,
    JSON.stringify(importedPayload.skippedPreview)
  ]);
  return result.rows[0].id;
}

async function upsertRecords(client, records, importIdBySourceType) {
  const sql = `
    INSERT INTO hr_employee_records (
      record_key, source_type, source_id, source_file, row_number, import_id,
      local_user_id, local_employee_account_id, local_company_id, local_role_id,
      local_role_company_id, local_role_assigned_at, employee_code, name, email,
      phone, status, email_verified, phone_verified, designation, department,
      location, keywords, experience, current_company, current_designation,
      cv_file_name, cv_stored_name, source_created_at, source_updated_at, source_payload
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21,
      $22, $23, $24, $25, $26,
      $27, $28, $29, $30, $31::jsonb
    )
    ON CONFLICT (record_key) DO UPDATE SET
      source_type = EXCLUDED.source_type,
      source_id = EXCLUDED.source_id,
      source_file = EXCLUDED.source_file,
      row_number = EXCLUDED.row_number,
      import_id = COALESCE(EXCLUDED.import_id, hr_employee_records.import_id),
      local_user_id = EXCLUDED.local_user_id,
      local_employee_account_id = EXCLUDED.local_employee_account_id,
      local_company_id = EXCLUDED.local_company_id,
      local_role_id = EXCLUDED.local_role_id,
      local_role_company_id = EXCLUDED.local_role_company_id,
      local_role_assigned_at = EXCLUDED.local_role_assigned_at,
      employee_code = EXCLUDED.employee_code,
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      status = EXCLUDED.status,
      email_verified = EXCLUDED.email_verified,
      phone_verified = EXCLUDED.phone_verified,
      designation = EXCLUDED.designation,
      department = EXCLUDED.department,
      location = EXCLUDED.location,
      keywords = EXCLUDED.keywords,
      experience = EXCLUDED.experience,
      current_company = EXCLUDED.current_company,
      current_designation = EXCLUDED.current_designation,
      cv_file_name = EXCLUDED.cv_file_name,
      cv_stored_name = EXCLUDED.cv_stored_name,
      source_created_at = EXCLUDED.source_created_at,
      source_updated_at = EXCLUDED.source_updated_at,
      source_payload = EXCLUDED.source_payload,
      archived_at = NULL,
      updated_at = NOW()
  `;
  for (const record of records) {
    const importId = importIdBySourceType[record.sourceType] || null;
    await client.query(sql, employeeRecordValues(record, importId));
  }
}

async function main() {
  const sqliteRows = readSqliteEmployees();
  const importedPayload = readImportedEmployees();
  const sqliteRecords = sqliteRows.map(sqliteRecord);
  const importedRecords = importedPayload.items.map(importedRecord);
  const allRecords = [...sqliteRecords, ...importedRecords];
  const expectedMerged = mergedCount(allRecords);
  const duplicateCount = allRecords.length - expectedMerged;

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    sqliteEmployeeRows: sqliteRecords.length,
    importedJsonRows: importedRecords.length,
    expectedMergedDeduplicatedEmployees: expectedMerged,
    duplicateCount,
    sourceFiles: {
      sqlite: path.relative(rootDir, sqlitePath),
      importedJson: fs.existsSync(importedJsonPath) ? path.relative(rootDir, importedJsonPath) : null
    }
  }, null, 2));

  if (!databaseUrl) {
    if (apply) throw new Error("DATABASE_URL is required for --apply.");
    console.log("Destination check skipped: DATABASE_URL is not configured.");
    return;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
  });

  try {
    let destinationReady = false;
    try {
      destinationReady = await requireDestinationTables(pool);
    } catch (error) {
      if (apply) throw error;
      console.log(JSON.stringify({
        destinationReady: false,
        destinationCheck: "unavailable",
        reason: error.code || error.name || "connection failed",
        nextStep: "Run the Prisma migration and rerun this dry run from a shell that can connect to Neon."
      }, null, 2));
      return;
    }
    if (!destinationReady) {
      if (apply) throw new Error("Destination tables are missing. Review and run the Prisma migration first.");
      console.log(JSON.stringify({
        destinationReady: false,
        nextStep: "Review and run the Prisma migration, then rerun this dry run to see insert/update counts."
      }, null, 2));
      return;
    }
    const sourceKeys = allRecords.map(record => record.recordKey);
    const existingKeys = await destinationRecordKeySet(pool, sourceKeys);
    const wouldInsert = sourceKeys.filter(key => !existingKeys.has(key)).length;
    const wouldUpdate = sourceKeys.length - wouldInsert;
    const destinationCount = Number((await pool.query("SELECT COUNT(*) AS n FROM hr_employee_records WHERE archived_at IS NULL")).rows[0].n);
    const destinationImportedCount = Number((await pool.query("SELECT COUNT(*) AS n FROM hr_employee_records WHERE archived_at IS NULL AND source_type = 'imported'")).rows[0].n);

    console.log(JSON.stringify({
      destinationBefore: {
        activeRecords: destinationCount,
        importedRecords: destinationImportedCount
      },
      wouldInsert,
      wouldUpdate,
      missingSourceKeys: wouldInsert
    }, null, 2));

    if (!apply) {
      console.log("Dry run complete. No PostgreSQL rows were inserted or updated.");
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const importId = await insertImportMetadata(client, importedPayload);
      for (let index = 0; index < allRecords.length; index += 500) {
        await upsertRecords(client, allRecords.slice(index, index + 500), { imported: importId });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    const after = Number((await pool.query("SELECT COUNT(*) AS n FROM hr_employee_records WHERE archived_at IS NULL")).rows[0].n);
    const importedAfter = Number((await pool.query("SELECT COUNT(*) AS n FROM hr_employee_records WHERE archived_at IS NULL AND source_type = 'imported'")).rows[0].n);
    console.log(JSON.stringify({
      destinationAfter: {
        activeRecords: after,
        importedRecords: importedAfter
      },
      applied: true
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message || error.code || error.name || "Import failed");
  process.exit(1);
});
