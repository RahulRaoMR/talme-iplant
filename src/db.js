const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { dbPath } = require("./config");
const { ROLE_DEFINITIONS, PERMISSIONS } = require("./rbac");
const { hashPassword } = require("./security");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");

function now() {
  return new Date().toISOString();
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      domain TEXT,
      status TEXT NOT NULL DEFAULT 'approved',
      subscription_plan TEXT NOT NULL DEFAULT 'Enterprise',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      email_verified INTEGER NOT NULL DEFAULT 0,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      two_factor_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      module TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      company_id INTEGER,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (user_id, role_id, company_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      browser TEXT,
      device TEXT,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, fingerprint),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      refresh_token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      device_id INTEGER,
      ip_address TEXT,
      user_agent TEXT,
      remember_me INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS login_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email TEXT,
      success INTEGER NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      ip_address TEXT,
      device TEXT,
      browser TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      contact TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      channel TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS company_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role_title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      invited_by INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS employee_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      company_id INTEGER,
      employee_code TEXT,
      designation TEXT,
      department TEXT,
      location TEXT,
      keywords TEXT,
      experience REAL,
      current_company TEXT,
      current_designation TEXT,
      cv_file_name TEXT,
      cv_stored_name TEXT,
      manager_id INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
      FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS candidate_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      resume_url TEXT,
      headline TEXT,
      skills TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS candidate_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT NOT NULL UNIQUE,
      location TEXT NOT NULL,
      keywords TEXT NOT NULL,
      experience REAL,
      current_company TEXT,
      current_designation TEXT,
      cv_file_name TEXT,
      cv_stored_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_candidate_records_full_name ON candidate_records(full_name);
    CREATE INDEX IF NOT EXISTS idx_candidate_records_phone ON candidate_records(phone);
    CREATE INDEX IF NOT EXISTS idx_candidate_records_email ON candidate_records(email);
    CREATE INDEX IF NOT EXISTS idx_candidate_records_location ON candidate_records(location);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      metadata TEXT,
      ip_address TEXT,
      device TEXT,
      browser TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  const candidateColumns = db.prepare("PRAGMA table_info(candidate_records)").all().map(column => column.name);
  if (!candidateColumns.includes("cv_file_name")) {
    db.exec("ALTER TABLE candidate_records ADD COLUMN cv_file_name TEXT");
  }
  if (!candidateColumns.includes("cv_stored_name")) {
    db.exec("ALTER TABLE candidate_records ADD COLUMN cv_stored_name TEXT");
  }

  const employeeColumns = db.prepare("PRAGMA table_info(employee_accounts)").all().map(column => column.name);
  for (const [name, type] of [
    ["location", "TEXT"],
    ["keywords", "TEXT"],
    ["experience", "REAL"],
    ["current_company", "TEXT"],
    ["current_designation", "TEXT"],
    ["cv_file_name", "TEXT"],
    ["cv_stored_name", "TEXT"]
  ]) {
    if (!employeeColumns.includes(name)) {
      db.exec(`ALTER TABLE employee_accounts ADD COLUMN ${name} ${type}`);
    }
  }
}

function seedRolesAndPermissions() {
  const insertPermission = db.prepare(`
    INSERT INTO permissions (key, description, module)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET description=excluded.description, module=excluded.module
  `);
  const allPermissions = [
    ...PERMISSIONS,
    { key: "*", description: "All permissions", module: "system" }
  ];
  for (const permission of allPermissions) {
    insertPermission.run(permission.key, permission.description, permission.module);
  }

  const insertRole = db.prepare(`
    INSERT INTO roles (name, slug, description)
    VALUES (?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET name=excluded.name, description=excluded.description
  `);
  const clearRolePermissions = db.prepare("DELETE FROM role_permissions WHERE role_id = ?");
  const insertRolePermission = db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)");
  const roleBySlug = db.prepare("SELECT id FROM roles WHERE slug = ?");
  const permissionByKey = db.prepare("SELECT id FROM permissions WHERE key = ?");

  for (const role of ROLE_DEFINITIONS) {
    insertRole.run(role.name, role.slug, role.description);
    const roleId = roleBySlug.get(role.slug).id;
    clearRolePermissions.run(roleId);
    for (const key of role.permissions) {
      const permission = permissionByKey.get(key);
      if (permission) insertRolePermission.run(roleId, permission.id);
    }
  }
}

function createCompany(name, domain = null) {
  const existing = db.prepare("SELECT * FROM companies WHERE name = ?").get(name);
  if (existing) return existing;
  const created = now();
  const result = db.prepare("INSERT INTO companies (name, domain, created_at) VALUES (?, ?, ?)").run(name, domain, created);
  return db.prepare("SELECT * FROM companies WHERE id = ?").get(result.lastInsertRowid);
}

function createUser({ name, email, phone, password, roleSlug, companyId, emailVerified = true }) {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return existing.id;
  const created = now();
  const result = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, email_verified, phone_verified, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, email, phone || null, hashPassword(password), emailVerified ? 1 : 0, phone ? 1 : 0, created, created);
  const userId = Number(result.lastInsertRowid);
  assignRole(userId, roleSlug, companyId);
  return userId;
}

function assignRole(userId, roleSlug, companyId = null) {
  const role = db.prepare("SELECT id FROM roles WHERE slug = ?").get(roleSlug);
  if (!role) throw new Error(`Unknown role: ${roleSlug}`);
  db.prepare(`
    INSERT OR IGNORE INTO user_roles (user_id, role_id, company_id, assigned_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, role.id, companyId, now());
}

function seedDemoUsers() {
  const count = db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
  if (count > 0) return;

  const talme = createCompany("Talme Technologies", "talme.test");
  const acme = createCompany("Acme Talent Labs", "acme.test");
  const password = "Password123!";

  const users = [
    ["Candidate One", "candidate@talme.test", "9000000001", "candidate", null],
    ["Employer One", "employer@talme.test", "9000000002", "employer", acme.id],
    ["Recruiter One", "recruiter@talme.test", "9000000003", "recruiter", acme.id],
    ["Employee One", "employee@talme.test", "9000000004", "employee", acme.id],
    ["HR Manager One", "hr@talme.test", "9000000005", "hr_manager", acme.id],
    ["Company Admin One", "company.admin@talme.test", "9000000006", "company_admin", acme.id],
    ["Platform Admin One", "platform.admin@talme.test", "9000000007", "platform_admin", talme.id],
    ["Super Admin One", "super.admin@talme.test", "9000000008", "super_admin", talme.id]
  ];

  for (const [name, email, phone, roleSlug, companyId] of users) {
    const userId = createUser({ name, email, phone, password, roleSlug, companyId });
    if (roleSlug === "candidate") {
      db.prepare(`
        INSERT OR IGNORE INTO candidate_accounts (user_id, headline, skills, created_at)
        VALUES (?, ?, ?, ?)
      `).run(userId, "Product-minded frontend engineer", "React, Node, SQL", now());
    }
    if (companyId) {
      db.prepare(`
        INSERT INTO company_users (company_id, user_id, role_title, status, created_at)
        VALUES (?, ?, ?, 'active', ?)
      `).run(companyId, userId, roleSlug.replaceAll("_", " "), now());
      if (["employee", "hr_manager", "company_admin"].includes(roleSlug)) {
        db.prepare(`
          INSERT OR IGNORE INTO employee_accounts (user_id, company_id, employee_code, designation, department, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, companyId, `EMP-${userId}`, roleSlug.replaceAll("_", " "), "People Operations", now());
      }
    }
  }
}

function ensureConfiguredAdmin() {
  const talme = createCompany("Talme Technologies", "talme.test");
  const email = "saidarshaan@talme.in";
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    db.prepare(`
      UPDATE users
      SET name = ?, password_hash = ?, status = 'active', email_verified = 1, updated_at = ?
      WHERE id = ?
    `).run("Saidarshaan", hashPassword("talme123"), now(), existing.id);
    assignRole(existing.id, "super_admin", talme.id);
    return;
  }

  createUser({
    name: "Saidarshaan",
    email,
    phone: "9000000099",
    password: "talme123",
    roleSlug: "super_admin",
    companyId: talme.id,
    emailVerified: true
  });
}

function initDb() {
  migrate();
  seedRolesAndPermissions();
  seedDemoUsers();
  ensureConfiguredAdmin();
}

module.exports = {
  db,
  now,
  initDb,
  createCompany,
  createUser,
  assignRole
};
