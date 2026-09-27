const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const outputPath = path.resolve(process.argv[2] || path.join(__dirname, "..", "tmp", "synthetic-production-db-export.json"));
const now = new Date().toISOString();

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function table(columns, primaryKey, rows) {
  return {
    exists: true,
    columns: columns.map(column => ({ column_name: column.name, data_type: column.type, is_nullable: column.nullable ? "YES" : "NO", column_default: column.default || null })),
    primaryKey,
    summary: { total_rows: rows.length },
    rows
  };
}

function fakeAuthUsers() {
  return [
    ["Test HR Admin", "test.hr.admin@example.invalid", "9000000001", "super_admin"],
    ["Test HR Manager", "test.hr.manager@example.invalid", "9000000002", "hr_manager"],
    ["Test Recruiter", "test.recruiter@example.invalid", "9000000003", "recruiter"],
    ["Test Employee One", "test.employee.one@example.invalid", "9000000004", "employee"],
    ["Test Employee Two", "test.employee.two@example.invalid", "9000000005", "employee"]
  ].map(([full_name, email, phone, role], index) => ({
    id: index + 1,
    full_name,
    email,
    phone,
    password_hash: "$2b$12$synthetic.hash.not.for.login.tests.only",
    role,
    created_at: now,
    updated_at: now,
    is_active: true
  }));
}

function fakeEmployees(importId) {
  return Array.from({ length: 10 }, (_, index) => {
    const n = index + 1;
    return {
      id: n,
      record_key: `synthetic:employee:${String(n).padStart(3, "0")}`,
      source_type: n <= 2 ? "upload" : "manual",
      source_id: `synthetic-${n}`,
      source_file: "synthetic-test-upload.csv",
      row_number: n,
      import_id: n <= 7 ? importId : null,
      local_user_id: null,
      local_employee_account_id: null,
      local_company_id: null,
      local_role_id: null,
      local_role_company_id: null,
      local_role_assigned_at: null,
      employee_code: `TEST-${String(n).padStart(4, "0")}`,
      name: `Synthetic Employee ${n}`,
      email: `synthetic.employee.${n}@example.invalid`,
      phone: `91000000${String(n).padStart(2, "0")}`,
      status: "active",
      email_verified: true,
      phone_verified: true,
      designation: "Test Employee",
      department: n % 2 ? "Testing" : "Quality",
      location: "Test City",
      keywords: "synthetic,test,aws",
      experience: n % 5,
      current_company: "Talme Test",
      current_designation: "Test Employee",
      cv_file_name: null,
      cv_stored_name: null,
      resume_s3_key: null,
      source_created_at: now,
      source_updated_at: now,
      source_payload: { synthetic: true, rowNumber: n },
      created_at: now,
      updated_at: now,
      archived_at: null
    };
  });
}

const authUsers = fakeAuthUsers();
const authSessions = authUsers.slice(0, 2).map((user, index) => ({
  id: index + 1,
  session_key: `synthetic-session-${index + 1}`,
  email: user.email,
  role: user.role,
  refresh_token_hash: sha256(`refresh-${index + 1}`),
  csrf_token: `csrf-${index + 1}`,
  remember_me: false,
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  last_seen_at: now,
  revoked_at: null,
  ip_address: "127.0.0.1",
  user_agent: "synthetic-test",
  created_at: now
}));

const authOtps = [{
  id: 1,
  auth_user_id: 2,
  email: authUsers[1].email,
  otp_hash: sha256("000000"),
  reset_token_hash: null,
  expires_at: new Date(Date.now() + 900000).toISOString(),
  reset_expires_at: null,
  verified_at: null,
  used_at: null,
  attempt_count: 0,
  request_ip: "127.0.0.1",
  user_agent: "synthetic-test",
  created_at: now
}];

const importRows = [{
  id: 1,
  source: "synthetic-test-upload.csv",
  generated_at: now,
  total_rows: 15,
  imported_rows: 10,
  skipped_rows: 5,
  skipped_preview: {
    duplicateRows: [11, 12, 13],
    invalidRows: [14, 15],
    note: "Synthetic duplicate and invalid rows only"
  },
  created_at: now
}];

const employees = fakeEmployees(1);
const audits = employees.slice(0, 5).map(employee => ({
  record_key: employee.record_key,
  employee_user_id: employee.id,
  employee_email: employee.email,
  employee_phone: employee.phone,
  created_by_auth_user_id: 2,
  created_by_name: "Test HR Manager",
  created_by_email: "test.hr.manager@example.invalid",
  created_at: now,
  last_edited_by_auth_user_id: 2,
  last_edited_by_name: "Test HR Manager",
  last_edited_by_email: "test.hr.manager@example.invalid",
  last_edited_at: now,
  last_action: "created"
}));

const candidates = [{
  id: "synthetic-candidate-1",
  fullName: "Synthetic Candidate One",
  email: "synthetic.candidate.1@example.invalid",
  phone: "9200000001",
  location: "Test City",
  keywords: "synthetic,candidate",
  experience: 3,
  currentCompany: "Talme Test",
  currentDesignation: "Synthetic Candidate",
  resumeUrl: null,
  profileImage: null,
  createdAt: now,
  updatedAt: now
}];

const payload = {
  exportedAt: now,
  source: "synthetic",
  tables: {
    Candidate: table([
      { name: "id", type: "text" },
      { name: "fullName", type: "text" },
      { name: "email", type: "text", nullable: true },
      { name: "phone", type: "text" },
      { name: "location", type: "text" },
      { name: "keywords", type: "text" },
      { name: "experience", type: "double precision", nullable: true },
      { name: "currentCompany", type: "text", nullable: true },
      { name: "currentDesignation", type: "text", nullable: true },
      { name: "resumeUrl", type: "text", nullable: true },
      { name: "profileImage", type: "text", nullable: true },
      { name: "createdAt", type: "timestamp without time zone" },
      { name: "updatedAt", type: "timestamp without time zone" }
    ], ["id"], candidates),
    auth_users: table([
      { name: "id", type: "bigint" },
      { name: "full_name", type: "text" },
      { name: "email", type: "text" },
      { name: "phone", type: "text" },
      { name: "password_hash", type: "text" },
      { name: "role", type: "text" },
      { name: "created_at", type: "timestamp with time zone" },
      { name: "updated_at", type: "timestamp with time zone" },
      { name: "is_active", type: "boolean" }
    ], ["id"], authUsers),
    auth_sessions: table([
      { name: "id", type: "bigint" },
      { name: "session_key", type: "text" },
      { name: "email", type: "text" },
      { name: "role", type: "text", nullable: true },
      { name: "refresh_token_hash", type: "text" },
      { name: "csrf_token", type: "text" },
      { name: "remember_me", type: "boolean" },
      { name: "expires_at", type: "timestamp with time zone" },
      { name: "last_seen_at", type: "timestamp with time zone" },
      { name: "revoked_at", type: "timestamp with time zone", nullable: true },
      { name: "ip_address", type: "text", nullable: true },
      { name: "user_agent", type: "text", nullable: true },
      { name: "created_at", type: "timestamp with time zone" }
    ], ["id"], authSessions),
    auth_password_otps: table([
      { name: "id", type: "bigint" },
      { name: "auth_user_id", type: "bigint" },
      { name: "email", type: "text" },
      { name: "otp_hash", type: "text" },
      { name: "reset_token_hash", type: "text", nullable: true },
      { name: "expires_at", type: "timestamp with time zone" },
      { name: "reset_expires_at", type: "timestamp with time zone", nullable: true },
      { name: "verified_at", type: "timestamp with time zone", nullable: true },
      { name: "used_at", type: "timestamp with time zone", nullable: true },
      { name: "attempt_count", type: "integer" },
      { name: "request_ip", type: "text", nullable: true },
      { name: "user_agent", type: "text", nullable: true },
      { name: "created_at", type: "timestamp with time zone" }
    ], ["id"], authOtps),
    employee_record_audits: table([
      { name: "record_key", type: "text" },
      { name: "employee_user_id", type: "text", nullable: true },
      { name: "employee_email", type: "text", nullable: true },
      { name: "employee_phone", type: "text", nullable: true },
      { name: "created_by_auth_user_id", type: "bigint", nullable: true },
      { name: "created_by_name", type: "text" },
      { name: "created_by_email", type: "text", nullable: true },
      { name: "created_at", type: "timestamp with time zone" },
      { name: "last_edited_by_auth_user_id", type: "bigint", nullable: true },
      { name: "last_edited_by_name", type: "text" },
      { name: "last_edited_by_email", type: "text", nullable: true },
      { name: "last_edited_at", type: "timestamp with time zone" },
      { name: "last_action", type: "text" }
    ], ["record_key"], audits),
    hr_employee_imports: table([
      { name: "id", type: "bigint" },
      { name: "source", type: "text" },
      { name: "generated_at", type: "timestamp with time zone", nullable: true },
      { name: "total_rows", type: "integer" },
      { name: "imported_rows", type: "integer" },
      { name: "skipped_rows", type: "integer" },
      { name: "skipped_preview", type: "jsonb", nullable: true },
      { name: "created_at", type: "timestamp with time zone" }
    ], ["id"], importRows),
    hr_employee_records: table([
      { name: "id", type: "bigint" },
      { name: "record_key", type: "text" },
      { name: "source_type", type: "text" },
      { name: "source_id", type: "text", nullable: true },
      { name: "source_file", type: "text", nullable: true },
      { name: "row_number", type: "integer", nullable: true },
      { name: "import_id", type: "bigint", nullable: true },
      { name: "local_user_id", type: "bigint", nullable: true },
      { name: "local_employee_account_id", type: "bigint", nullable: true },
      { name: "local_company_id", type: "bigint", nullable: true },
      { name: "local_role_id", type: "bigint", nullable: true },
      { name: "local_role_company_id", type: "bigint", nullable: true },
      { name: "local_role_assigned_at", type: "timestamp with time zone", nullable: true },
      { name: "employee_code", type: "text", nullable: true },
      { name: "name", type: "text" },
      { name: "email", type: "text", nullable: true },
      { name: "phone", type: "text", nullable: true },
      { name: "status", type: "text" },
      { name: "email_verified", type: "boolean", nullable: true },
      { name: "phone_verified", type: "boolean", nullable: true },
      { name: "designation", type: "text", nullable: true },
      { name: "department", type: "text", nullable: true },
      { name: "location", type: "text", nullable: true },
      { name: "keywords", type: "text", nullable: true },
      { name: "experience", type: "double precision", nullable: true },
      { name: "current_company", type: "text", nullable: true },
      { name: "current_designation", type: "text", nullable: true },
      { name: "cv_file_name", type: "text", nullable: true },
      { name: "cv_stored_name", type: "text", nullable: true },
      { name: "resume_s3_key", type: "text", nullable: true },
      { name: "source_created_at", type: "timestamp with time zone", nullable: true },
      { name: "source_updated_at", type: "timestamp with time zone", nullable: true },
      { name: "source_payload", type: "jsonb", nullable: true },
      { name: "created_at", type: "timestamp with time zone" },
      { name: "updated_at", type: "timestamp with time zone" },
      { name: "archived_at", type: "timestamp with time zone", nullable: true }
    ], ["id"], employees)
  }
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  tables: Object.fromEntries(Object.entries(payload.tables).map(([name, value]) => [name, value.rows.length])),
  syntheticOnly: true
}, null, 2));
