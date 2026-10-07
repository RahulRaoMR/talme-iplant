const { Pool } = require("pg");
const { loadLocalEnv } = require("./load-env");
const { employeeFilters, employeeFilterSql, employeeOrderSql } = require("./employee-search");

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
        to_regclass('public.hr_employee_imports') IS NOT NULL AS has_imports,
        to_regclass('public.hr_employee_resumes') IS NOT NULL AS has_resumes,
        to_regclass('public.skills') IS NOT NULL AS has_skills,
        to_regclass('public.employee_skills') IS NOT NULL AS has_employee_skills
    `).then(result => Boolean(
      result.rows[0]?.has_records
      && result.rows[0]?.has_imports
      && result.rows[0]?.has_resumes
      && result.rows[0]?.has_skills
      && result.rows[0]?.has_employee_skills
    ));
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
    record_db_id: row.id == null ? null : Number(row.id),
    employee_code: row.employee_code,
    name: row.name,
    status: row.status,
    createdAt: row.source_created_at || row.created_at,
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
    resume_s3_key: row.resume_s3_key,
    latest_resume: row.resume_id ? {
      id: Number(row.resume_id),
      file_name: row.resume_file_name,
      file_path: row.resume_file_path,
      file_url: row.resume_file_url,
      storage_provider: row.resume_storage_provider,
      uploaded_at: row.resume_uploaded_at
    } : null,
    skills: Array.isArray(row.skills) ? row.skills.filter(Boolean) : [],
    matched_skills: Array.isArray(row.matched_skills) ? row.matched_skills.filter(Boolean) : [],
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
  resume_s3_key, source_created_at, source_updated_at, created_at, updated_at
`;

const employeeSearchSelect = `
  e.id, e.record_key, e.source_type, e.source_id, e.source_file, e.row_number,
  e.import_id, e.local_user_id, e.local_employee_account_id, e.local_company_id, e.local_role_id,
  e.local_role_company_id, e.employee_code, e.name, e.email, e.phone, e.status,
  e.email_verified, e.phone_verified, e.designation, e.department, e.location, e.keywords,
  e.experience, e.current_company, e.current_designation, e.cv_file_name, e.cv_stored_name,
  e.resume_s3_key, e.source_created_at, e.source_updated_at, e.created_at, e.updated_at,
  latest_resume.id AS resume_id,
  latest_resume.file_name AS resume_file_name,
  latest_resume.file_path AS resume_file_path,
  latest_resume.file_url AS resume_file_url,
  latest_resume.storage_provider AS resume_storage_provider,
  latest_resume.uploaded_at AS resume_uploaded_at,
  COALESCE(skill_set.skills, ARRAY[]::text[]) AS skills
`;

function parsePagination(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
}

function normalizeSkillName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ");
}

function skillNamesFromKeywords(keywords) {
  return [...new Set(
    String(keywords || "")
      .split(/[,\n;|/]+/)
      .map(normalizeSkillName)
      .filter(Boolean)
  )];
}

function searchTerms(query) {
  const normalized = normalizeSkillName(query);
  const parts = normalized.split(/\s+/).filter(Boolean);
  return [...new Set([normalized, ...parts].filter(Boolean))];
}

async function replaceEmployeeSkills(client, employeeRecordId, resumeId, keywords) {
  if (!employeeRecordId) return;
  const names = skillNamesFromKeywords(keywords);
  await client.query("DELETE FROM employee_skills WHERE employee_record_id = $1", [employeeRecordId]);
  if (!names.length) return;

  const skillResult = await client.query(`
    INSERT INTO skills (skill_name, normalized_name)
    SELECT initcap(value), value
    FROM unnest($1::text[]) AS value
    ON CONFLICT (normalized_name) DO UPDATE SET skill_name = EXCLUDED.skill_name
    RETURNING id, normalized_name
  `, [names]);
  const skillIds = new Map(skillResult.rows.map(row => [row.normalized_name, row.id]));

  for (const name of names) {
    const skillId = skillIds.get(name);
    if (!skillId) continue;
    await client.query(`
      INSERT INTO employee_skills (employee_record_id, skill_id, resume_id)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `, [employeeRecordId, skillId, resumeId || null]);
  }
}

async function upsertLatestResume(client, employeeRecordId, cv) {
  if (!employeeRecordId || (!cv?.cvFileName && !cv?.cvStoredName && !cv?.extractedText)) return null;
  await client.query(`
    UPDATE hr_employee_resumes
    SET is_latest = FALSE, updated_at = NOW()
    WHERE employee_record_id = $1 AND is_latest = TRUE
  `, [employeeRecordId]);
  const result = await client.query(`
    INSERT INTO hr_employee_resumes (
      employee_record_id, file_name, file_path, storage_provider, storage_key,
      extracted_text, is_latest, uploaded_at
    )
    VALUES ($1, $2, $3, 'local', $3, $4, TRUE, NOW())
    RETURNING id
  `, [
    employeeRecordId,
    normalizeText(cv.cvFileName),
    normalizeText(cv.cvStoredName),
    normalizeText(cv.extractedText)
  ]);
  return result.rows[0]?.id || null;
}

async function latestResumeId(client, employeeRecordId) {
  const result = await client.query(`
    SELECT id
    FROM hr_employee_resumes
    WHERE employee_record_id = $1 AND is_latest = TRUE
    ORDER BY uploaded_at DESC, id DESC
    LIMIT 1
  `, [employeeRecordId]);
  return result.rows[0]?.id || null;
}

async function searchEmployees(query = {}) {
  await requireEmployeeTables();
  const { page, limit, offset } = parsePagination(query);
  const q = normalizeText(query.q || query.search || query.keyword) || "";
  const like = `%${q.toLowerCase()}%`;
  const terms = searchTerms(q);
  const where = ["e.archived_at IS NULL"];
  const params = [q, like, terms, limit, offset];
  const filters = employeeFilters(query);
  where.push(...employeeFilterSql(filters, params));

  if (q) {
    where.push(`(
      to_tsvector('simple', concat_ws(' ', e.name, e.email, e.phone, e.employee_code, e.designation, e.department, e.location, e.keywords, e.current_company, e.current_designation)) @@ websearch_to_tsquery('simple', $1)
      OR latest_resume.search_vector @@ websearch_to_tsquery('english', $1)
      OR LOWER(concat_ws(' ', e.name, e.email, e.phone, e.employee_code, e.designation, e.department, e.location, e.keywords, e.current_company, e.current_designation)) LIKE $2
      OR EXISTS (
        SELECT 1
        FROM employee_skills employee_skill_match
        JOIN skills skill_match ON skill_match.id = employee_skill_match.skill_id
        WHERE employee_skill_match.employee_record_id = e.id
          AND (skill_match.normalized_name = ANY($3::text[]) OR skill_match.normalized_name ILIKE $2)
      )
    )`);
  }

  const result = await pool.query(`
    SELECT ${employeeSearchSelect},
      COALESCE(skill_set.matched_skills, ARRAY[]::text[]) AS matched_skills,
      COUNT(*) OVER() AS total_count,
      CASE WHEN $1 <> '' THEN
        ts_rank_cd(
          to_tsvector('simple', concat_ws(' ', e.name, e.email, e.phone, e.employee_code, e.designation, e.department, e.location, e.keywords, e.current_company, e.current_designation)),
          websearch_to_tsquery('simple', $1)
        )
        + COALESCE(ts_rank_cd(latest_resume.search_vector, websearch_to_tsquery('english', $1)), 0)
      ELSE 0 END AS search_rank
    FROM hr_employee_records e
    LEFT JOIN LATERAL (
      SELECT resume.*
      FROM hr_employee_resumes resume
      WHERE resume.employee_record_id = e.id AND resume.is_latest = TRUE
      ORDER BY resume.uploaded_at DESC, resume.id DESC
      LIMIT 1
    ) latest_resume ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(array_agg(DISTINCT skill.skill_name) FILTER (WHERE skill.skill_name IS NOT NULL), ARRAY[]::text[]) AS skills,
        COALESCE(
          array_agg(DISTINCT skill.skill_name) FILTER (
            WHERE $1 <> ''
              AND skill.skill_name IS NOT NULL
              AND (skill.normalized_name = ANY($3::text[]) OR skill.normalized_name ILIKE $2)
          ),
          ARRAY[]::text[]
        ) AS matched_skills
      FROM employee_skills employee_skill
      JOIN skills skill ON skill.id = employee_skill.skill_id
      WHERE employee_skill.employee_record_id = e.id
        AND (employee_skill.resume_id IS NULL OR latest_resume.id IS NULL OR employee_skill.resume_id = latest_resume.id)
    ) skill_set ON TRUE
    WHERE ${where.join(" AND ")}
    ORDER BY ${employeeOrderSql(filters.sort)}
    LIMIT $4 OFFSET $5
  `, params);

  const total = Number(result.rows[0]?.total_count || 0);
  return {
    items: result.rows.map(rowToEmployee),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

async function listEmployeeLocations() {
  await requireEmployeeTables();
  const result = await pool.query(`
    SELECT MIN(BTRIM(location)) AS value, COUNT(*)::int AS count
    FROM hr_employee_records
    WHERE archived_at IS NULL AND NULLIF(BTRIM(location), '') IS NOT NULL
    GROUP BY LOWER(BTRIM(location))
    ORDER BY LOWER(MIN(BTRIM(location)))
  `);
  return result.rows;
}

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
    SELECT ${employeeSearchSelect}
    FROM hr_employee_records e
    LEFT JOIN LATERAL (
      SELECT resume.* FROM hr_employee_resumes resume
      WHERE resume.employee_record_id = e.id AND resume.is_latest = TRUE
      ORDER BY resume.uploaded_at DESC, resume.id DESC LIMIT 1
    ) latest_resume ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT skill.skill_name) AS skills
      FROM employee_skills employee_skill JOIN skills skill ON skill.id = employee_skill.skill_id
      WHERE employee_skill.employee_record_id = e.id
    ) skill_set ON TRUE
    WHERE e.archived_at IS NULL
      AND (
        e.source_id = $1
        OR e.employee_code = $1
        OR LOWER(e.email) = LOWER($1)
        OR e.phone = $1
      )
    ORDER BY CASE WHEN e.source_id = $1 THEN 0 ELSE 1 END, e.id
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
    recordId: row?.id,
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

async function saveUploadedEmployeesImport({ records, failedRows = [], totalRows = 0, source, skipExisting = false }) {
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
        if (existing && skipExisting) {
          const duplicate = { rowNumber: record.rowNumber, reasons: ["Duplicate already present in portal; existing record left unchanged"] };
          allFailedRows.push(duplicate);
          duplicateRows.push(duplicate);
          summary.failed += 1;
          summary.skipped += 1;
          summary.duplicates += 1;
          summary.duplicateCount += 1;
          await client.query("RELEASE SAVEPOINT upload_employee_row");
          continue;
        }
        const saved = await upsertEmployeeRecord(client, uploadedEmployeePayload(record, source, existing), importId);
        await replaceEmployeeSkills(client, saved.recordId, await latestResumeId(client, saved.recordId), record.data.keywords);
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
    const resumeId = await upsertLatestResume(client, saved.recordId, cv) || await latestResumeId(client, saved.recordId);
    await replaceEmployeeSkills(client, saved.recordId, resumeId, record.keywords);
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
    const updatedRow = result.rows[0];
    const resumeId = await upsertLatestResume(client, updatedRow.id, cv) || await latestResumeId(client, updatedRow.id);
    await replaceEmployeeSkills(client, updatedRow.id, resumeId, updatedRow.keywords);
    await client.query("COMMIT");
    return rowToEmployee(updatedRow);
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
    await replaceEmployeeSkills(client, saved.recordId, await latestResumeId(client, saved.recordId), record.data.keywords);
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
  searchEmployees,
  listEmployeeLocations,
  publicProfileCount,
  findEmployeeByIdentifier,
  analyzeUploadedEmployees,
  saveManualEmployee,
  updateEmployee,
  saveUploadedEmployee,
  saveUploadedEmployeesImport,
  closeEmployeeStore
};
