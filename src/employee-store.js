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
  import_id, local_user_id, local_employee_account_id, local_company_id, local_role_id,
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

async function matchingNonImportedRecord(client, email, phone, employeeCode = null) {
  const result = await client.query(`
    SELECT record_key, source_id
    FROM hr_employee_records
    WHERE archived_at IS NULL
      AND source_type <> 'imported'
      AND (
        ($1::text IS NOT NULL AND $1 <> '' AND LOWER(email) = LOWER($1))
        OR ($2::text IS NOT NULL AND $2 <> '' AND phone = $2)
        OR ($3::text IS NOT NULL AND $3 <> '' AND employee_code = $3)
      )
    ORDER BY CASE
      WHEN LOWER(email) = LOWER($1) THEN 0
      WHEN phone = $2 THEN 1
      WHEN employee_code = $3 THEN 2
      ELSE 3
    END, id
    LIMIT 1
  `, [normalizeEmail(email) || null, normalizeText(phone), normalizeText(employeeCode)]);
  return result.rows[0] || null;
}

async function matchingUploadRecord(client, email, phone, employeeCode = null, recordKey = null) {
  const result = await client.query(`
    SELECT record_key, source_id, employee_code
    FROM hr_employee_records
    WHERE archived_at IS NULL
      AND (
        ($4::text IS NOT NULL AND $4 <> '' AND record_key = $4)
        OR ($1::text IS NOT NULL AND $1 <> '' AND LOWER(email) = LOWER($1))
        OR ($2::text IS NOT NULL AND $2 <> '' AND phone = $2)
        OR ($3::text IS NOT NULL AND $3 <> '' AND employee_code = $3)
      )
    ORDER BY CASE
      WHEN record_key = $4 THEN 0
      WHEN LOWER(email) = LOWER($1) THEN 1
      WHEN phone = $2 THEN 2
      WHEN employee_code = $3 THEN 3
      ELSE 4
    END, id
    LIMIT 1
  `, [normalizeEmail(email) || null, normalizeText(phone), normalizeText(employeeCode), normalizeText(recordKey)]);
  return result.rows[0] || null;
}

function uploadIdentityKeysForRecord(record, existing = null) {
  return [
    existing?.record_key ? `recordKey:${existing.record_key}` : null,
    record?.recordKey ? `recordKey:${record.recordKey}` : null,
    record?.record_key ? `recordKey:${record.record_key}` : null,
    record?.data?.email ? `email:${normalizeEmail(record.data.email)}` : null,
    record?.data?.phone ? `phone:${normalizeText(record.data.phone)}` : null,
    record?.data?.employeeCode ? `employeeCode:${normalizeText(record.data.employeeCode)}` : null,
    record?.email ? `email:${normalizeEmail(record.email)}` : null,
    record?.phone ? `phone:${normalizeText(record.phone)}` : null,
    record?.employeeCode ? `employeeCode:${normalizeText(record.employeeCode)}` : null,
    record?.employee_code ? `employeeCode:${normalizeText(record.employee_code)}` : null
  ].filter(Boolean);
}

async function lockUploadIdentities(client, record) {
  const keys = [...new Set(uploadIdentityKeysForRecord(record))].sort();
  for (const key of keys) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hr_employee_upload'), hashtext($1))", [key]);
  }
}

function matchingUploadIdentity(identityMap, record) {
  for (const key of uploadIdentityKeysForRecord(record)) {
    const match = identityMap.get(key);
    if (match) return match;
  }
  return null;
}

function rememberUploadIdentity(identityMap, saved, originalRecord = null) {
  const match = {
    record_key: saved.recordKey || saved.record_key,
    source_id: saved.sourceId || saved.source_id
  };
  for (const key of uploadIdentityKeysForRecord(originalRecord)) identityMap.set(key, match);
  for (const key of uploadIdentityKeysForRecord(saved)) identityMap.set(key, match);
  if (saved.recordKey) identityMap.set(`recordKey:${saved.recordKey}`, match);
  if (saved.sourceId) identityMap.set(`sourceId:${saved.sourceId}`, match);
}

function employeeRecordValues(record, importId = null) {
  return [
    record.recordKey,
    record.sourceType,
    record.sourceId,
    record.sourceFile || null,
    record.rowNumber == null ? null : Number(record.rowNumber),
    importId == null ? null : Number(importId),
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

async function upsertEmployeeRecord(client, record, importId = null) {
  const result = await client.query(`
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
      cv_file_name = COALESCE(EXCLUDED.cv_file_name, hr_employee_records.cv_file_name),
      cv_stored_name = COALESCE(EXCLUDED.cv_stored_name, hr_employee_records.cv_stored_name),
      source_created_at = COALESCE(EXCLUDED.source_created_at, hr_employee_records.source_created_at),
      source_updated_at = COALESCE(EXCLUDED.source_updated_at, hr_employee_records.source_updated_at),
      source_payload = EXCLUDED.source_payload,
      archived_at = NULL,
      updated_at = NOW()
    RETURNING ${employeeSelect}, (xmax = 0) AS inserted
  `, employeeRecordValues(record, importId));
  const row = result.rows[0];
  return {
    employee: rowToEmployee(row),
    created: Boolean(row?.inserted),
    recordKey: row?.record_key,
    sourceId: row?.source_id,
    email: row?.email,
    phone: row?.phone,
    employeeCode: row?.employee_code
  };
}

function isDuplicateFailure(row) {
  return (row?.reasons || []).some(reason => /duplicate/i.test(String(reason || "")));
}

async function findMatchingUploadRecords(client, records) {
  const emails = [...new Set(records.map(record => normalizeEmail(record.data?.email)).filter(Boolean))];
  const phones = [...new Set(records.map(record => normalizeText(record.data?.phone)).filter(Boolean))];
  const employeeCodes = [...new Set(records.map(record => normalizeText(record.data?.employeeCode)).filter(Boolean))];
  if (!emails.length && !phones.length && !employeeCodes.length) return new Map();

  const result = await client.query(`
    SELECT record_key, source_id, LOWER(email) AS email, phone, employee_code
    FROM hr_employee_records
    WHERE archived_at IS NULL
      AND (
        (cardinality($1::text[]) > 0 AND LOWER(email) = ANY($1::text[]))
        OR (cardinality($2::text[]) > 0 AND phone = ANY($2::text[]))
        OR (cardinality($3::text[]) > 0 AND employee_code = ANY($3::text[]))
      )
    ORDER BY id
  `, [emails, phones, employeeCodes]);

  const matches = new Map();
  for (const row of result.rows) {
    if (row.email && !matches.has(`email:${row.email}`)) matches.set(`email:${row.email}`, row);
    if (row.phone && !matches.has(`phone:${row.phone}`)) matches.set(`phone:${row.phone}`, row);
    if (row.employee_code && !matches.has(`employeeCode:${row.employee_code}`)) matches.set(`employeeCode:${row.employee_code}`, row);
  }
  return matches;
}

function matchingRecordForUpload(record, matches) {
  const email = normalizeEmail(record.data.email);
  const phone = normalizeText(record.data.phone);
  const employeeCode = normalizeText(record.data.employeeCode);
  return (email && matches.get(`email:${email}`))
    || (phone && matches.get(`phone:${phone}`))
    || (employeeCode && matches.get(`employeeCode:${employeeCode}`))
    || null;
}

async function analyzeUploadedEmployees(records) {
  await requireEmployeeTables();
  const client = await pool.connect();
  const identityMap = new Map();
  try {
    const matches = await findMatchingUploadRecords(client, records);
    let createCount = 0;
    let updateCount = 0;
    const actions = records.map(record => {
      const match = matchingUploadIdentity(identityMap, record) || matchingRecordForUpload(record, matches);
      if (match) updateCount += 1;
      else createCount += 1;
      rememberUploadIdentity(identityMap, match || {
        recordKey: `preview:${uploadSourceId("preview", record)}`,
        sourceId: uploadSourceId("preview", record),
        email: record.data.email,
        phone: record.data.phone,
        employeeCode: record.data.employeeCode
      }, record);
      return {
        rowNumber: record.rowNumber,
        action: match ? "Update" : "Create",
        ...record.data
      };
    });
    return {
      createCount,
      updateCount,
      actions,
      preview: actions.slice(0, 25)
    };
  } finally {
    client.release();
  }
}

function uploadSourceId(source, record) {
  return `${source || "upload"}:${record.rowNumber}:${normalizeEmail(record.data.email)}:${record.data.phone || ""}`;
}

function uploadedEmployeePayload(record, source, existing) {
  const sourceId = uploadSourceId(source, record);
  return {
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
  };
}

async function createUploadImport(client, { source, totalRows, failedRows }) {
  const duplicateRows = failedRows.filter(isDuplicateFailure);
  const invalidRows = failedRows.filter(row => !isDuplicateFailure(row));
  const result = await client.query(`
    INSERT INTO hr_employee_imports
      (source, generated_at, total_rows, imported_rows, skipped_rows, skipped_preview)
    VALUES ($1, NOW(), $2, 0, $3, $4::jsonb)
    RETURNING id
  `, [
    source || "uploaded-employees",
    Number(totalRows || 0),
    failedRows.length,
    JSON.stringify({
      status: "processing",
      failedRows: failedRows.slice(0, 200),
      duplicateRows: duplicateRows.slice(0, 200),
      invalidRows: invalidRows.slice(0, 200),
      duplicateCount: duplicateRows.length,
      invalidCount: invalidRows.length
    })
  ]);
  return result.rows[0].id;
}

async function finalizeUploadImport(client, importId, { summary, failedRows, duplicateRows, invalidRows }) {
  await client.query(`
    UPDATE hr_employee_imports
    SET imported_rows = $2,
        skipped_rows = $3,
        skipped_preview = $4::jsonb
    WHERE id = $1
  `, [
    importId,
    summary.created + summary.updated,
    summary.failed,
    JSON.stringify({
      status: "completed",
      summary,
      failedRows: failedRows.slice(0, 500),
      duplicateRows: duplicateRows.slice(0, 500),
      invalidRows: invalidRows.slice(0, 500),
      duplicateCount: duplicateRows.length,
      invalidCount: invalidRows.length
    })
  ]);
}

async function saveUploadedEmployeesImport({ records, failedRows = [], totalRows = 0, source }) {
  await requireEmployeeTables();
  const client = await pool.connect();
  const summary = {
    totalRows,
    validRows: records.length,
    created: 0,
    updated: 0,
    failed: failedRows.length,
    skipped: failedRows.length,
    duplicates: failedRows.filter(isDuplicateFailure).length,
    duplicateCount: failedRows.filter(isDuplicateFailure).length,
    invalid: failedRows.filter(row => !isDuplicateFailure(row)).length,
    invalidCount: failedRows.filter(row => !isDuplicateFailure(row)).length
  };
  const allFailedRows = [...failedRows];
  const duplicateRows = failedRows.filter(isDuplicateFailure);
  const invalidRows = failedRows.filter(row => !isDuplicateFailure(row));
  const savedRows = [];

  try {
    await client.query("BEGIN");
    const importId = await createUploadImport(client, { source, totalRows, failedRows });
    const identityMap = new Map();

    for (const record of records) {
      await client.query("SAVEPOINT upload_employee_row");
      try {
        await lockUploadIdentities(client, record);
        const existing = matchingUploadIdentity(identityMap, record)
          || await matchingUploadRecord(client, record.data.email, record.data.phone, record.data.employeeCode);
        const saved = await upsertEmployeeRecord(client, uploadedEmployeePayload(record, source, existing), importId);
        if (saved.created) summary.created += 1;
        else summary.updated += 1;
        savedRows.push(saved);
        rememberUploadIdentity(identityMap, saved, record);
        await client.query("RELEASE SAVEPOINT upload_employee_row");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT upload_employee_row").catch(() => {});
        await client.query("RELEASE SAVEPOINT upload_employee_row").catch(() => {});
        summary.failed += 1;
        summary.skipped += 1;
        summary.invalid += 1;
        summary.invalidCount += 1;
        const failed = { rowNumber: record.rowNumber, reasons: [error.message] };
        allFailedRows.push(failed);
        invalidRows.push(failed);
      }
    }

    await finalizeUploadImport(client, importId, { summary, failedRows: allFailedRows, duplicateRows, invalidRows });
    await client.query("COMMIT");
    return { importId, summary, failedRows: allFailedRows, duplicateRows, invalidRows, savedRows };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function saveManualEmployee({ record, body, cv }) {
  await requireEmployeeTables();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const employeeCode = normalizeText(body.employeeCode || body.employee_code);
    const recordKey = normalizeText(body.recordKey || body.record_key);
    const identity = {
      recordKey,
      email: record.email,
      phone: record.phone,
      employeeCode
    };
    await lockUploadIdentities(client, identity);
    const existing = await matchingUploadRecord(client, record.email, record.phone, employeeCode, recordKey);
    const sourceId = existing?.source_id || `manual-${Date.now()}`;
    const saved = await upsertEmployeeRecord(client, {
      recordKey: existing?.record_key || recordKey || `manual:${sourceId}`,
      sourceType: "manual",
      sourceId,
      employeeCode: employeeCode || existing?.employee_code || `EMP-${sourceId}`,
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
    await lockUploadIdentities(client, record);
    const existing = await matchingUploadRecord(client, record.data.email, record.data.phone, record.data.employeeCode);
    const saved = await upsertEmployeeRecord(client, uploadedEmployeePayload(record, source, existing));
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
  analyzeUploadedEmployees,
  saveManualEmployee,
  updateEmployee,
  saveUploadedEmployee,
  saveUploadedEmployeesImport,
  closeEmployeeStore
};
