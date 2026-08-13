const { Pool } = require("pg");
const { loadLocalEnv } = require("./load-env");

loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
    })
  : null;

let employeeTablesReady;

function hasEmployeeDatabase() {
  return Boolean(pool);
}

async function hasEmployeeTables() {
  if (!pool) return false;
  if (!employeeTablesReady) {
    employeeTablesReady = pool.query(`
      SELECT
        to_regclass('public.hr_employee_records') IS NOT NULL AS has_records,
        to_regclass('public.hr_employee_imports') IS NOT NULL AS has_imports
    `).then(result => Boolean(result.rows[0]?.has_records && result.rows[0]?.has_imports));
  }
  return employeeTablesReady;
}

async function requireEmployeeTables() {
  if (!pool) {
    const error = new Error("DATABASE_URL is required for persistent HR employee records");
    error.statusCode = 500;
    throw error;
  }
  if (!await hasEmployeeTables()) {
    const error = new Error("HR employee PostgreSQL tables are not migrated");
    error.statusCode = 500;
    throw error;
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeText(value) {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function normalizeNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function rowToEmployee(row) {
  if (!row) return null;
  return {
    id: row.source_id,
    employee_code: row.employee_code,
    name: row.name,
    email: row.email || "",
    phone: row.phone || "",
    designation: row.designation,
    department: row.department,
    location: row.location,
    keywords: row.keywords,
    experience: row.experience == null ? null : Number(row.experience),
    current_company: row.current_company,
    current_designation: row.current_designation,
    cv_file_name: row.cv_file_name,
    cv_stored_name: row.cv_stored_name,
    source: row.source_file,
    rowNumber: row.row_number,
    updatedAt: row.source_updated_at || row.updated_at
  };
}

const employeeSelect = `
  id, record_key, source_type, source_id, source_file, row_number,
  local_user_id, local_employee_account_id, local_company_id, local_role_id,
  local_role_company_id, employee_code, name, email, phone, status,
  email_verified, phone_verified, designation, department, location, keywords,
  experience, current_company, current_designation, cv_file_name, cv_stored_name,
  source_created_at, source_updated_at, created_at, updated_at
`;

async function listEmployees() {
  await requireEmployeeTables();
  const result = await pool.query(`
    SELECT ${employeeSelect}
    FROM hr_employee_records
    WHERE archived_at IS NULL AND source_type <> 'imported'
    ORDER BY name
  `);
  return result.rows.map(rowToEmployee);
}

async function listImportedEmployees() {
  await requireEmployeeTables();
  const [itemsResult, importResult] = await Promise.all([
    pool.query(`
      SELECT ${employeeSelect}
      FROM hr_employee_records
      WHERE archived_at IS NULL AND source_type = 'imported'
      ORDER BY row_number NULLS LAST, name
    `),
    pool.query(`
      SELECT source, generated_at, total_rows, imported_rows, skipped_rows
      FROM hr_employee_imports
      ORDER BY generated_at DESC NULLS LAST, id DESC
      LIMIT 1
    `)
  ]);
  const latest = importResult.rows[0] || {};
  return {
    items: itemsResult.rows.map(rowToEmployee),
    summary: {
      source: latest.source || "PostgreSQL",
      generatedAt: latest.generated_at || null,
      totalRows: Number(latest.total_rows || 0),
      importedRows: Number(latest.imported_rows || itemsResult.rows.length),
      skippedRows: Number(latest.skipped_rows || 0)
    }
  };
}

async function publicProfileCount() {
  await requireEmployeeTables();
  const result = await pool.query(`
    SELECT source_type, email, phone
    FROM hr_employee_records
    WHERE archived_at IS NULL
  `);
  const seen = new Set();
  let totalProfiles = 0;
  let databaseProfiles = 0;
  let importedProfiles = 0;
  for (const row of result.rows) {
    if (row.source_type === "imported") importedProfiles += 1;
    else databaseProfiles += 1;
    const key = `${normalizeEmail(row.email)}|${String(row.phone || "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    totalProfiles += 1;
  }
  return { totalProfiles, databaseProfiles, importedProfiles };
}

async function findEmployeeByIdentifier(identifier) {
  await requireEmployeeTables();
  const id = String(identifier || "");
  const result = await pool.query(`
    SELECT ${employeeSelect}
    FROM hr_employee_records
    WHERE archived_at IS NULL
      AND (
        source_id = $1
        OR employee_code = $1
        OR LOWER(email) = LOWER($1)
        OR phone = $1
      )
    ORDER BY CASE WHEN source_id = $1 THEN 0 ELSE 1 END, id
    LIMIT 1
  `, [id]);
  return rowToEmployee(result.rows[0]);
}

async function matchingNonImportedRecord(client, email, phone) {
  const result = await client.query(`
    SELECT record_key, source_id
    FROM hr_employee_records
    WHERE archived_at IS NULL
      AND source_type <> 'imported'
      AND (
        ($1::text IS NOT NULL AND $1 <> '' AND LOWER(email) = LOWER($1))
        OR ($2::text IS NOT NULL AND $2 <> '' AND phone = $2)
      )
    ORDER BY CASE WHEN LOWER(email) = LOWER($1) THEN 0 ELSE 1 END, id
    LIMIT 1
  `, [normalizeEmail(email) || null, normalizeText(phone)]);
  return result.rows[0] || null;
}

function employeeRecordValues(record) {
  return [
    record.recordKey,
    record.sourceType,
    record.sourceId,
    record.sourceFile || null,
    record.rowNumber == null ? null : Number(record.rowNumber),
    record.localUserId == null ? null : Number(record.localUserId),
    record.localEmployeeAccountId == null ? null : Number(record.localEmployeeAccountId),
    record.localCompanyId == null ? null : Number(record.localCompanyId),
    record.localRoleId == null ? null : Number(record.localRoleId),
    record.localRoleCompanyId == null ? null : Number(record.localRoleCompanyId),
    record.localRoleAssignedAt ? normalizeTimestamp(record.localRoleAssignedAt) : null,
    normalizeText(record.employeeCode),
    normalizeText(record.name) || "Unnamed employee",
    normalizeEmail(record.email) || null,
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

async function upsertEmployeeRecord(client, record) {
  const result = await client.query(`
    INSERT INTO hr_employee_records (
      record_key, source_type, source_id, source_file, row_number,
      local_user_id, local_employee_account_id, local_company_id, local_role_id,
      local_role_company_id, local_role_assigned_at, employee_code, name, email,
      phone, status, email_verified, phone_verified, designation, department,
      location, keywords, experience, current_company, current_designation,
      cv_file_name, cv_stored_name, source_created_at, source_updated_at, source_payload
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25,
      $26, $27, $28, $29, $30::jsonb
    )
    ON CONFLICT (record_key) DO UPDATE SET
      source_type = EXCLUDED.source_type,
      source_id = EXCLUDED.source_id,
      source_file = EXCLUDED.source_file,
      row_number = EXCLUDED.row_number,
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
      cv_file_name = COALESCE(EXCLUDED.cv_file_name, hr_employee_records.cv_file_name),
      cv_stored_name = COALESCE(EXCLUDED.cv_stored_name, hr_employee_records.cv_stored_name),
      source_created_at = COALESCE(EXCLUDED.source_created_at, hr_employee_records.source_created_at),
      source_updated_at = COALESCE(EXCLUDED.source_updated_at, hr_employee_records.source_updated_at),
      source_payload = EXCLUDED.source_payload,
      archived_at = NULL,
      updated_at = NOW()
    RETURNING ${employeeSelect}, (xmax = 0) AS inserted
  `, employeeRecordValues(record));
  return {
    employee: rowToEmployee(result.rows[0]),
    created: Boolean(result.rows[0]?.inserted)
  };
}

async function saveManualEmployee({ record, body, cv }) {
  await requireEmployeeTables();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await matchingNonImportedRecord(client, record.email, record.phone);
    const sourceId = existing?.source_id || `manual-${Date.now()}`;
    const saved = await upsertEmployeeRecord(client, {
      recordKey: existing?.record_key || `manual:${sourceId}`,
      sourceType: "manual",
      sourceId,
      employeeCode: body.employeeCode || `EMP-${sourceId}`,
      name: record.fullName,
      email: record.email,
      phone: record.phone,
      status: "active",
      emailVerified: true,
      phoneVerified: Boolean(record.phone),
      designation: record.currentDesignation || "Employee",
      department: record.currentCompany || record.location || "General",
      location: record.location,
      keywords: record.keywords,
      experience: record.experience,
      currentCompany: record.currentCompany,
      currentDesignation: record.currentDesignation,
      cvFileName: cv.cvFileName,
      cvStoredName: cv.cvStoredName,
      sourceUpdatedAt: new Date().toISOString(),
      sourcePayload: { body }
    });
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateEmployee(identifier, data, cv) {
  await requireEmployeeTables();
  const id = String(identifier || "");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(`
      SELECT ${employeeSelect}
      FROM hr_employee_records
      WHERE archived_at IS NULL
        AND (
          source_id = $1
          OR employee_code = $1
          OR LOWER(email) = LOWER($1)
          OR phone = $1
        )
      ORDER BY CASE WHEN source_id = $1 THEN 0 ELSE 1 END, id
      LIMIT 1
      FOR UPDATE
    `, [id]);
    const row = current.rows[0];
    if (!row) {
      const error = new Error("Employee not found");
      error.statusCode = 404;
      throw error;
    }
    const result = await client.query(`
      UPDATE hr_employee_records
      SET employee_code = COALESCE($2, employee_code),
          name = $3,
          email = $4,
          phone = $5,
          designation = $6,
          department = $7,
          location = $8,
          keywords = $9,
          experience = $10,
          current_company = $11,
          current_designation = $12,
          cv_file_name = COALESCE($13, cv_file_name),
          cv_stored_name = COALESCE($14, cv_stored_name),
          source_updated_at = NOW(),
          updated_at = NOW()
      WHERE record_key = $1
      RETURNING ${employeeSelect}
    `, [
      row.record_key,
      normalizeText(data.employeeCode),
      normalizeText(data.name) || row.name,
      normalizeEmail(data.email) || null,
      normalizeText(data.phone),
      normalizeText(data.designation) || normalizeText(data.currentDesignation) || "Employee",
      normalizeText(data.department) || normalizeText(data.location),
      normalizeText(data.location),
      normalizeText(data.keywords),
      normalizeNumber(data.experience),
      normalizeText(data.currentCompany),
      normalizeText(data.currentDesignation) || normalizeText(data.designation) || "Employee",
      cv.cvFileName || null,
      cv.cvStoredName || null
    ]);
    await client.query("COMMIT");
    return rowToEmployee(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function saveUploadedEmployee(record, source) {
  await requireEmployeeTables();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await matchingNonImportedRecord(client, record.data.email, record.data.phone);
    const sourceId = `${source || "upload"}:${record.rowNumber}:${normalizeEmail(record.data.email)}:${record.data.phone || ""}`;
    const saved = await upsertEmployeeRecord(client, {
      recordKey: existing?.record_key || `upload:${sourceId}`,
      sourceType: "upload",
      sourceId: existing?.source_id || sourceId,
      sourceFile: source || null,
      rowNumber: record.rowNumber,
      employeeCode: record.data.employeeCode,
      name: record.data.fullName,
      email: record.data.email,
      phone: record.data.phone,
      status: "active",
      emailVerified: true,
      phoneVerified: Boolean(record.data.phone),
      designation: record.data.currentDesignation || "Employee",
      department: record.data.currentCompany || record.data.location || "General",
      location: record.data.location,
      keywords: record.data.keywords,
      experience: record.data.experience,
      currentCompany: record.data.currentCompany,
      currentDesignation: record.data.currentDesignation || "Employee",
      sourceUpdatedAt: new Date().toISOString(),
      sourcePayload: record
    });
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function closeEmployeeStore() {
  if (pool) await pool.end();
}

module.exports = {
  hasEmployeeDatabase,
  hasEmployeeTables,
  listEmployees,
  listImportedEmployees,
  publicProfileCount,
  findEmployeeByIdentifier,
  saveManualEmployee,
  updateEmployee,
  saveUploadedEmployee,
  closeEmployeeStore
};
