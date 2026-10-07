const bcrypt = require("bcrypt");
const { Pool } = require("pg");
const { loadLocalEnv } = require("./load-env");
const { isApprovedAccount, registrationAccessMessage } = require("./registration-policy");
const { sessionTimeoutSeconds } = require("./config");

loadLocalEnv();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined
    })
  : null;
let nextSecurityCleanup = 0;

function hasPostgresAuth() {
  return Boolean(pool);
}

async function ensureAuthSchema() {
  if (!pool) return false;
  return true;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeRole(role) {
  return String(role || "").trim();
}

async function getSecurityLimit(key, maximum) {
  if (!pool) throw Object.assign(new Error("Authentication database is not configured."), { statusCode: 503 });
  const result = await pool.query(`SELECT CASE WHEN attempts >= $2 AND expires_at > NOW()
    THEN CEIL(EXTRACT(EPOCH FROM expires_at - NOW()))::int ELSE 0 END AS retry_after
    FROM auth_security_limits WHERE key = $1`, [key, maximum]);
  return Number(result.rows[0]?.retry_after || 0);
}

async function consumeSecurityLimit(key, maximum, windowSeconds) {
  if (!pool) throw Object.assign(new Error("Authentication database is not configured."), { statusCode: 503 });
  if (Date.now() >= nextSecurityCleanup) {
    nextSecurityCleanup = Date.now() + 15 * 60 * 1000;
    try {
      await pool.query(`DELETE FROM auth_security_limits WHERE expires_at < NOW() - INTERVAL '1 day'
        AND key IN (SELECT key FROM auth_security_limits WHERE expires_at < NOW() - INTERVAL '1 day' LIMIT 5000)`);
    } catch (error) { nextSecurityCleanup = 0; throw error; }
  }
  const result = await pool.query(`INSERT INTO auth_security_limits (key, attempts, expires_at)
    VALUES ($1, 1, NOW() + ($3 * INTERVAL '1 second'))
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN auth_security_limits.expires_at <= NOW() THEN 1 ELSE LEAST(auth_security_limits.attempts + 1, $2 + 1) END,
      expires_at = CASE WHEN auth_security_limits.expires_at <= NOW() THEN NOW() + ($3 * INTERVAL '1 second') ELSE auth_security_limits.expires_at END
    RETURNING attempts, CEIL(EXTRACT(EPOCH FROM expires_at - NOW()))::int AS retry_after`, [key, maximum, windowSeconds]);
  const row = result.rows[0];
  return { allowed: row.attempts <= maximum, attempts: row.attempts, retryAfter: Math.max(1, row.retry_after) };
}

async function clearSecurityLimit(key) {
  if (!pool) throw Object.assign(new Error("Authentication database is not configured."), { statusCode: 503 });
  await pool.query("DELETE FROM auth_security_limits WHERE key = $1", [key]);
}

async function findAuthUserByEmail(email, role = null) {
  await ensureAuthSchema();
  if (!pool) return null;
  const normalizedRole = normalizeRole(role);
  const result = await pool.query(
    `SELECT id, full_name, email, phone, password_hash, role, created_at, updated_at, is_active, approval_status, deleted_at
     FROM auth_users
     WHERE LOWER(email) = LOWER($1)
       AND ($2::text IS NULL OR role = $2)
     ORDER BY id
     LIMIT 1`,
    [normalizeEmail(email), normalizedRole || null]
  );
  return result.rows[0] || null;
}

async function findAuthUsersByEmail(email) {
  await ensureAuthSchema();
  if (!pool) return [];
  const result = await pool.query(
    `SELECT id, full_name, email, phone, password_hash, role, created_at, updated_at, is_active, approval_status, deleted_at
     FROM auth_users
     WHERE LOWER(email) = LOWER($1)
     ORDER BY id`,
    [normalizeEmail(email)]
  );
  return result.rows;
}

async function getRegisteredUserCounts() {
  if (!pool) return null;
  const result = await pool.query(`
    SELECT COUNT(*)::int AS "totalRegisteredUsers",
           COUNT(*) FILTER (WHERE is_active AND approval_status = 'APPROVED')::int AS "totalActiveUsers"
    FROM auth_users
    WHERE approval_status <> 'DELETED'
  `);
  return result.rows[0];
}

async function listRegisteredUsers() {
  if (!pool) return null;
  const result = await pool.query(`
    SELECT id, full_name AS name, email, phone, role AS roles,
           approval_status AS status, approval_status, is_active, created_at, deleted_at
    FROM auth_users
    ORDER BY created_at DESC, id DESC
  `);
  return result.rows;
}

async function createAuthUser({ fullName, email, phone, password, role }) {
  await ensureAuthSchema();
  if (!pool) throw new Error("DATABASE_URL is required for production authentication");
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO auth_users (full_name, email, phone, password_hash, role, approval_status, is_active)
     VALUES ($1, $2, $3, $4, $5, 'PENDING', false)
     RETURNING id, full_name, email, phone, role, created_at, updated_at, is_active, approval_status, deleted_at`,
    [String(fullName).trim(), normalizeEmail(email), String(phone).trim(), passwordHash, role]
  );
  return result.rows[0];
}

async function verifyAuthPassword(password, passwordHash) {
  return bcrypt.compare(String(password || ""), String(passwordHash || ""));
}

async function updateAuthUserPassword(email, password, role = null) {
  await ensureAuthSchema();
  if (!pool) throw new Error("DATABASE_URL is required for production authentication");
  const passwordHash = await bcrypt.hash(password, 12);
  const normalizedRole = normalizeRole(role);
  const result = await pool.query(
    `UPDATE auth_users
     SET password_hash = $2, updated_at = NOW()
     WHERE LOWER(email) = LOWER($1)
       AND ($3::text IS NULL OR role = $3)
     RETURNING id, full_name, email, phone, role, created_at, updated_at, is_active`,
    [normalizeEmail(email), passwordHash, normalizedRole || null]
  );
  return result.rows[0] || null;
}

async function createAuthSession({ sessionKey, email, role, refreshTokenHash, csrfToken, rememberMe, expiresAt, ipAddress, userAgent }) {
  await ensureAuthSchema();
  if (!pool) throw new Error("DATABASE_URL is required for production authentication");
  const normalizedRole = normalizeRole(role);
  await pool.query(
    `UPDATE auth_sessions
     SET revoked_at = NOW()
     WHERE LOWER(email) = LOWER($1)
       AND ($2::text IS NULL OR role = $2)
       AND revoked_at IS NULL`,
    [normalizeEmail(email), normalizedRole || null]
  );
  const result = await pool.query(
    `WITH approved AS (
       SELECT email, role FROM auth_users WHERE LOWER(email) = LOWER($2) AND role = $3
       AND is_active AND approval_status = 'APPROVED' AND deleted_at IS NULL FOR SHARE
     ) INSERT INTO auth_sessions
       (session_key, email, role, refresh_token_hash, csrf_token, remember_me, expires_at, last_seen_at, ip_address, user_agent)
     SELECT $1, email, role, $4, $5, $6, $7, NOW(), $8, $9 FROM approved
     RETURNING id, session_key, email, role, csrf_token, remember_me, expires_at, last_seen_at, revoked_at`,
    [sessionKey, normalizeEmail(email), normalizedRole || null, refreshTokenHash, csrfToken, Boolean(rememberMe), expiresAt, ipAddress || null, userAgent || null]
  );
  if (!result.rows[0]) throw Object.assign(new Error("Account approval is required to log in."), { statusCode: 403 });
  return result.rows[0];
}

async function findAuthSessionByKey(sessionKey) {
  await ensureAuthSchema();
  if (!pool) return null;
  const result = await pool.query(
    `SELECT s.*, u.id AS auth_user_id, u.full_name, u.phone, u.role, u.is_active, u.approval_status, u.deleted_at
     FROM auth_sessions s
     JOIN auth_users u ON LOWER(u.email) = LOWER(s.email)
      AND u.role = s.role
     WHERE s.session_key = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
       AND (s.remember_me OR s.last_seen_at > NOW() - ($2 * INTERVAL '1 second'))
       AND u.is_active AND u.approval_status = 'APPROVED' AND u.deleted_at IS NULL
     LIMIT 1`,
    [String(sessionKey || ""), sessionTimeoutSeconds]
  );
  return result.rows[0] || null;
}

async function findAuthSessionByRefreshHash(refreshTokenHash) {
  await ensureAuthSchema();
  if (!pool) return null;
  const result = await pool.query(
    `SELECT s.*, u.id AS auth_user_id, u.full_name, u.phone, u.role, u.is_active, u.approval_status, u.deleted_at
     FROM auth_sessions s
     JOIN auth_users u ON LOWER(u.email) = LOWER(s.email)
      AND u.role = s.role
     WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
       AND (s.remember_me OR s.last_seen_at > NOW() - ($2 * INTERVAL '1 second'))
       AND u.is_active AND u.approval_status = 'APPROVED' AND u.deleted_at IS NULL
     LIMIT 1`,
    [String(refreshTokenHash || ""), sessionTimeoutSeconds]
  );
  return result.rows[0] || null;
}

async function reviewRegistration({ id, status, actorSessionKey, confirmed, currentPassword, confirmationEmail }) {
  if (!pool) throw Object.assign(new Error("Authentication database is not configured."), { statusCode: 503 });
  if (!/^[1-9]\d{0,18}$/.test(String(id)) || BigInt(id) > 9223372036854775807n || !["APPROVED", "REJECTED", "DELETED"].includes(status)) {
    throw Object.assign(new Error("Invalid registration action."), { statusCode: 400 });
  }
  if (confirmed !== true) throw Object.assign(new Error("Confirm this registration action before continuing."), { statusCode: 400 });
  const client = await pool.connect();
  const fail = (code, message, errorCode) => { throw Object.assign(new Error(message), { statusCode: code, errorCode }); };
  try {
    await client.query("BEGIN");
    // Serialize reviews so concurrent requests cannot remove the final approved administrator.
    await client.query("LOCK TABLE auth_users IN SHARE ROW EXCLUSIVE MODE");
    const actor = (await client.query(`SELECT u.* FROM auth_users u JOIN auth_sessions s
      ON LOWER(s.email) = LOWER(u.email) AND s.role = u.role
      WHERE s.session_key = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
      AND u.role = 'super_admin' AND u.is_active AND u.approval_status = 'APPROVED'
      AND u.deleted_at IS NULL FOR UPDATE OF u`, [actorSessionKey])).rows[0];
    if (!isApprovedAccount(actor)) fail(403, "Only an approved Super Admin can review registrations.");
    const target = (await client.query("SELECT * FROM auth_users WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!target) fail(404, "Registration not found.");
    if (target.approval_status === "DELETED") fail(409, registrationAccessMessage(target));
    if (target.approval_status === status) fail(409, "This registration already has that status. Refresh the user list.");
    if (status !== "APPROVED" && String(target.id) === String(actor.id)) fail(409, "You cannot reject or delete your own account.");
    if (status === "DELETED") {
      if (normalizeEmail(confirmationEmail) !== normalizeEmail(target.email)) fail(400, "Enter the account's email address to confirm deletion.");
      if (!currentPassword) fail(400, "Your current admin password is required to delete an account.");
      if (!await verifyAuthPassword(currentPassword, actor.password_hash)) fail(403, "Incorrect admin password. The account was not deleted.", "PASSWORD_INVALID");
    }
    if (status !== "APPROVED" && target.role === "super_admin" && isApprovedAccount(target)) {
      const count = (await client.query("SELECT COUNT(*)::int AS count FROM auth_users WHERE role = 'super_admin' AND is_active AND approval_status = 'APPROVED' AND deleted_at IS NULL")).rows[0].count;
      if (count <= 1) fail(409, "The last approved Super Admin cannot be rejected or deleted.");
    }
    const changed = (await client.query(`UPDATE auth_users SET approval_status = $2, is_active = ($2 = 'APPROVED'),
      deleted_at = CASE WHEN $2 = 'DELETED' THEN NOW() ELSE NULL END, updated_at = NOW()
      WHERE id = $1 RETURNING id, full_name AS name, email, phone, role AS roles,
      approval_status AS status, approval_status, is_active, created_at, deleted_at`, [id, status])).rows[0];
    // Revoke even on approval: a previously rejected session must never become valid again.
    const revoked = (await client.query(`UPDATE auth_sessions SET revoked_at = NOW()
      WHERE LOWER(email) = LOWER($1) AND role = $2 AND revoked_at IS NULL RETURNING refresh_token_hash`, [target.email, target.role])).rows;
    await client.query("UPDATE auth_password_otps SET used_at = NOW() WHERE auth_user_id = $1 AND used_at IS NULL", [id]);
    await client.query(`INSERT INTO auth_registration_reviews (auth_user_id, reviewer_auth_user_id, previous_status, status)
      VALUES ($1, $2, $3, $4)`, [id, actor.id, target.approval_status, status]);
    await client.query("COMMIT");
    return { user: changed, revokedHashes: revoked.map(row => row.refresh_token_hash) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function touchAuthSession(sessionKey) {
  await ensureAuthSchema();
  if (!pool) return 0;
  const result = await pool.query(
    `UPDATE auth_sessions SET last_seen_at = NOW() WHERE session_key = $1 AND revoked_at IS NULL`,
    [String(sessionKey || "")]
  );
  return result.rowCount;
}

async function revokeAuthSessionByKey(sessionKey) {
  await ensureAuthSchema();
  if (!pool) return 0;
  const result = await pool.query(
    `UPDATE auth_sessions SET revoked_at = NOW() WHERE session_key = $1 AND revoked_at IS NULL`,
    [String(sessionKey || "")]
  );
  return result.rowCount;
}

async function revokeAuthSessionByRefreshHash(refreshTokenHash) {
  await ensureAuthSchema();
  if (!pool) return 0;
  const result = await pool.query(
    `UPDATE auth_sessions SET revoked_at = NOW() WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
    [String(refreshTokenHash || "")]
  );
  return result.rowCount;
}

async function revokeAuthSessionsByEmail(email, role = null) {
  await ensureAuthSchema();
  if (!pool) return 0;
  const normalizedRole = normalizeRole(role);
  const result = await pool.query(
    `UPDATE auth_sessions
     SET revoked_at = NOW()
     WHERE LOWER(email) = LOWER($1)
       AND ($2::text IS NULL OR role = $2)
       AND revoked_at IS NULL`,
    [normalizeEmail(email), normalizedRole || null]
  );
  return result.rowCount;
}

async function countRecentPasswordOtpRequests(email, since) {
  await ensureAuthSchema();
  if (!pool) return 0;
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM auth_password_otps
     WHERE LOWER(email) = LOWER($1) AND created_at > $2`,
    [normalizeEmail(email), since]
  );
  return Number(result.rows[0]?.count || 0);
}

async function createPasswordResetOtp({ authUserId, email, otpHash, expiresAt, requestIp, userAgent }) {
  await ensureAuthSchema();
  if (!pool) throw new Error("DATABASE_URL is required for production authentication");
  await pool.query(
    `UPDATE auth_password_otps
     SET used_at = NOW()
     WHERE auth_user_id = $1 AND used_at IS NULL`,
    [authUserId]
  );
  const result = await pool.query(
    `INSERT INTO auth_password_otps (auth_user_id, email, otp_hash, expires_at, request_ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, expires_at, created_at`,
    [authUserId, normalizeEmail(email), otpHash, expiresAt, requestIp || null, userAgent || null]
  );
  return result.rows[0];
}

async function invalidatePasswordResetOtpsByEmail(email) {
  await ensureAuthSchema();
  if (!pool) return 0;
  const result = await pool.query(
    `UPDATE auth_password_otps
     SET used_at = NOW()
     WHERE LOWER(email) = LOWER($1) AND used_at IS NULL`,
    [normalizeEmail(email)]
  );
  return result.rowCount;
}

async function verifyPasswordResetOtp({ email, role = null, otpHash, resetTokenHash, resetExpiresAt }) {
  await ensureAuthSchema();
  if (!pool) throw new Error("DATABASE_URL is required for production authentication");
  const normalizedRole = normalizeRole(role);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT o.id, o.otp_hash, o.expires_at, o.attempt_count, u.id AS auth_user_id, u.email, u.full_name
       FROM auth_password_otps o
       JOIN auth_users u ON u.id = o.auth_user_id
       WHERE LOWER(o.email) = LOWER($1)
         AND ($2::text IS NULL OR u.role = $2)
         AND u.is_active AND u.approval_status = 'APPROVED' AND u.deleted_at IS NULL
         AND o.used_at IS NULL
         AND o.verified_at IS NULL
       ORDER BY o.created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [normalizeEmail(email), normalizedRole || null]
    );
    const otp = result.rows[0];
    if (!otp) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid" };
    }
    if (new Date(otp.expires_at).getTime() < Date.now()) {
      await client.query("UPDATE auth_password_otps SET used_at = NOW() WHERE id = $1", [otp.id]);
      await client.query("COMMIT");
      return { ok: false, reason: "expired" };
    }
    if (otp.attempt_count >= 5) {
      await client.query("UPDATE auth_password_otps SET used_at = NOW() WHERE id = $1", [otp.id]);
      await client.query("COMMIT");
      return { ok: false, reason: "too_many_attempts" };
    }
    if (otp.otp_hash !== otpHash) {
      const attempts = Number(otp.attempt_count || 0) + 1;
      await client.query(
        `UPDATE auth_password_otps
         SET attempt_count = $2, used_at = CASE WHEN $2 >= 5 THEN NOW() ELSE used_at END
         WHERE id = $1`,
        [otp.id, attempts]
      );
      await client.query("COMMIT");
      return { ok: false, reason: attempts >= 5 ? "too_many_attempts" : "invalid" };
    }
    await client.query(
      `UPDATE auth_password_otps
       SET verified_at = NOW(), reset_token_hash = $2, reset_expires_at = $3
       WHERE id = $1`,
      [otp.id, resetTokenHash, resetExpiresAt]
    );
    await client.query("COMMIT");
    return {
      ok: true,
      email: otp.email,
      fullName: otp.full_name
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function resetAuthPasswordWithToken({ email, role = null, resetTokenHash, password }) {
  await ensureAuthSchema();
  if (!pool) throw new Error("DATABASE_URL is required for production authentication");
  const passwordHash = await bcrypt.hash(password, 12);
  const normalizedRole = normalizeRole(role);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const otpResult = await client.query(
      `SELECT o.id, u.id AS auth_user_id, u.email
       FROM auth_password_otps o
       JOIN auth_users u ON u.id = o.auth_user_id
       WHERE LOWER(o.email) = LOWER($1)
         AND ($2::text IS NULL OR u.role = $2)
         AND u.is_active AND u.approval_status = 'APPROVED' AND u.deleted_at IS NULL
         AND o.reset_token_hash = $3
         AND o.verified_at IS NOT NULL
         AND o.used_at IS NULL
       ORDER BY o.created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [normalizeEmail(email), normalizedRole || null, resetTokenHash]
    );
    const otp = otpResult.rows[0];
    if (!otp) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid" };
    }
    const expiryResult = await client.query(
      `SELECT reset_expires_at FROM auth_password_otps WHERE id = $1`,
      [otp.id]
    );
    if (new Date(expiryResult.rows[0].reset_expires_at).getTime() < Date.now()) {
      await client.query("UPDATE auth_password_otps SET used_at = NOW() WHERE id = $1", [otp.id]);
      await client.query("COMMIT");
      return { ok: false, reason: "expired" };
    }
    await client.query(
      `UPDATE auth_users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
      [otp.auth_user_id, passwordHash]
    );
    await client.query("UPDATE auth_password_otps SET used_at = NOW() WHERE auth_user_id = $1", [otp.auth_user_id]);
    await client.query("COMMIT");
    return { ok: true, email: otp.email };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function auditRowPayload(row) {
  if (!row) return null;
  return {
    recordKey: row.record_key,
    createdByName: row.created_by_name,
    createdByEmail: row.created_by_email,
    createdAt: row.created_at,
    lastEditedByName: row.last_edited_by_name,
    lastEditedByEmail: row.last_edited_by_email,
    lastEditedAt: row.last_edited_at,
    action: row.last_action || "created"
  };
}

async function upsertEmployeeRecordAudit({
  recordKey,
  employeeUserId,
  employeeEmail,
  employeePhone,
  editorAuthUserId,
  editorName,
  editorEmail,
  action = "edited"
}) {
  await ensureAuthSchema();
  if (!pool) throw new Error("DATABASE_URL is required for employee audit persistence");
  const normalizedAction = action === "created" ? "created" : "edited";
  const result = await pool.query(
    `INSERT INTO employee_record_audits
       (record_key, employee_user_id, employee_email, employee_phone,
        created_by_auth_user_id, created_by_name, created_by_email,
        last_edited_by_auth_user_id, last_edited_by_name, last_edited_by_email, last_action)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $5, $6, $7, $8)
     ON CONFLICT (record_key) DO UPDATE SET
       employee_user_id = EXCLUDED.employee_user_id,
       employee_email = EXCLUDED.employee_email,
       employee_phone = EXCLUDED.employee_phone,
       last_edited_by_auth_user_id = EXCLUDED.last_edited_by_auth_user_id,
       last_edited_by_name = EXCLUDED.last_edited_by_name,
       last_edited_by_email = EXCLUDED.last_edited_by_email,
       last_edited_at = NOW(),
       last_action = 'edited'
     RETURNING record_key, created_by_name, created_by_email, created_at,
               last_edited_by_name, last_edited_by_email, last_edited_at, last_action`,
    [
      String(recordKey || ""),
      employeeUserId == null ? null : String(employeeUserId),
      normalizeEmail(employeeEmail) || null,
      employeePhone ? String(employeePhone) : null,
      editorAuthUserId || null,
      String(editorName || "Unknown user"),
      normalizeEmail(editorEmail) || null,
      normalizedAction
    ]
  );
  return auditRowPayload(result.rows[0]);
}

async function getEmployeeRecordAudits(recordKeys) {
  await ensureAuthSchema();
  if (!pool || !Array.isArray(recordKeys) || !recordKeys.length) return new Map();
  const keys = [...new Set(recordKeys.map(key => String(key || "")).filter(Boolean))];
  if (!keys.length) return new Map();
  const result = await pool.query(
    `SELECT record_key, created_by_name, created_by_email, created_at,
            last_edited_by_name, last_edited_by_email, last_edited_at, last_action
     FROM employee_record_audits
     WHERE record_key = ANY($1::text[])`,
    [keys]
  );
  return new Map(result.rows.map(row => [row.record_key, auditRowPayload(row)]));
}

async function deleteAuthUserByEmail(email, role = null) {
  await ensureAuthSchema();
  if (!pool) return 0;
  const normalizedRole = normalizeRole(role);
  const result = await pool.query(
    `DELETE FROM auth_users
     WHERE LOWER(email) = LOWER($1)
       AND ($2::text IS NULL OR role = $2)`,
    [normalizeEmail(email), normalizedRole || null]
  );
  return result.rowCount;
}

async function closeAuthStore() {
  if (pool) await pool.end();
}

module.exports = {
  hasPostgresAuth,
  ensureAuthSchema,
  findAuthUserByEmail,
  findAuthUsersByEmail,
  getRegisteredUserCounts,
  listRegisteredUsers,
  getSecurityLimit,
  consumeSecurityLimit,
  clearSecurityLimit,
  reviewRegistration,
  createAuthUser,
  verifyAuthPassword,
  updateAuthUserPassword,
  createAuthSession,
  findAuthSessionByKey,
  findAuthSessionByRefreshHash,
  touchAuthSession,
  revokeAuthSessionByKey,
  revokeAuthSessionByRefreshHash,
  revokeAuthSessionsByEmail,
  countRecentPasswordOtpRequests,
  createPasswordResetOtp,
  invalidatePasswordResetOtpsByEmail,
  verifyPasswordResetOtp,
  resetAuthPasswordWithToken,
  upsertEmployeeRecordAudit,
  getEmployeeRecordAudits,
  deleteAuthUserByEmail,
  closeAuthStore
};
