const path = require("node:path");
const crypto = require("node:crypto");
const xlsx = require("xlsx");
const { db, initDb, createCompany, assignRole, now } = require("../src/db");
const { hashPassword } = require("../src/security");

initDb();

const args = process.argv.slice(2);
const onlyPhoneOnly = args[0] === "--phone-only";
const files = onlyPhoneOnly ? args.slice(1) : args;
if (!files.length) {
  console.error("Usage: node scripts/import-local-employees.js <file.xlsx> [more.xlsx...]");
  process.exit(1);
}

const passwordHash = hashPassword(crypto.randomBytes(24).toString("base64url"));
const companyId = createCompany("Talme Technologies", "talme.test").id;

function cell(value) {
  return value == null ? "" : String(value).trim();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell(value));
}

function extractEmail(value) {
  return cell(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || "";
}

function normalizePhone(value) {
  const candidates = cell(value).match(/\+?\d[\d\s-]{6,}\d/g) || [];
  for (const candidate of candidates.length ? candidates : [cell(value)]) {
    let phone = candidate.replace(/[^\d+]/g, "");
    if (phone.startsWith("+91")) phone = phone.slice(3);
    if (phone.startsWith("91") && phone.length === 12) phone = phone.slice(2);
    phone = phone.replace(/\D/g, "");
    if (phone.length >= 7 && phone.length <= 15) return phone;
  }
  return "";
}

function parseExperience(value) {
  const text = cell(value);
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?|yr|y)(?:\s*(\d+(?:\.\d+)?)\s*(?:months?|mos?|m))?/i);
  if (!match) return null;
  return Number((Number(match[1]) + Number(match[2] || 0) / 12).toFixed(1));
}

function looksLikeStatus(value) {
  return /not looking|joined|cv not updated|serving notice|notice period|profile/i.test(cell(value));
}

function normalizeName(value, email) {
  let name = cell(value).replace(/\s+/g, " ");
  if (!name || isEmail(name) || normalizePhone(name) || /^name$/i.test(name)) {
    name = cell(email).split("@")[0].replace(/[._-]+/g, " ");
  }
  if (name.includes(",")) {
    const parts = name.split(",").map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) name = `${parts.slice(1).join(" ")} ${parts[0]}`;
  }
  return name.replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalizeKeywords(value) {
  return cell(value)
    .replace(/\s*IT Skills Details\s*$/i, "")
    .split(/[,;\n]/)
    .map(part => part.trim())
    .filter(Boolean)
    .join(", ");
}

function parseLocationFromMixed(value) {
  let text = cell(value);
  if (!text) return "";
  text = text.replace(/^\d+(?:\.\d+)?\s*(?:years?|yrs?|yr|y)(?:\s*\d+(?:\.\d+)?\s*(?:months?|mos?|m))?/i, "");
  text = text.replace(/\b\d+(?:\.\d+)?\s*Lac\(s\)/ig, "");
  text = text.replace(/\bPref\b.*$/i, "");
  text = text.replace(/\s+/g, " ").trim();
  if (!text || looksLikeStatus(text) || text.length > 70 || text.includes("@")) return "";
  return text;
}

function parseRow(row, rowNumber, source) {
  const values = row.map(cell);
  if (values.every(value => !value)) return null;
  const emailIndex = values.findIndex(value => extractEmail(value));
  const phoneIndex = values.findIndex((value, index) => index !== emailIndex && normalizePhone(value));
  if (emailIndex < 0 && phoneIndex < 0) return null;

  const extractedEmail = emailIndex >= 0 ? extractEmail(values[emailIndex]) : "";
  const phone = phoneIndex >= 0 ? normalizePhone(values[phoneIndex]) : "";
  const email = extractedEmail || `local-import-${phone || source.replace(/[^a-z0-9]/gi, "-")}-${rowNumber}@talme.local`.toLowerCase();
  const beforePhone = phoneIndex > 0 ? values[phoneIndex - 1] : "";
  const nameCandidate = beforePhone && !/^\d+$/.test(beforePhone) && !looksLikeStatus(beforePhone)
    ? beforePhone
    : values.find((value, index) => (
      index !== emailIndex &&
      index !== phoneIndex &&
      value &&
      !/^\d+$/.test(value) &&
      !extractEmail(value) &&
      !normalizePhone(value) &&
      !looksLikeStatus(value)
    )) || values[0];
  const name = normalizeName(nameCandidate, email);
  const experience = values.map(parseExperience).find(value => value != null) ?? null;
  const location = values.map(parseLocationFromMixed).find(value => value && !value.includes(",")) || "";
  const keywords = values
    .filter((value, index) => index !== emailIndex && index !== phoneIndex && value !== nameCandidate)
    .map(normalizeKeywords)
    .filter(value => value && !isEmail(value) && !normalizePhone(value) && !looksLikeStatus(value) && (value.includes(",") || value.length > 20))
    .sort((a, b) => b.length - a.length)[0] || "";

  return { source, rowNumber, name, email, phone, location, keywords, experience, hasRealEmail: Boolean(extractedEmail) };
}

const statements = {
  userByEmail: db.prepare("SELECT * FROM users WHERE lower(email)=lower(?)"),
  userByPhone: db.prepare("SELECT * FROM users WHERE phone=?"),
  updateUser: db.prepare(`
    UPDATE users
    SET name=?, phone=COALESCE(?, phone), phone_verified=CASE WHEN ? IS NULL THEN phone_verified ELSE 1 END, updated_at=?
    WHERE id=?
  `),
  insertUser: db.prepare(`
    INSERT INTO users (name,email,phone,password_hash,status,email_verified,phone_verified,created_at,updated_at)
    VALUES (?,?,?,?, 'active', 1, ?, ?, ?)
  `),
  companyUser: db.prepare("SELECT id FROM company_users WHERE company_id=? AND user_id=? LIMIT 1"),
  insertCompanyUser: db.prepare(`
    INSERT INTO company_users (company_id,user_id,role_title,status,invited_by,created_at)
    VALUES (?,?,'employee','active',NULL,?)
  `),
  employeeByUser: db.prepare("SELECT * FROM employee_accounts WHERE user_id=?"),
  updateEmployee: db.prepare(`
    UPDATE employee_accounts
    SET company_id=?, employee_code=?, designation=?, department=?, location=COALESCE(NULLIF(?, ''), location),
        keywords=COALESCE(NULLIF(?, ''), keywords), experience=COALESCE(?, experience), current_designation=?
    WHERE user_id=?
  `),
  insertEmployee: db.prepare(`
    INSERT INTO employee_accounts (user_id,company_id,employee_code,designation,department,location,keywords,experience,current_company,current_designation,created_at)
    VALUES (?,?,?,?,?,?,?,?,NULL,?,?)
  `),
  countEmployees: db.prepare("SELECT COUNT(*) AS n FROM employee_accounts")
};

function ensureCompanyUser(userId) {
  const existing = statements.companyUser.get(companyId, userId);
  if (!existing) statements.insertCompanyUser.run(companyId, userId, now());
}

function upsert(record) {
  const existing = statements.userByEmail.get(record.email);
  const phoneUser = record.phone ? statements.userByPhone.get(record.phone) : null;
  const safePhone = phoneUser && (!existing || phoneUser.id !== existing.id) ? null : (record.phone || null);
  let userId;
  let created = false;

  if (existing) {
    userId = existing.id;
    statements.updateUser.run(record.name, safePhone, safePhone, now(), userId);
  } else {
    const result = statements.insertUser.run(record.name, record.email, safePhone, passwordHash, safePhone ? 1 : 0, now(), now());
    userId = Number(result.lastInsertRowid);
    created = true;
  }

  assignRole(userId, "employee", companyId);
  ensureCompanyUser(userId);

  const employee = statements.employeeByUser.get(userId);
  const employeeCode = (employee?.employee_code || String(userId).padStart(5, "0")).replace(/\D/g, "").padStart(5, "0");
  const designation = "Employee";
  const department = record.location || "General";
  if (employee) {
    statements.updateEmployee.run(
      companyId,
      employeeCode,
      designation,
      department,
      record.location,
      record.keywords,
      record.experience,
      designation,
      userId
    );
    return created ? "created" : "updated";
  }

  statements.insertEmployee.run(
    userId,
    companyId,
    employeeCode,
    designation,
    department,
    record.location,
    record.keywords,
    record.experience,
    designation,
    now()
  );
  return "created";
}

const summary = { files: 0, rows: 0, parsed: 0, created: 0, updated: 0, skipped: 0, failed: 0, perFile: [] };
db.exec("BEGIN");
try {
  for (const file of files) {
    const workbook = xlsx.readFile(file);
    const fileSummary = { file: path.basename(file), rows: 0, parsed: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
    for (const sheetName of workbook.SheetNames) {
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: false });
      rows.forEach((row, index) => {
        fileSummary.rows += 1;
        summary.rows += 1;
        const record = parseRow(row, index + 1, `${path.basename(file)}:${sheetName}`);
        if (!record) {
          fileSummary.skipped += 1;
          summary.skipped += 1;
          return;
        }
        if (onlyPhoneOnly && record.hasRealEmail) {
          fileSummary.skipped += 1;
          summary.skipped += 1;
          return;
        }
        fileSummary.parsed += 1;
        summary.parsed += 1;
        try {
          const result = upsert(record);
          fileSummary[result] += 1;
          summary[result] += 1;
        } catch {
          fileSummary.failed += 1;
          summary.failed += 1;
        }
      });
    }
    summary.files += 1;
    summary.perFile.push(fileSummary);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

summary.employeeCount = statements.countEmployees.get().n;
console.log(JSON.stringify(summary, null, 2));
