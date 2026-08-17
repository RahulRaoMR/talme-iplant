const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const xlsx = require("xlsx");
const { db, initDb, now, createCompany, createUser, assignRole } = require("./db");
const {
  port,
  publicDir,
  refreshTokenTtlSeconds,
  rememberMeTtlSeconds,
  sessionTimeoutSeconds,
  cvUploadDir,
  employeeInviteCode,
  isProductionRuntime
} = require("./config");
const {
  parseJsonBody,
  hashPassword,
  sha256,
  randomToken,
  signJwt,
  verifyJwt,
  parseCookies,
  cookie,
  getIp,
  getBrowser,
  getDeviceName,
  validatePassword
} = require("./security");
const { ROLE_REDIRECTS, DASHBOARD_PERMISSIONS } = require("./rbac");
const {
  hasNeonAuth,
  findAuthUserByEmail,
  createAuthUser,
  verifyAuthPassword,
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
  getEmployeeRecordAudits
} = require("./auth-store");
const { requireEmailConfig, sendPasswordResetOtpEmail } = require("./email");
const employeeStore = require("./employee-store");

initDb();

const rateBuckets = new Map();
const candidateImportDrafts = new Map();
const candidateImportTtlMs = 15 * 60 * 1000;
const publicAuthRoutes = new Set([
  "POST /api/auth/login",
  "POST /api/auth/register",
  "POST /api/auth/forgot-password",
  "POST /api/auth/forgot-password/verify",
  "POST /api/auth/reset-password",
  "POST /api/auth/refresh",
  "POST /api/auth/tab-close"
]);

const REGISTRATION_ROLE_BY_TYPE = {
  candidate: "candidate",
  employer: "employer",
  recruiter: "recruiter",
  employee: "employee",
  company: "company_admin",
  admin: "super_admin",
  talme_hr: "hr_manager"
};

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message, details) {
  sendJson(res, statusCode, { error: message, details });
}

function isDatabaseQuotaError(error) {
  return /exceeded the data transfer quota/i.test(String(error?.message || ""));
}

function healthCheck(req, res) {
  sendJson(res, 200, {
    success: true,
    message: "Talme Backend Running"
  });
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self' blob:",
      "object-src 'self' blob:",
      "frame-ancestors 'none'"
    ].join("; ")
  };
}

function applySecurityHeaders(res) {
  for (const [key, value] of Object.entries(securityHeaders())) {
    res.setHeader(key, value);
  }
}

function enforceRateLimit(req, res) {
  const key = `${getIp(req)}:${req.method}:${new URL(req.url, "http://localhost").pathname}`;
  const windowMs = 60 * 1000;
  const max = key.includes("/api/auth/login") ? 8 : key.includes("/api/auth/forgot-password") ? 5 : 120;
  const current = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: current + windowMs };
  if (bucket.resetAt < current) {
    bucket.count = 0;
    bucket.resetAt = current + windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(max - bucket.count, 0)));
  if (bucket.count > max) {
    sendError(res, 429, "Too many requests. Please try again shortly.");
    return false;
  }
  return true;
}

function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE lower(email) = lower(?)").get(email);
}

function getUserByPhone(phone) {
  return db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
}

function sendAuthFailure(res, statusCode, message, details) {
  sendJson(res, statusCode, { success: false, message, error: message, details });
}

function rolesForUser(userId) {
  return db.prepare(`
    SELECT r.slug, r.name, ur.company_id
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = ?
    ORDER BY r.id
  `).all(userId);
}

function permissionsForUser(userId) {
  const rows = db.prepare(`
    SELECT DISTINCT p.key
    FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ?
  `).all(userId);
  const permissions = rows.map(row => row.key);
  if (permissions.includes("*")) {
    return db.prepare("SELECT key FROM permissions").all().map(row => row.key);
  }
  return permissions;
}

function canUsePreferredRole(roleSlugs, permissions, preferredRole) {
  if (!preferredRole) return false;
  if (roleSlugs.includes(preferredRole)) return true;
  const redirectTo = ROLE_REDIRECTS[preferredRole];
  const permission = DASHBOARD_PERMISSIONS[redirectTo];
  return Boolean(permission && permissions.includes(permission));
}

function sanitizeUser(user, preferredRole = null) {
  const roles = rolesForUser(user.id);
  const permissions = permissionsForUser(user.id);
  const roleSlugs = roles.map(role => role.slug);
  const primaryRole = canUsePreferredRole(roleSlugs, permissions, preferredRole) ? preferredRole : (roles[0]?.slug || "guest");
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    status: user.status,
    emailVerified: Boolean(user.email_verified),
    phoneVerified: Boolean(user.phone_verified),
    twoFactorEnabled: Boolean(user.two_factor_enabled),
    roles,
    permissions,
    primaryRole,
    redirectTo: ROLE_REDIRECTS[primaryRole] || "/"
  };
}

function audit(req, userId, actionType, metadata = {}, entityType = null, entityId = null) {
  const userAgent = req.headers["user-agent"] || "";
  db.prepare(`
    INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, metadata, ip_address, device, browser, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId || null,
    actionType,
    entityType,
    entityId == null ? null : String(entityId),
    JSON.stringify(metadata),
    getIp(req),
    getDeviceName(userAgent),
    getBrowser(userAgent),
    now()
  );
}

function logLogin(req, user, success, action, reason = null, email = null) {
  const userAgent = req.headers["user-agent"] || "";
  db.prepare(`
    INSERT INTO login_history (user_id, email, success, action, reason, ip_address, device, browser, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user?.id || null,
    user?.email || email || null,
    success ? 1 : 0,
    action,
    reason,
    getIp(req),
    getDeviceName(userAgent),
    getBrowser(userAgent),
    now()
  );
}

function upsertDevice(req, userId) {
  const userAgent = req.headers["user-agent"] || "";
  const ip = getIp(req);
  const fingerprint = sha256(`${userId}:${ip}:${userAgent}`);
  const existing = db.prepare("SELECT * FROM devices WHERE user_id = ? AND fingerprint = ?").get(userId, fingerprint);
  if (existing) {
    db.prepare(`
      UPDATE devices SET ip_address = ?, user_agent = ?, browser = ?, device = ?, last_seen_at = ? WHERE id = ?
    `).run(ip, userAgent, getBrowser(userAgent), getDeviceName(userAgent), now(), existing.id);
    return existing.id;
  }
  const result = db.prepare(`
    INSERT INTO devices (user_id, fingerprint, ip_address, user_agent, browser, device, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, fingerprint, ip, userAgent, getBrowser(userAgent), getDeviceName(userAgent), now(), now());
  return Number(result.lastInsertRowid);
}

function createSession(req, user, rememberMe = false) {
  const refreshToken = randomToken(48);
  const csrfToken = randomToken(24);
  const ttl = rememberMe ? rememberMeTtlSeconds : refreshTokenTtlSeconds;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const deviceId = upsertDevice(req, user.id);
  db.prepare(`
    UPDATE sessions
    SET revoked_at = ?
    WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL
  `).run(now(), user.id, deviceId);
  const result = db.prepare(`
    INSERT INTO sessions (user_id, refresh_token_hash, csrf_token, device_id, ip_address, user_agent, remember_me, expires_at, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    sha256(refreshToken),
    csrfToken,
    deviceId,
    getIp(req),
    req.headers["user-agent"] || "",
    rememberMe ? 1 : 0,
    expiresAt,
    now(),
    now()
  );
  const sessionId = Number(result.lastInsertRowid);
  const authSessionKey = randomToken(24);
  const roles = rolesForUser(user.id).map(role => role.slug);
  const permissions = permissionsForUser(user.id);
  const accessToken = signJwt({ sub: user.id, sid: sessionId, authSid: authSessionKey, email: user.email, roles, permissions, csrf: csrfToken });
  return { accessToken, refreshToken, csrfToken, sessionId, authSessionKey, expiresAt };
}

function bearerPayload(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return verifyJwt(token);
}

async function persistentAuthContext(req, payload) {
  if (!payload?.authSid) return null;
  const authSession = await findAuthSessionByKey(payload.authSid);
  if (!authSession?.is_active) return null;
  await touchAuthSession(payload.authSid).catch(() => {});
  const localUser = mirrorAuthUserToLocal({
    full_name: authSession.full_name,
    email: authSession.email,
    phone: authSession.phone,
    role: authSession.role,
    is_active: authSession.is_active
  });
  return {
    user: localUser,
    session: {
      id: payload.sid,
      authSessionKey: authSession.session_key,
      csrf_token: authSession.csrf_token,
      remember_me: authSession.remember_me,
      expires_at: authSession.expires_at,
      last_seen_at: authSession.last_seen_at
    },
    payload,
    safeUser: sanitizeUser(localUser)
  };
}

async function authenticate(req) {
  const payload = bearerPayload(req);
  if (!payload?.sub || !payload?.sid) return null;
  const persistentSession = payload.authSid ? await findAuthSessionByKey(payload.authSid) : null;
  if (payload.authSid && !persistentSession?.is_active) return null;
  const session = db.prepare(`
    SELECT * FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
  `).get(Number(payload.sid), Number(payload.sub), now());
  if (!session) return persistentAuthContext(req, payload);
  const stale = Date.now() - Date.parse(session.last_seen_at) > sessionTimeoutSeconds * 1000;
  if (stale && !session.remember_me) {
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(now(), session.id);
    return null;
  }
  const seenAt = now();
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(seenAt, session.id);
  if (session.device_id) {
    db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(seenAt, session.device_id);
  }
  if (persistentSession?.session_key) await touchAuthSession(persistentSession.session_key).catch(() => {});
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND status = 'active'").get(payload.sub);
  if (!user) return persistentAuthContext(req, payload);
  return {
    user,
    session: {
      ...session,
      authSessionKey: persistentSession?.session_key || null,
      csrf_token: persistentSession?.csrf_token || session.csrf_token
    },
    payload,
    safeUser: sanitizeUser(user)
  };
}

function authenticateRefreshCookie(req) {
  const refreshToken = parseCookies(req).talme_refresh;
  if (!refreshToken) return null;
  const session = db.prepare(`
    SELECT * FROM sessions WHERE refresh_token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).get(sha256(refreshToken), now());
  if (!session) return null;
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND status = 'active'").get(session.user_id);
  if (!user) return null;
  return { user, session, safeUser: sanitizeUser(user) };
}

function hasPermission(context, permission) {
  if (!permission) return true;
  return context.safeUser.permissions.includes("*") || context.safeUser.permissions.includes(permission);
}

function hasAnyRole(context, allowedRoles) {
  const roles = context.safeUser.roles.map(role => role.slug);
  return allowedRoles.some(role => roles.includes(role));
}

async function requireAuth(req, res, permission = null) {
  const context = await authenticate(req);
  if (!context) {
    sendError(res, 401, "Authentication required");
    return null;
  }
  if (!hasPermission(context, permission)) {
    audit(req, context.user.id, "Forbidden Access", { permission, path: req.url });
    sendError(res, 403, "Forbidden");
    return null;
  }
  if (!validateCsrf(req, context)) {
    sendError(res, 403, "CSRF token invalid or missing");
    return null;
  }
  return context;
}

function validateCsrf(req, context) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const routeKey = `${req.method} ${new URL(req.url, "http://localhost").pathname}`;
  if (publicAuthRoutes.has(routeKey)) return true;
  const expected = context.session?.csrf_token || context.payload?.csrf;
  return Boolean(req.headers["x-csrf-token"] && expected && req.headers["x-csrf-token"] === expected);
}

function setRefreshCookie(res, refreshToken, maxAge) {
  res.setHeader("Set-Cookie", cookie("talme_refresh", refreshToken, {
    httpOnly: true,
    secure: Boolean(process.env.VERCEL),
    sameSite: "Strict",
    maxAge
  }));
}

function clearRefreshCookie(res) {
  res.setHeader("Set-Cookie", cookie("talme_refresh", "", {
    httpOnly: true,
    secure: Boolean(process.env.VERCEL),
    sameSite: "Strict",
    maxAge: 0
  }));
}

function clearResetCookie(res) {
  res.setHeader("Set-Cookie", cookie("talme_reset", "", {
    httpOnly: true,
    secure: Boolean(process.env.VERCEL),
    sameSite: "Strict",
    maxAge: 0
  }));
}

function primaryRoleForRequestedLogin(user, requestedRole) {
  const roles = rolesForUser(user.id).map(role => role.slug);
  if (requestedRole) return roles.includes(requestedRole) ? requestedRole : null;
  return roles[0] || null;
}

function normalizeSubmittedPassword(value) {
  return String(value || "").trim();
}

function normalizeRequestedRole(value) {
  return String(value || "").trim();
}

function roleSlugFromAuthBody(body) {
  const requestedRole = normalizeRequestedRole(body.role);
  if (requestedRole) return requestedRole;
  const type = String(body.type || "").toLowerCase();
  return REGISTRATION_ROLE_BY_TYPE[type] || "";
}

function mirrorAuthUserToLocal(authUser) {
  const roleSlug = authUser.role || "candidate";
  const needsCompany = ["employer", "recruiter", "employee", "company_admin", "hr_manager", "super_admin", "platform_admin"].includes(roleSlug);
  const company = needsCompany ? createCompany("Talme Technologies", "talme.test") : null;
  const userId = createUser({
    name: authUser.full_name,
    email: authUser.email,
    phone: authUser.phone,
    password: randomToken(24),
    roleSlug,
    companyId: company?.id,
    emailVerified: true
  });
  db.prepare(`
    UPDATE users
    SET name = ?, phone = ?, status = CASE WHEN ? THEN 'active' ELSE 'inactive' END,
        email_verified = 1, phone_verified = 1, updated_at = ?
    WHERE id = ?
  `).run(authUser.full_name, authUser.phone, authUser.is_active ? 1 : 0, now(), userId);
  db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(userId);
  assignRole(userId, roleSlug, company?.id);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

async function createAuthResponse(req, res, user, rememberMe = false, action = "Login", message = "Login successful.", preferredRole = null) {
  const session = createSession(req, user, rememberMe);
  await createAuthSession({
    sessionKey: session.authSessionKey,
    email: user.email,
    role: preferredRole || user.role,
    refreshTokenHash: sha256(session.refreshToken),
    csrfToken: session.csrfToken,
    rememberMe,
    expiresAt: session.expiresAt,
    ipAddress: getIp(req),
    userAgent: req.headers["user-agent"] || ""
  });
  setRefreshCookie(res, session.refreshToken, rememberMe ? rememberMeTtlSeconds : refreshTokenTtlSeconds);
  logLogin(req, user, true, action);
  audit(req, user.id, action, { rememberMe });
  sendJson(res, 200, {
    success: true,
    message,
    accessToken: session.accessToken,
    csrfToken: session.csrfToken,
    user: sanitizeUser(user, preferredRole),
    expiresAt: session.expiresAt
  });
}

async function login(req, res) {
  const body = await parseJsonBody(req);
  const email = String(body.email || "").trim();
  const password = normalizeSubmittedPassword(body.password);
  const requestedRole = roleSlugFromAuthBody(body);
  if (!email || !password) {
    return sendAuthFailure(res, 400, "Email and password are required.");
  }
  if (!requestedRole) {
    return sendAuthFailure(res, 400, "Please select Admin or Talme HR.");
  }

  if (!hasNeonAuth()) {
    return sendAuthFailure(res, 500, "Authentication database is not configured.");
  }
  const authUser = await findAuthUserByEmail(email, requestedRole);
  if (!authUser) {
    const anyRoleUser = await findAuthUserByEmail(email);
    logLogin(req, null, false, "Failed Login", anyRoleUser ? "Requested login role not registered" : "Account not found", email);
    return sendAuthFailure(res, anyRoleUser ? 403 : 404, anyRoleUser ? "This email is not registered for the selected login page." : "Account not found. Please register first.");
  }
  if (!authUser.is_active) {
    logLogin(req, null, false, "Failed Login", "Account inactive", email);
    return sendAuthFailure(res, 403, "Account is inactive.");
  }
  if (!await verifyAuthPassword(password, authUser.password_hash)) {
    logLogin(req, null, false, "Failed Login", "Incorrect password", email);
    return sendAuthFailure(res, 401, "Invalid password.");
  }
  const user = mirrorAuthUserToLocal(authUser);

  const loginRole = primaryRoleForRequestedLogin(user, requestedRole);
  if (!loginRole) {
    const reason = body.role ? "Requested login role not assigned" : "Role not assigned";
    logLogin(req, user, false, "Failed Login", reason, email);
    return sendAuthFailure(res, 403, body.role ? "This account is not registered for the selected login page." : "No role is assigned to your account");
  }
  await createAuthResponse(req, res, user, Boolean(body.rememberMe), "Login", "Login successful.", loginRole);
}

async function register(req, res) {
  const body = await parseJsonBody(req);
  const type = String(body.type || "candidate").toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = normalizeSubmittedPassword(body.password);
  const phone = body.phone ? String(body.phone).trim() : null;
  const confirmPassword = normalizeSubmittedPassword(body.confirmPassword);
  const missing = [];
  if (!name) missing.push("Name");
  if (!email) missing.push("Email");
  if (!phone) missing.push("Phone");
  if (!password) missing.push("Password");
  if (!confirmPassword) missing.push("Confirm Password");
  if (missing.length) {
    return sendAuthFailure(res, 400, `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.`);
  }
  if (!validEmail(email)) {
    return sendAuthFailure(res, 400, "Please enter a valid email address.");
  }
  if (password !== confirmPassword) {
    return sendAuthFailure(res, 400, "Password and Confirm Password must match");
  }
  if (!validatePassword(password)) {
    return sendAuthFailure(res, 400, "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.");
  }

  const roleSlug = REGISTRATION_ROLE_BY_TYPE[type];
  if (!roleSlug) return sendAuthFailure(res, 400, "Unsupported registration type");
  if (type === "employee" && body.inviteCode !== employeeInviteCode) {
    return sendAuthFailure(res, 403, "Employee registration is invite only");
  }
  if (!hasNeonAuth()) {
    return sendAuthFailure(res, 500, "Authentication database is not configured.");
  }
  if (await findAuthUserByEmail(email, roleSlug)) {
    return sendAuthFailure(res, 409, "This email is already registered for the selected login page.");
  }
  const authUser = await createAuthUser({ fullName: name, email, phone, password, role: roleSlug });
  mirrorAuthUserToLocal(authUser);
  sendJson(res, 201, {
    success: true,
    message: "Registration successful. Please login to continue."
  });
}

async function forgotPassword(req, res) {
  const body = await parseJsonBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  const roleSlug = roleSlugFromAuthBody(body);
  if (!email) return sendAuthFailure(res, 400, "Email is required.");
  if (!roleSlug) return sendAuthFailure(res, 400, "Please select Admin or Talme HR.");
  if (!validEmail(email)) return sendAuthFailure(res, 400, "Please enter a valid email address.");
  if (!hasNeonAuth()) return sendAuthFailure(res, 500, "Authentication database is not configured.");

  const authUser = await findAuthUserByEmail(email, roleSlug);
  if (!authUser) {
    const anyRoleUser = await findAuthUserByEmail(email);
    return sendAuthFailure(res, anyRoleUser ? 403 : 404, anyRoleUser ? "Email address is not registered for the selected login page." : "Email address is not registered.");
  }

  const recentRequests = await countRecentPasswordOtpRequests(email, new Date(Date.now() - 15 * 60 * 1000).toISOString());
  if (recentRequests >= 3) {
    return sendAuthFailure(res, 429, "Too many OTP requests. Please try again later.");
  }

  requireEmailConfig();

  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await createPasswordResetOtp({
    authUserId: authUser.id,
    email,
    otpHash: passwordResetHash(email, otp, roleSlug),
    expiresAt,
    requestIp: getIp(req),
    userAgent: req.headers["user-agent"] || ""
  });

  try {
    await sendPasswordResetOtpEmail({ to: authUser.email, name: authUser.full_name, otp });
  } catch (error) {
    await invalidatePasswordResetOtpsByEmail(email).catch(() => {});
    throw error;
  }

  audit(req, null, "Password Reset", { stage: "otp_requested", email, role: roleSlug });
  sendJson(res, 200, {
    success: true,
    message: "OTP has been sent to your registered email."
  });
}

async function verifyForgotPasswordOtp(req, res) {
  const body = await parseJsonBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  const roleSlug = roleSlugFromAuthBody(body);
  const otp = String(body.otp || "").trim();
  if (!email) return sendAuthFailure(res, 400, "Email is required.");
  if (!roleSlug) return sendAuthFailure(res, 400, "Please select Admin or Talme HR.");
  if (!validEmail(email)) return sendAuthFailure(res, 400, "Please enter a valid email address.");
  if (!/^\d{6}$/.test(otp)) return sendAuthFailure(res, 400, "Invalid OTP.");
  if (!hasNeonAuth()) return sendAuthFailure(res, 500, "Authentication database is not configured.");

  const resetToken = randomToken(32);
  const result = await verifyPasswordResetOtp({
    email,
    role: roleSlug,
    otpHash: passwordResetHash(email, otp, roleSlug),
    resetTokenHash: passwordResetHash(email, resetToken, roleSlug),
    resetExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  if (!result.ok && result.reason === "expired") {
    return sendAuthFailure(res, 410, "OTP has expired. Please request a new OTP.");
  }
  if (!result.ok && result.reason === "too_many_attempts") {
    return sendAuthFailure(res, 429, "Too many invalid OTP attempts. Please request a new OTP.");
  }
  if (!result.ok) return sendAuthFailure(res, 401, "Invalid OTP.");
  res.setHeader("Set-Cookie", cookie("talme_reset", resetToken, {
    httpOnly: true,
    secure: Boolean(process.env.VERCEL),
    sameSite: "Strict",
    maxAge: 10 * 60
  }));
  sendJson(res, 200, {
    success: true,
    message: "OTP verified."
  });
}

async function resetPassword(req, res) {
  const body = await parseJsonBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  const roleSlug = roleSlugFromAuthBody(body);
  const resetToken = String(body.resetToken || body.token || parseCookies(req).talme_reset || "").trim();
  const password = normalizeSubmittedPassword(body.password);
  const confirmPassword = normalizeSubmittedPassword(body.confirmPassword);
  if (!email) return sendAuthFailure(res, 400, "Email is required.");
  if (!roleSlug) return sendAuthFailure(res, 400, "Please select Admin or Talme HR.");
  if (!validEmail(email)) return sendAuthFailure(res, 400, "Please enter a valid email address.");
  if (!resetToken) return sendAuthFailure(res, 400, "Reset verification is required.");
  if (password !== confirmPassword) return sendAuthFailure(res, 400, "Password and Confirm Password must match");
  if (!validatePassword(password)) {
    return sendAuthFailure(res, 400, "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.");
  }
  if (!hasNeonAuth()) return sendAuthFailure(res, 500, "Authentication database is not configured.");

  const result = await resetAuthPasswordWithToken({
    email,
    role: roleSlug,
    resetTokenHash: passwordResetHash(email, resetToken, roleSlug),
    password
  });
  if (!result.ok && result.reason === "expired") {
    clearResetCookie(res);
    return sendAuthFailure(res, 410, "OTP has expired. Please request a new OTP.");
  }
  if (!result.ok) {
    clearResetCookie(res);
    return sendAuthFailure(res, 401, "Invalid OTP.");
  }

  const localUser = getUserByEmail(email);
  if (localUser) {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(password), now(), localUser.id);
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now(), localUser.id);
    audit(req, localUser.id, "Password Reset", { stage: "completed" });
  } else {
    audit(req, null, "Password Reset", { stage: "completed", email });
  }
  await revokeAuthSessionsByEmail(email, roleSlug).catch(() => {});
  clearResetCookie(res);
  sendJson(res, 200, {
    success: true,
    message: "Password reset successfully. You can now login with your new password."
  });
}

async function refresh(req, res) {
  const refreshToken = parseCookies(req).talme_refresh;
  if (!refreshToken) return sendError(res, 401, "Refresh token missing");
  const refreshHash = sha256(refreshToken);
  const session = db.prepare(`
    SELECT * FROM sessions WHERE refresh_token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).get(refreshHash, now());
  let user = session ? db.prepare("SELECT * FROM users WHERE id = ? AND status = 'active'").get(session.user_id) : null;
  let csrfToken = session?.csrf_token || "";
  const persistentSession = await findAuthSessionByRefreshHash(refreshHash).catch(() => null);
  let authSessionKey = persistentSession?.session_key || null;
  if (session && user) {
    const seenAt = now();
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(seenAt, session.id);
    if (session.device_id) {
      db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(seenAt, session.device_id);
    }
    if (persistentSession?.csrf_token) csrfToken = persistentSession.csrf_token;
    if (persistentSession?.session_key) await touchAuthSession(persistentSession.session_key).catch(() => {});
  } else {
    const authSession = persistentSession;
    if (!authSession?.is_active) return sendError(res, 401, "Refresh token invalid");
    await touchAuthSession(authSession.session_key).catch(() => {});
    user = mirrorAuthUserToLocal({
      full_name: authSession.full_name,
      email: authSession.email,
      phone: authSession.phone,
      role: authSession.role,
      is_active: authSession.is_active
    });
    csrfToken = authSession.csrf_token;
    authSessionKey = authSession.session_key;
  }
  const accessToken = signJwt({
    sub: user.id,
    sid: session?.id || 0,
    authSid: authSessionKey || undefined,
    email: user.email,
    roles: rolesForUser(user.id).map(role => role.slug),
    permissions: permissionsForUser(user.id),
    csrf: csrfToken
  });
  sendJson(res, 200, { accessToken, csrfToken, user: sanitizeUser(user) });
}

async function logout(req, res) {
  const context = await requireAuth(req, res);
  if (!context) return;
  if (context.session?.id) {
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(now(), context.session.id);
  }
  const authSessionKey = context.session?.authSessionKey || context.payload?.authSid;
  if (authSessionKey) await revokeAuthSessionByKey(authSessionKey).catch(() => {});
  clearRefreshCookie(res);
  logLogin(req, context.user, true, "Logout");
  audit(req, context.user.id, "Logout");
  sendJson(res, 200, { message: "Logged out" });
}

async function tabCloseLogout(req, res) {
  const body = await parseJsonBody(req).catch(() => ({}));
  const token = String(body.accessToken || "");
  const payload = token ? verifyJwt(token) : null;
  const refreshToken = parseCookies(req).talme_refresh;
  let session = null;
  if (payload?.sub && payload?.sid) {
    session = db.prepare(`
      SELECT * FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL
    `).get(payload.sid, payload.sub);
    if (payload.authSid) {
      await revokeAuthSessionByKey(payload.authSid).catch(() => {});
    }
  }
  if (!session && refreshToken) {
    session = db.prepare(`
      SELECT * FROM sessions WHERE refresh_token_hash = ? AND revoked_at IS NULL
    `).get(sha256(refreshToken));
    await revokeAuthSessionByRefreshHash(sha256(refreshToken)).catch(() => {});
  }
  if (!session) return sendJson(res, 200, { message: "No active session" });

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
  const closedAt = now();
  db.prepare("UPDATE sessions SET revoked_at = ?, last_seen_at = ? WHERE id = ?").run(closedAt, closedAt, session.id);
  if (session.device_id) {
    db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(closedAt, session.device_id);
  }
  if (user) {
    logLogin(req, user, true, "Tab Closed Logout");
    audit(req, user.id, "Tab Closed Logout", { sessionId: session.id }, "session", session.id);
  }
  clearRefreshCookie(res);
  sendJson(res, 200, { message: "Session closed" });
}

async function logoutAll(req, res) {
  const context = await requireAuth(req, res, "auth.logout_all");
  if (!context) return;
  db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now(), context.user.id);
  if (context.user.email) await revokeAuthSessionsByEmail(context.user.email).catch(() => {});
  clearRefreshCookie(res);
  audit(req, context.user.id, "Logout from All Devices");
  sendJson(res, 200, { message: "Logged out from all devices" });
}

async function me(req, res) {
  const context = await requireAuth(req, res);
  if (!context) return;
  sendJson(res, 200, { user: context.safeUser });
}

async function loginActivity(req, res) {
  const context = await requireAuth(req, res, "auth.login_activity.view");
  if (!context) return;
  const rows = db.prepare(`
    SELECT action, success, reason, ip_address, device, browser, timestamp
    FROM login_history WHERE user_id = ? ORDER BY id DESC LIMIT 50
  `).all(context.user.id);
  sendJson(res, 200, { items: rows });
}

async function deviceHistory(req, res) {
  const context = await requireAuth(req, res, "auth.device_history.view");
  if (!context) return;
  const rows = db.prepare(`
    SELECT id, ip_address, browser, device, last_seen_at, created_at
    FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC
  `).all(context.user.id);
  sendJson(res, 200, { items: rows });
}

async function auditLogs(req, res) {
  const context = await requireAuth(req, res, "audit_logs.view");
  if (!context) return;
  const rows = db.prepare(`
    SELECT al.id, u.email, al.action_type, al.entity_type, al.entity_id, al.metadata, al.ip_address, al.device, al.browser, al.timestamp
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.id DESC
    LIMIT 100
  `).all();
  sendJson(res, 200, { items: rows });
}

async function adminUsers(req, res) {
  const context = await requireAuth(req, res, "admin.users.manage");
  if (!context) return;
  const rows = db.prepare(`
    SELECT u.id, u.name, u.email, u.status, group_concat(r.name, ', ') AS roles, u.created_at
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    GROUP BY u.id
    ORDER BY u.id
  `).all();
  sendJson(res, 200, { items: rows });
}

async function adminRegisteredDevices(req, res) {
  const context = await requireAuth(req, res);
  if (!context) return;
  if (!hasAnyRole(context, ["super_admin", "platform_admin"])) {
    audit(req, context.user.id, "Forbidden Access", { feature: "admin_registered_devices", path: req.url });
    return sendError(res, 403, "Forbidden");
  }

  const rows = db.prepare(`
    SELECT d.id, u.name, u.email, u.phone, group_concat(DISTINCT r.name) AS roles,
           d.device, d.browser, d.ip_address, d.user_agent, d.created_at, d.last_seen_at,
           COUNT(s.id) AS sessions,
           SUM(CASE WHEN s.revoked_at IS NULL AND s.expires_at > ? THEN 1 ELSE 0 END) AS active_sessions
    FROM devices d
    JOIN users u ON u.id = d.user_id
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    LEFT JOIN sessions s ON s.device_id = d.id
    GROUP BY d.id
    ORDER BY d.last_seen_at DESC
    LIMIT 200
  `).all(now());
  sendJson(res, 200, { items: rows });
}

async function adminSecurityLive(req, res) {
  const context = await requireAuth(req, res);
  if (!context) return;
  if (!hasAnyRole(context, ["super_admin", "platform_admin"])) {
    audit(req, context.user.id, "Forbidden Access", { feature: "admin_security_live", path: req.url });
    return sendError(res, 403, "Forbidden");
  }

  const today = new Date().toISOString().slice(0, 10);
  const liveCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const activeSessionWhere = "revoked_at IS NULL AND expires_at > ?";
  const one = (sql, ...params) => db.prepare(sql).get(...params)?.value || 0;

  const stats = {
    totalRegisteredUsers: one("SELECT COUNT(*) AS value FROM users"),
    totalActiveUsers: one("SELECT COUNT(*) AS value FROM users WHERE status = 'active'"),
    liveOnlineUsers: one(`SELECT COUNT(DISTINCT user_id) AS value FROM sessions WHERE ${activeSessionWhere} AND last_seen_at >= ?`, now(), liveCutoff),
    totalLoggedInToday: one("SELECT COUNT(*) AS value FROM login_history WHERE success = 1 AND date(timestamp) = date(?)", today),
    totalLoggedOutToday: one("SELECT COUNT(*) AS value FROM login_history WHERE action IN ('Logout', 'Logout from All Devices') AND date(timestamp) = date(?)", today),
    activeDevices: one(`SELECT COUNT(DISTINCT device_id) AS value FROM sessions WHERE ${activeSessionWhere} AND device_id IS NOT NULL`, now()),
    mobileDevices: one(`
      SELECT COUNT(DISTINCT s.device_id) AS value
      FROM sessions s
      JOIN devices d ON d.id = s.device_id
      WHERE s.revoked_at IS NULL
        AND s.expires_at > ?
        AND (lower(d.user_agent) LIKE '%mobile%' OR lower(d.user_agent) LIKE '%iphone%' OR lower(d.user_agent) LIKE '%android%')
        AND lower(d.user_agent) NOT LIKE '%ipad%'
        AND lower(d.user_agent) NOT LIKE '%tablet%'
    `, now()),
    desktopDevices: one(`
      SELECT COUNT(DISTINCT s.device_id) AS value
      FROM sessions s
      JOIN devices d ON d.id = s.device_id
      WHERE s.revoked_at IS NULL
        AND s.expires_at > ?
        AND (lower(d.device) IN ('windows', 'macos', 'linux') OR lower(d.user_agent) LIKE '%windows%' OR lower(d.user_agent) LIKE '%macintosh%' OR lower(d.user_agent) LIKE '%linux%')
        AND lower(d.user_agent) NOT LIKE '%mobile%'
        AND lower(d.user_agent) NOT LIKE '%android%'
        AND lower(d.user_agent) NOT LIKE '%iphone%'
        AND lower(d.user_agent) NOT LIKE '%ipad%'
        AND lower(d.user_agent) NOT LIKE '%tablet%'
    `, now()),
    tabletDevices: one(`
      SELECT COUNT(DISTINCT s.device_id) AS value
      FROM sessions s
      JOIN devices d ON d.id = s.device_id
      WHERE s.revoked_at IS NULL
        AND s.expires_at > ?
        AND (lower(d.user_agent) LIKE '%ipad%' OR lower(d.user_agent) LIKE '%tablet%')
    `, now()),
    failedLoginAttempts: one("SELECT COUNT(*) AS value FROM login_history WHERE success = 0 AND date(timestamp) = date(?)", today)
  };

  const sessionDetails = db.prepare(`
    SELECT s.id AS session_id, u.id, u.name, u.email, u.phone, u.status AS user_status,
           group_concat(DISTINCT r.name) AS roles,
           COALESCE(d.device, 'Unknown') AS device,
           COALESCE(d.browser, 'Unknown') AS browser,
           COALESCE(d.ip_address, s.ip_address, 'Unknown') AS ip_address,
           s.remember_me, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
           CASE
             WHEN s.revoked_at IS NOT NULL THEN 'Logged out'
             WHEN s.expires_at <= ? THEN 'Expired'
             WHEN s.last_seen_at >= ? THEN 'Online'
             ELSE 'Active'
           END AS session_status
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN devices d ON d.id = s.device_id
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    GROUP BY s.id
    ORDER BY s.last_seen_at DESC
    LIMIT 100
  `).all(now(), liveCutoff);
  const liveOnlineUsers = sessionDetails.filter(user => user.session_status === "Online");

  sendJson(res, 200, {
    stats,
    liveOnlineUsers,
    sessionDetails,
    onlineUsers: liveOnlineUsers,
    refreshedAt: now()
  });
}

async function platformCompanies(req, res) {
  const context = await requireAuth(req, res, "platform.companies.manage");
  if (!context) return;
  const rows = db.prepare(`
    SELECT c.*, COUNT(cu.user_id) AS users
    FROM companies c
    LEFT JOIN company_users cu ON cu.company_id = c.id
    GROUP BY c.id
    ORDER BY c.id
  `).all();
  sendJson(res, 200, { items: rows });
}

async function shouldUsePersistentHrEmployees() {
  if (isProductionRuntime) return true;
  if (!employeeStore.hasEmployeeDatabase()) return false;
  return employeeStore.hasEmployeeTables().catch(() => false);
}

async function hrEmployees(req, res) {
  const context = await requireAuth(req, res, "employees.manage");
  if (!context) return;
  if (await shouldUsePersistentHrEmployees()) {
    return sendJson(res, 200, { items: await attachEmployeeAudits(await employeeStore.listEmployees()) });
  }
  const rows = db.prepare(`
    SELECT u.id, ea.employee_code, u.name,
           CASE WHEN lower(u.email) LIKE 'local-import-%@talme.local' THEN '' ELSE u.email END AS email,
           u.phone, ea.designation, ea.department,
           ea.location, ea.keywords, ea.experience, ea.current_company, ea.current_designation,
           ea.cv_file_name, ea.cv_stored_name
    FROM employee_accounts ea
    JOIN users u ON u.id = ea.user_id
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE r.slug = 'employee'
    ORDER BY u.name
  `).all();
  sendJson(res, 200, { items: await attachEmployeeAudits(rows) });
}

async function importedHrEmployees(req, res) {
  const context = await requireAuth(req, res, "employees.manage");
  if (!context) return;
  if (await shouldUsePersistentHrEmployees()) {
    const payload = await employeeStore.listImportedEmployees();
    return sendJson(res, 200, {
      items: await attachEmployeeAudits(payload.items),
      summary: payload.summary
    });
  }

  const filePath = path.join(__dirname, "..", "data", "imported-employees.json");
  if (!fs.existsSync(filePath)) {
    return sendJson(res, 200, { items: [], summary: { importedRows: 0, skippedRows: 0 } });
  }

  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const items = (Array.isArray(payload.items) ? payload.items : []).map(item => ({
    ...item,
    source: item.source || "imported-employees.json"
  }));
  sendJson(res, 200, {
    items: await attachEmployeeAudits(items),
    summary: {
      source: payload.source || "imported-employees.json",
      generatedAt: payload.generatedAt || null,
      totalRows: payload.totalRows || 0,
      importedRows: payload.importedRows || 0,
      skippedRows: payload.skippedRows || 0
    }
  });
}

function companyIdForUser(userId) {
  const employee = db.prepare("SELECT company_id FROM employee_accounts WHERE user_id = ? AND company_id IS NOT NULL").get(userId);
  if (employee?.company_id) return employee.company_id;
  const roleCompany = db.prepare("SELECT company_id FROM user_roles WHERE user_id = ? AND company_id IS NOT NULL LIMIT 1").get(userId);
  if (roleCompany?.company_id) return roleCompany.company_id;
  return createCompany("Talme Technologies", "talme.test").id;
}

async function createEmployee(req, res) {
  const context = await requireAuth(req, res, "employees.manage");
  if (!context) return;
  const isMultipart = (req.headers["content-type"] || "").includes("multipart/form-data");
  const form = isMultipart ? await parseMultipartForm(req) : { fields: await parseJsonBody(req), files: {} };
  const body = form.fields;
  const record = normalizeCandidateRecord(body);
  if (!record.email) return sendError(res, 400, "email is required");
  const cv = saveCandidateCv(form.files.cv);
  const name = record.fullName;
  const email = record.email;
  const phone = record.phone;
  const password = randomToken(24);
  const employeeCode = String(body.employeeCode || "").trim();
  const designation = record.currentDesignation || "Employee";
  const department = record.currentCompany || record.location || "General";

  if (await shouldUsePersistentHrEmployees()) {
    const saved = await employeeStore.saveManualEmployee({ record, body: { ...body, employeeCode }, cv });
    const auditedEmployee = await writeEmployeeAudit(saved.employee, context, saved.created ? "created" : "edited");
    audit(req, context.user.id, "Employee Add", {
      employeeId: auditedEmployee.id,
      email,
      employeeCode: auditedEmployee.employee_code,
      cvFileName: auditedEmployee.cv_file_name
    }, "hr_employee_record", auditedEmployee.id);
    return sendJson(res, saved.created ? 201 : 200, {
      success: true,
      message: "Employee saved successfully.",
      created: Boolean(saved.created),
      updated: !saved.created,
      employee: employeeResponse(auditedEmployee)
    });
  }

  const companyId = companyIdForUser(context.user.id);
  const existingUser = getUserByEmail(email);
  const phoneUser = phone ? getUserByPhone(phone) : null;
  if (phoneUser && (!existingUser || phoneUser.id !== existingUser.id)) {
    return sendError(res, 409, "Phone is already registered");
  }

  const userId = existingUser
    ? existingUser.id
    : createUser({ name, email, phone, password, roleSlug: "employee", companyId, emailVerified: true });
  if (existingUser) {
    db.prepare(`
      UPDATE users
      SET name = ?, phone = COALESCE(?, phone), phone_verified = CASE WHEN ? IS NULL THEN phone_verified ELSE 1 END, updated_at = ?
      WHERE id = ?
    `).run(name, phone || null, phone || null, now(), userId);
    assignRole(userId, "employee", companyId);
  }
  const existingCompanyUser = db.prepare("SELECT id FROM company_users WHERE company_id = ? AND user_id = ? LIMIT 1").get(companyId, userId);
  if (!existingCompanyUser) {
    db.prepare(`
      INSERT INTO company_users (company_id, user_id, role_title, status, invited_by, created_at)
      VALUES (?, ?, 'employee', 'active', ?, ?)
    `).run(companyId, userId, context.user.id, now());
  }
  const existingEmployee = db.prepare("SELECT id, employee_code, cv_file_name, cv_stored_name FROM employee_accounts WHERE user_id = ?").get(userId);
  const employeeCodeValue = employeeCode || existingEmployee?.employee_code || `EMP-${userId}`;
  const cvFileName = cv.cvFileName || existingEmployee?.cv_file_name || null;
  const cvStoredName = cv.cvStoredName || existingEmployee?.cv_stored_name || null;
  if (existingEmployee) {
    if (cv.cvStoredName && existingEmployee.cv_stored_name && existingEmployee.cv_stored_name !== cv.cvStoredName) {
      removeStoredCv(existingEmployee.cv_stored_name);
    }
    db.prepare(`
      UPDATE employee_accounts
      SET company_id = ?, employee_code = ?, designation = ?, department = ?, location = ?, keywords = ?,
          experience = ?, current_company = ?, current_designation = ?, cv_file_name = ?, cv_stored_name = ?
      WHERE user_id = ?
    `).run(
      companyId,
      employeeCodeValue,
      designation,
      department,
      record.location,
      record.keywords,
      record.experience,
      record.currentCompany,
      record.currentDesignation,
      cvFileName,
      cvStoredName,
      userId
    );
  } else {
  db.prepare(`
    INSERT INTO employee_accounts
      (user_id, company_id, employee_code, designation, department, location, keywords, experience,
       current_company, current_designation, cv_file_name, cv_stored_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    companyId,
    employeeCodeValue,
    designation,
    department,
    record.location,
    record.keywords,
    record.experience,
    record.currentCompany,
    record.currentDesignation,
    cvFileName,
    cvStoredName,
    now()
  );
  }

  const savedEmployee = db.prepare(`
    SELECT u.id, ea.employee_code, u.name,
           CASE WHEN lower(u.email) LIKE 'local-import-%@talme.local' THEN '' ELSE u.email END AS email,
           u.phone, ea.designation, ea.department,
           ea.location, ea.keywords, ea.experience, ea.current_company, ea.current_designation,
           ea.cv_file_name, ea.cv_stored_name
    FROM employee_accounts ea
    JOIN users u ON u.id = ea.user_id
    WHERE u.id = ?
  `).get(userId);
  const auditedEmployee = await writeEmployeeAudit(savedEmployee, context, existingEmployee ? "edited" : "created");

  audit(req, context.user.id, "Employee Add", {
    userId,
    email,
    employeeCode: employeeCodeValue,
    cvFileName
  }, "user", userId);
  sendJson(res, existingUser || existingEmployee ? 200 : 201, {
    success: true,
    message: existingEmployee ? "Employee updated successfully" : "Employee added successfully",
    employee: employeeResponse(auditedEmployee)
  });
}

function cleanupCandidateImportDrafts() {
  const cutoff = Date.now() - candidateImportTtlMs;
  for (const [id, draft] of candidateImportDrafts.entries()) {
    if (draft.createdAt < cutoff) candidateImportDrafts.delete(id);
  }
}

function collectRequestBuffer(req, limit = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        const error = new Error("Upload file must be 50 MB or less");
        error.statusCode = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function parseMultipartForm(req) {
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    const error = new Error("multipart/form-data boundary is missing");
    error.statusCode = 400;
    throw error;
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const body = await collectRequestBuffer(req);
  let offset = body.indexOf(boundary);
  const fields = {};
  const files = {};

  while (offset !== -1) {
    let partStart = offset + boundary.length;
    if (body.slice(partStart, partStart + 2).toString() === "--") break;
    if (body.slice(partStart, partStart + 2).toString() === "\r\n") partStart += 2;

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd === -1) break;

    const headers = body.slice(partStart, headerEnd).toString("utf8");
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;

    let contentEnd = nextBoundary;
    if (body[contentEnd - 2] === 13 && body[contentEnd - 1] === 10) contentEnd -= 2;

    const name = headers.match(/name="([^"]+)"/i)?.[1];
    const filename = headers.match(/filename="([^"]*)"/i)?.[1];
    const contentType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || "";
    const buffer = body.slice(headerEnd + 4, contentEnd);
    if (name && filename) {
      files[name] = { filename, contentType, buffer };
    } else if (name) {
      fields[name] = buffer.toString("utf8");
    }

    offset = nextBoundary;
  }

  return { fields, files };
}

async function parseMultipartFile(req) {
  const form = await parseMultipartForm(req);
  if (form.files.file) return form.files.file;

  const error = new Error("File field is required");
  error.statusCode = 400;
  throw error;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function parseCandidateWorkbook(file) {
  const extension = path.extname(file.filename).toLowerCase();
  if (![".xlsx", ".xls", ".csv"].includes(extension)) {
    const error = new Error("Only .xlsx, .xls, and .csv files are allowed");
    error.statusCode = 400;
    throw error;
  }
  const allowedTypes = new Set([
    "",
    "application/octet-stream",
    "text/csv",
    "application/csv",
    "text/plain",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ]);
  if (file.contentType && !allowedTypes.has(file.contentType)) {
    const error = new Error("Uploaded file type is not allowed");
    error.statusCode = 400;
    throw error;
  }

  if (extension === ".csv") {
    return parseCsvRows(file.buffer.toString("utf8"));
  }

  const workbook = xlsx.read(file.buffer, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    const error = new Error("Uploaded workbook does not contain any sheets");
    error.statusCode = 400;
    throw error;
  }
  return xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
}

function trimCell(value) {
  return value == null ? "" : String(value).trim();
}

function normalizePhone(value) {
  let phone = trimCell(value).replace(/[^\d+]/g, "");
  if (phone.startsWith("+91")) phone = phone.slice(3);
  if (phone.startsWith("91") && phone.length === 12) phone = phone.slice(2);
  return phone.replace(/[^\d]/g, "");
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function passwordResetHash(email, value, role = "") {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET || "")
    .update(`${String(email || "").trim().toLowerCase()}:${String(role || "").trim()}:${String(value || "")}`)
    .digest("hex");
}

function normalizeCandidateRecord(raw) {
  const record = {
    fullName: trimCell(raw.fullName),
    email: trimCell(raw.email).toLowerCase() || null,
    phone: normalizePhone(raw.phone),
    location: trimCell(raw.location),
    keywords: trimCell(raw.keywords),
    experience: trimCell(raw.experience) === "" ? null : Number(trimCell(raw.experience)),
    currentCompany: trimCell(raw.currentCompany) || null,
    currentDesignation: trimCell(raw.currentDesignation) || null
  };
  const reasons = [];
  for (const column of ["fullName", "phone", "location", "keywords"]) {
    if (!record[column]) reasons.push(`${column} is required`);
  }
  if (record.email && !validEmail(record.email)) reasons.push("Invalid email format");
  if (record.experience != null && (Number.isNaN(record.experience) || record.experience < 0)) {
    reasons.push("experience must be a positive number");
  }
  if (reasons.length) {
    const error = new Error(reasons.join(", "));
    error.statusCode = 400;
    throw error;
  }
  return record;
}

function saveCandidateCv(file) {
  if (!file?.filename || !file.buffer?.length) return {};
  const extension = path.extname(file.filename).toLowerCase();
  if (![".pdf", ".doc", ".docx"].includes(extension)) {
    const error = new Error("CV must be a PDF, DOC, or DOCX file");
    error.statusCode = 400;
    throw error;
  }

  const storedName = `${Date.now()}-${randomToken(8)}${extension}`;
  fs.mkdirSync(cvUploadDir, { recursive: true });
  fs.writeFileSync(path.join(cvUploadDir, storedName), file.buffer);
  return {
    cvFileName: path.basename(file.filename),
    cvStoredName: storedName
  };
}

function removeStoredCv(storedName) {
  if (!storedName) return;
  const filePath = path.join(cvUploadDir, storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function candidateCvPath(storedName) {
  const filePath = path.join(cvUploadDir, path.basename(storedName || ""));
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(path.normalize(cvUploadDir))) return null;
  return normalized;
}

function readZipEntry(buffer, entryName) {
  const signature = 0x02014b50;
  for (let offset = 0; offset < buffer.length - 46; offset += 1) {
    if (buffer.readUInt32LE(offset) !== signature) continue;
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    if (fileName !== entryName) {
      offset += 45 + fileNameLength + extraLength + commentLength;
      continue;
    }

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    if (compression === 0) return compressed;
    if (compression === 8) return zlib.inflateRawSync(compressed);
    return null;
  }
  return null;
}

function decodeXmlEntities(value) {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function extractDocxText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const documentXml = readZipEntry(buffer, "word/document.xml");
  if (!documentXml) return "";
  return documentXml.toString("utf8")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .split(/\n+/)
    .map(line => decodeXmlEntities(line).trim())
    .filter(Boolean)
    .join("\n\n");
}

function importedEmployeesFilePath() {
  return path.join(__dirname, "..", "data", "imported-employees.json");
}

function readImportedEmployeesPayload() {
  const filePath = importedEmployeesFilePath();
  if (!fs.existsSync(filePath)) return { items: [] };
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(payload.items)) payload.items = [];
  return payload;
}

function publicEmployeeRows() {
  return db.prepare(`
    SELECT u.id, ea.employee_code, u.name,
           CASE WHEN lower(u.email) LIKE 'local-import-%@talme.local' THEN '' ELSE u.email END AS email,
           u.phone
    FROM employee_accounts ea
    JOIN users u ON u.id = ea.user_id
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE r.slug = 'employee'
  `).all();
}

function mergedEmployeeProfileCount(dbItems, importedItems) {
  const seen = new Set();
  let count = 0;
  for (const employee of [...dbItems, ...importedItems]) {
    const key = `${String(employee.email || "").toLowerCase()}|${String(employee.phone || "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    count += 1;
  }
  return count;
}

async function publicProfileCount(req, res) {
  if (await shouldUsePersistentHrEmployees()) {
    const counts = await employeeStore.publicProfileCount();
    return sendJson(res, 200, {
      success: true,
      totalProfiles: counts.totalProfiles,
      profiles: counts.totalProfiles,
      databaseProfiles: counts.databaseProfiles,
      importedProfiles: counts.importedProfiles,
      source: "hr_employee_records",
      generatedAt: null
    });
  }
  const payload = readImportedEmployeesPayload();
  const dbItems = publicEmployeeRows();
  const totalProfiles = mergedEmployeeProfileCount(dbItems, payload.items);
  sendJson(res, 200, {
    success: true,
    totalProfiles,
    profiles: totalProfiles,
    databaseProfiles: dbItems.length,
    importedProfiles: payload.items.length,
    source: "employee_accounts + imported-employees.json",
    generatedAt: payload.generatedAt || null
  });
}

function writeImportedEmployeesPayload(payload) {
  fs.writeFileSync(importedEmployeesFilePath(), `${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeEmployeeUpdate(raw) {
  const employeeCodeNumber = trimCell(raw.employeeCode || raw.employee_code).match(/\d+/g)?.at(-1) || "";
  const record = {
    name: trimCell(raw.name || raw.fullName),
    email: trimCell(raw.email).toLowerCase() || null,
    phone: normalizePhone(raw.phone),
    employeeCode: employeeCodeNumber ? employeeCodeNumber.padStart(5, "0") : "",
    designation: trimCell(raw.designation),
    department: trimCell(raw.department),
    location: trimCell(raw.location),
    keywords: trimCell(raw.keywords),
    experience: trimCell(raw.experience) === "" ? null : Number(trimCell(raw.experience)),
    currentCompany: trimCell(raw.currentCompany || raw.current_company) || null,
    currentDesignation: trimCell(raw.currentDesignation || raw.current_designation) || null
  };
  const reasons = [];
  if (!record.name) reasons.push("name is required");
  if (record.email && !validEmail(record.email)) reasons.push("Invalid email format");
  if (record.experience != null && (Number.isNaN(record.experience) || record.experience < 0)) {
    reasons.push("experience must be a positive number");
  }
  if (reasons.length) {
    const error = new Error(reasons.join(", "));
    error.statusCode = 400;
    throw error;
  }
  return record;
}

function employeeAuditRecordKey(record) {
  if (record?.source === "imported-employees.json" || record?.source === "imported") {
    const key = record.id || record.employee_code || record.email || record.phone || record.rowNumber;
    return `imported:${String(key || "").toLowerCase()}`;
  }
  if (record?.id != null) return `local-user:${record.id}`;
  if (record?.user_id != null) return `local-user:${record.user_id}`;
  const key = record?.employee_code || record?.email || record?.phone;
  return `employee:${String(key || "").toLowerCase()}`;
}

function employeeAuditIdentity(record) {
  return {
    recordKey: employeeAuditRecordKey(record),
    employeeUserId: record?.id ?? record?.user_id ?? null,
    employeeEmail: record?.email || null,
    employeePhone: record?.phone || null
  };
}

async function employeeAuditEditor(context) {
  const authRole = context.safeUser?.primaryRole || context.safeUser?.roles?.[0]?.slug || null;
  const authUser = context.user?.email ? await findAuthUserByEmail(context.user.email, authRole).catch(() => null) : null;
  return {
    editorAuthUserId: authUser?.id || null,
    editorName: context.user?.name || authUser?.full_name || "Unknown user",
    editorEmail: context.user?.email || authUser?.email || null
  };
}

function attachEmployeeAudit(record, audit) {
  if (!record) return record;
  const action = audit?.action || null;
  return {
    ...record,
    audit_action: action,
    audit_user_name: action === "created" ? audit?.createdByName || null : audit?.lastEditedByName || null,
    audit_user_email: action === "created" ? audit?.createdByEmail || null : audit?.lastEditedByEmail || null,
    audit_at: action === "created" ? audit?.createdAt || null : audit?.lastEditedAt || null,
    created_by_name: audit?.createdByName || null,
    created_by_email: audit?.createdByEmail || null,
    created_at_audit: audit?.createdAt || null,
    last_edited_by_name: audit?.lastEditedByName || null,
    last_edited_by_email: audit?.lastEditedByEmail || null,
    last_edited_at: audit?.lastEditedAt || null
  };
}

async function attachEmployeeAudits(records) {
  const items = Array.isArray(records) ? records : [];
  const audits = await getEmployeeRecordAudits(items.map(employeeAuditRecordKey));
  return items.map(record => attachEmployeeAudit(record, audits.get(employeeAuditRecordKey(record))));
}

async function writeEmployeeAudit(record, context, action) {
  const identity = employeeAuditIdentity(record);
  const audit = await upsertEmployeeRecordAudit({
    ...identity,
    ...await employeeAuditEditor(context),
    action
  });
  return attachEmployeeAudit(record, audit);
}

function employeeResponse(record) {
  return {
    id: record.id,
    employee_code: record.employee_code,
    name: record.name,
    email: record.email,
    phone: record.phone,
    designation: record.designation,
    department: record.department,
    location: record.location,
    keywords: record.keywords,
    experience: record.experience,
    current_company: record.current_company,
    current_designation: record.current_designation,
    cv_file_name: record.cv_file_name,
    cv_stored_name: record.cv_stored_name,
    source: record.source,
    rowNumber: record.rowNumber,
    audit_action: record.audit_action,
    audit_user_name: record.audit_user_name,
    audit_user_email: record.audit_user_email,
    audit_at: record.audit_at,
    created_by_name: record.created_by_name,
    created_by_email: record.created_by_email,
    created_at_audit: record.created_at_audit,
    last_edited_by_name: record.last_edited_by_name,
    last_edited_by_email: record.last_edited_by_email,
    last_edited_at: record.last_edited_at
  };
}

function findImportedEmployeeIndex(items, employeeId) {
  const id = String(employeeId || "").toLowerCase();
  return items.findIndex(item => {
    const keys = [item.id, item.employee_code, item.email, item.phone];
    return keys.some(key => String(key || "").toLowerCase() === id);
  });
}

async function findEmployeeCvRecord(employeeId) {
  const id = decodeURIComponent(String(employeeId || ""));
  if (await shouldUsePersistentHrEmployees()) {
    const employee = await employeeStore.findEmployeeByIdentifier(id);
    if (employee) return employee;
  }
  const importedPayload = readImportedEmployeesPayload();
  const importedIndex = findImportedEmployeeIndex(importedPayload.items, id);
  if (importedIndex >= 0) return importedPayload.items[importedIndex];

  return db.prepare(`
    SELECT u.id, ea.employee_code, u.email, u.phone, ea.cv_file_name, ea.cv_stored_name
    FROM employee_accounts ea
    JOIN users u ON u.id = ea.user_id
    WHERE u.id = ? OR ea.employee_code = ? OR lower(u.email) = lower(?) OR u.phone = ?
    LIMIT 1
  `).get(Number(id) || -1, id, id, id);
}

async function updateHrEmployee(req, res, employeeId) {
  const context = await requireAuth(req, res, "employees.manage");
  if (!context) return;

  const isMultipart = (req.headers["content-type"] || "").includes("multipart/form-data");
  const form = isMultipart ? await parseMultipartForm(req) : { fields: await parseJsonBody(req), files: {} };
  const data = normalizeEmployeeUpdate(form.fields);
  const cv = saveCandidateCv(form.files.cv);
  const id = decodeURIComponent(String(employeeId || ""));

  if (await shouldUsePersistentHrEmployees()) {
    let updated = await employeeStore.updateEmployee(id, data, cv);
    updated = await writeEmployeeAudit(updated, context, "edited");
    audit(req, context.user.id, "Employee Update", { employeeId: id, imported: updated.source === "imported-employees.json" || updated.source === "imported", cvFileName: updated.cv_file_name }, "hr_employee_record", id);
    return sendJson(res, 200, {
      success: true,
      message: "Employee updated successfully",
      employee: employeeResponse(updated)
    });
  }

  const importedPayload = readImportedEmployeesPayload();
  const importedIndex = findImportedEmployeeIndex(importedPayload.items, id);
  if (importedIndex >= 0) {
    const existing = importedPayload.items[importedIndex];
    if (cv.cvStoredName && existing.cv_stored_name && existing.cv_stored_name !== cv.cvStoredName) {
      removeStoredCv(existing.cv_stored_name);
    }
    let updated = {
      ...existing,
      source: existing.source || "imported-employees.json",
      employee_code: data.employeeCode || existing.employee_code,
      name: data.name,
      email: data.email,
      phone: data.phone,
      designation: data.designation || data.currentDesignation || "Employee",
      department: data.department || data.location || "",
      location: data.location,
      keywords: data.keywords,
      experience: data.experience,
      current_company: data.currentCompany,
      current_designation: data.currentDesignation || data.designation || "Employee",
      cv_file_name: cv.cvFileName || existing.cv_file_name || null,
      cv_stored_name: cv.cvStoredName || existing.cv_stored_name || null,
      updatedAt: now()
    };
    updated = await writeEmployeeAudit(updated, context, "edited");
    importedPayload.items[importedIndex] = updated;
    importedPayload.generatedAt = now();
    writeImportedEmployeesPayload(importedPayload);
    audit(req, context.user.id, "Employee Update", { employeeId: id, imported: true, cvFileName: updated.cv_file_name }, "imported_employee", id);
    return sendJson(res, 200, {
      success: true,
      message: "Employee updated successfully",
      employee: employeeResponse(updated)
    });
  }

  const employee = db.prepare(`
    SELECT u.id, ea.id AS employee_account_id, ea.company_id, ea.employee_code, u.name, u.email, u.phone,
           ea.designation, ea.department, ea.location, ea.keywords, ea.experience, ea.current_company,
           ea.current_designation, ea.cv_file_name, ea.cv_stored_name
    FROM employee_accounts ea
    JOIN users u ON u.id = ea.user_id
    WHERE u.id = ? OR ea.employee_code = ?
    LIMIT 1
  `).get(Number(id) || -1, id);
  if (!employee) return sendError(res, 404, "Employee not found");

  if (data.email) {
    const existingEmailUser = getUserByEmail(data.email);
    if (existingEmailUser && existingEmailUser.id !== employee.id) {
      return sendError(res, 409, "Email is already registered");
    }
  }
  if (data.phone) {
    const existingPhoneUser = getUserByPhone(data.phone);
    if (existingPhoneUser && existingPhoneUser.id !== employee.id) {
      return sendError(res, 409, "Phone is already registered");
    }
  }

  if (cv.cvStoredName && employee.cv_stored_name && employee.cv_stored_name !== cv.cvStoredName) {
    removeStoredCv(employee.cv_stored_name);
  }
  db.prepare(`
    UPDATE users
    SET name = ?, email = COALESCE(?, email), phone = ?, phone_verified = CASE WHEN ? = '' THEN phone_verified ELSE 1 END, updated_at = ?
    WHERE id = ?
  `).run(data.name, data.email, data.phone, data.phone, now(), employee.id);
  db.prepare(`
    UPDATE employee_accounts
    SET employee_code = ?, designation = ?, department = ?, location = ?, keywords = ?, experience = ?,
        current_company = ?, current_designation = ?, cv_file_name = ?, cv_stored_name = ?
    WHERE user_id = ?
  `).run(
    data.employeeCode || employee.employee_code,
    data.designation || data.currentDesignation || "Employee",
    data.department || data.location || "",
    data.location,
    data.keywords,
    data.experience,
    data.currentCompany,
    data.currentDesignation || data.designation || "Employee",
    cv.cvFileName || employee.cv_file_name || null,
    cv.cvStoredName || employee.cv_stored_name || null,
    employee.id
  );

  let updated = db.prepare(`
    SELECT u.id, ea.employee_code, u.name, u.email, u.phone, ea.designation, ea.department,
           ea.location, ea.keywords, ea.experience, ea.current_company, ea.current_designation,
           ea.cv_file_name, ea.cv_stored_name
    FROM employee_accounts ea
    JOIN users u ON u.id = ea.user_id
    WHERE u.id = ?
  `).get(employee.id);
  updated = await writeEmployeeAudit(updated, context, "edited");
  audit(req, context.user.id, "Employee Update", { employeeId: employee.id, imported: false, cvFileName: updated.cv_file_name }, "user", employee.id);
  sendJson(res, 200, {
    success: true,
    message: "Employee updated successfully",
    employee: employeeResponse(updated)
  });
}

async function hrEmployeeCv(req, res, employeeId) {
  const context = await requireAuth(req, res, "employees.manage");
  if (!context) return;

  const record = await findEmployeeCvRecord(employeeId);
  if (!record?.cv_stored_name) return sendError(res, 404, "No CV file is attached");
  const filePath = candidateCvPath(record.cv_stored_name);
  if (!filePath || !fs.existsSync(filePath)) return sendError(res, 404, "CV file was not found");

  const fileName = path.basename(record.cv_file_name || record.cv_stored_name);
  const extension = path.extname(fileName).toLowerCase();
  const types = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };
  res.writeHead(200, {
    "Content-Type": types[extension] || "application/octet-stream",
    "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
    "X-Content-Type-Options": "nosniff"
  });
  fs.createReadStream(filePath).pipe(res);
}

async function hrEmployeeCvPreview(req, res, employeeId) {
  const context = await requireAuth(req, res, "employees.manage");
  if (!context) return;

  const record = await findEmployeeCvRecord(employeeId);
  if (!record?.cv_stored_name) return sendError(res, 404, "No CV file is attached");
  const filePath = candidateCvPath(record.cv_stored_name);
  if (!filePath || !fs.existsSync(filePath)) return sendError(res, 404, "CV file was not found");

  const fileName = path.basename(record.cv_file_name || record.cv_stored_name);
  const extension = path.extname(fileName).toLowerCase();
  if (extension !== ".docx") {
    return sendJson(res, 200, {
      fileName,
      previewType: extension === ".pdf" ? "pdf" : "unsupported",
      text: ""
    });
  }

  const text = extractDocxText(filePath);
  sendJson(res, 200, {
    fileName,
    previewType: "text",
    text: text || "No readable text was found in this DOCX file."
  });
}

function parseCandidateRows(rows) {
  if (!rows.length) {
    const error = new Error("Uploaded file is empty");
    error.statusCode = 400;
    throw error;
  }

  const headers = rows[0].map(trimCell);
  const required = ["fullName", "phone", "location", "keywords"];
  const missing = required.filter(column => !headers.includes(column));
  if (missing.length) {
    const error = new Error(`Missing required columns: ${missing.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const records = [];
  const failedRows = [];
  let totalRows = 0;

  rows.slice(1).forEach((values, index) => {
    const rowNumber = index + 2;
    const raw = {};
    headers.forEach((header, headerIndex) => {
      raw[header] = trimCell(values[headerIndex]);
    });
    if (Object.values(raw).every(value => value === "")) return;

    totalRows += 1;
    const record = {
      fullName: raw.fullName || "",
      email: raw.email ? raw.email.toLowerCase() : null,
      phone: normalizePhone(raw.phone),
      location: raw.location || "",
      keywords: raw.keywords || "",
      experience: raw.experience === "" || raw.experience == null ? null : Number(raw.experience),
      currentCompany: raw.currentCompany || null,
      currentDesignation: raw.currentDesignation || null
    };
    const reasons = [];

    for (const column of required) {
      if (!record[column]) reasons.push(`${column} is required`);
    }
    if (record.email && !validEmail(record.email)) reasons.push("Invalid email format");
    if (record.experience != null && (Number.isNaN(record.experience) || record.experience < 0)) {
      reasons.push("experience must be a positive number");
    }

    if (reasons.length) {
      failedRows.push({ rowNumber, reasons });
      return;
    }

    records.push({ rowNumber, data: record });
  });

  return { records, failedRows, totalRows };
}

function parseExperienceText(value) {
  const text = trimCell(value);
  const match = text.match(/(\d+(?:\.\d+)?)\s*yr(?:\s*(\d+(?:\.\d+)?)\s*m)?/i);
  if (!match) return null;
  const years = Number(match[1]);
  const months = Number(match[2] || 0);
  return Number((years + months / 12).toFixed(1));
}

function parseLocationText(value) {
  let text = trimCell(value);
  text = text.replace(/^\d+(?:\.\d+)?\s*yr(?:\s*\d+(?:\.\d+)?\s*m)?/i, "");
  text = text.replace(/\b\d+(?:\.\d+)?\s*Lac\(s\)/ig, "");
  text = text.replace(/\bPref\b.*$/i, "");
  text = text.replace(/\s+/g, " ").trim();
  return text || "";
}

function normalizeKeywordsText(value) {
  return trimCell(value)
    .replace(/\s*IT Skills Details\s*$/i, "")
    .split(/[,;\n]/)
    .map(part => part.trim())
    .filter(Boolean)
    .join(", ");
}

function employeeImportHeaderMap(headers) {
  const aliases = {
    fullname: "fullName",
    name: "fullName",
    candidatename: "fullName",
    employeename: "fullName",
    email: "email",
    emailid: "email",
    mail: "email",
    phone: "phone",
    phonenumber: "phone",
    mobile: "phone",
    mobilenumber: "phone",
    contact: "phone",
    contactnumber: "phone",
    location: "location",
    currentlocation: "location",
    city: "location",
    keywords: "keywords",
    keyskills: "keywords",
    skills: "keywords",
    skill: "keywords",
    experience: "experience",
    totalexperience: "experience",
    exp: "experience",
    currentcompany: "currentCompany",
    company: "currentCompany",
    currentdesignation: "currentDesignation",
    designation: "currentDesignation",
    employeecode: "employeeCode",
    employeeno: "employeeCode"
  };
  const map = {};
  headers.forEach((header, index) => {
    const key = trimCell(header).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (aliases[key] && map[aliases[key]] == null) map[aliases[key]] = index;
  });
  return map;
}

function buildEmployeeImportRecord(raw, rowNumber) {
  const fullName = trimCell(raw.fullName);
  const email = trimCell(raw.email).toLowerCase();
  const phone = normalizePhone(raw.phone);
  const experience = raw.experience === "" || raw.experience == null
    ? parseExperienceText(raw.location)
    : Number(trimCell(raw.experience));
  const record = {
    fullName,
    email,
    phone,
    location: trimCell(raw.location) || "",
    keywords: normalizeKeywordsText(raw.keywords),
    experience: Number.isNaN(experience) ? null : experience,
    currentCompany: trimCell(raw.currentCompany) || null,
    currentDesignation: trimCell(raw.currentDesignation) || "Employee",
    employeeCode: trimCell(raw.employeeCode) || String(rowNumber).padStart(5, "0")
  };
  const reasons = [];
  if (!record.fullName) reasons.push("name is required");
  if (!record.phone) reasons.push("phone is required");
  if (!record.email) reasons.push("email is required");
  if (record.email && !validEmail(record.email)) reasons.push("Invalid email format");
  if (record.experience != null && (Number.isNaN(record.experience) || record.experience < 0)) {
    reasons.push("experience must be a positive number");
  }
  return { rowNumber, data: record, reasons };
}

function employeeImportIdentityKeys(data) {
  return [
    data.email ? `email:${data.email}` : null,
    data.phone ? `phone:${data.phone}` : null,
    data.employeeCode ? `employeeCode:${data.employeeCode}` : null
  ].filter(Boolean);
}

function employeeImportDuplicateSignature(data) {
  return employeeImportIdentityKeys(data).sort().join("|");
}

function parseEmployeeRows(rows) {
  if (!rows.length) {
    const error = new Error("Uploaded file is empty");
    error.statusCode = 400;
    throw error;
  }

  const firstHeaders = rows[0].map(trimCell);
  const headerMap = employeeImportHeaderMap(firstHeaders);
  const hasHeaders = headerMap.fullName != null && headerMap.phone != null && headerMap.email != null;
  const records = [];
  const failedRows = [];
  const seen = new Set();
  let totalRows = 0;
  let sectionKeywords = "";
  let sectionLocation = "";

  const pushRecord = result => {
    totalRows += 1;
    const duplicateSignature = employeeImportDuplicateSignature(result.data);
    if (!result.reasons.length && duplicateSignature && seen.has(duplicateSignature)) {
      result.reasons.push("duplicate in uploaded file");
    }
    if (result.reasons.length) {
      failedRows.push({
        rowNumber: result.rowNumber,
        name: result.data.fullName,
        email: result.data.email,
        phone: result.data.phone,
        reasons: result.reasons
      });
      return;
    }
    if (duplicateSignature) seen.add(duplicateSignature);
    records.push({ rowNumber: result.rowNumber, data: result.data });
  };

  if (hasHeaders) {
    rows.slice(1).forEach((values, index) => {
      if (values.every(value => trimCell(value) === "")) return;
      const raw = {};
      Object.entries(headerMap).forEach(([key, columnIndex]) => {
        raw[key] = trimCell(values[columnIndex]);
      });
      if (!raw.location) raw.location = parseLocationText(raw.experience);
      pushRecord(buildEmployeeImportRecord(raw, index + 2));
    });
    return { records, failedRows, totalRows };
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const name = trimCell(row[0]);
    const phone = normalizePhone(row[1]);
    const email = trimCell(row[2]).toLowerCase();
    if (!name && !phone && !email) return;

    const hasDataIdentity = name && phone && email;
    if (!hasDataIdentity) {
      const possibleSkills = normalizeKeywordsText(row[0]);
      if ((possibleSkills.includes(",") || /skills|experience/i.test(possibleSkills)) && !validEmail(email)) {
        sectionKeywords = possibleSkills.replace(/^\d+\s*-\s*\d+\s*Years Experience\s*,?\s*/i, "");
      }
      if (trimCell(row[1]) && !trimCell(row[2])) sectionLocation = trimCell(row[1]);
      return;
    }

    const location = parseLocationText(row[3]) || sectionLocation;
    const experience = parseExperienceText(row[3]);
    const keywords = normalizeKeywordsText(row[4]) || sectionKeywords;
    pushRecord(buildEmployeeImportRecord({
      fullName: name,
      phone,
      email,
      location,
      keywords,
      experience,
      currentDesignation: "Employee",
      employeeCode: String(rowNumber).padStart(5, "0")
    }, rowNumber));
  });

  return { records, failedRows, totalRows };
}

function findEmployeeDuplicate(data) {
  const matches = [];
  const byEmail = data.email ? getUserByEmail(data.email) : null;
  const byPhone = data.phone ? getUserByPhone(data.phone) : null;
  if (byEmail) matches.push(byEmail);
  if (byPhone && !matches.some(user => user.id === byPhone.id)) matches.push(byPhone);
  return matches;
}

async function previewEmployeeImport(records) {
  if (await shouldUsePersistentHrEmployees()) {
    return employeeStore.analyzeUploadedEmployees(records);
  }
  let createCount = 0;
  let updateCount = 0;
  const actions = records.map(record => {
    const duplicates = findEmployeeDuplicate(record.data);
    if (duplicates.length) updateCount += 1;
    else createCount += 1;
    return {
      rowNumber: record.rowNumber,
      action: duplicates.length ? "Update" : "Create",
      ...record.data
    };
  });
  return { createCount, updateCount, actions, preview: actions.slice(0, 25) };
}

function duplicateImportRows(rows = []) {
  return rows.filter(row => (row.reasons || []).some(reason => /duplicate/i.test(String(reason || ""))));
}

function invalidImportRows(rows = []) {
  return rows.filter(row => !duplicateImportRows([row]).length);
}

async function importEmployeesPreview(req, res) {
  const context = await requireAuth(req, res, "employees.manage");
  if (!context) return;

  cleanupCandidateImportDrafts();
  const file = await parseMultipartFile(req);
  const rows = parseCandidateWorkbook(file);
  const parsed = parseEmployeeRows(rows);
  const importId = randomToken(18);
  candidateImportDrafts.set(importId, {
    type: "employees",
    userId: context.user.id,
    createdAt: Date.now(),
    records: parsed.records,
    failedRows: parsed.failedRows,
    totalRows: parsed.totalRows,
    source: path.basename(file.filename)
  });

  const duplicateRows = duplicateImportRows(parsed.failedRows);
  const invalidRows = invalidImportRows(parsed.failedRows);
  const analysis = await previewEmployeeImport(parsed.records);

  audit(req, context.user.id, "Employee Import Preview", {
    source: path.basename(file.filename),
    totalRows: parsed.totalRows,
    validRows: parsed.records.length,
    failed: parsed.failedRows.length,
    duplicates: duplicateRows.length,
    invalid: invalidRows.length,
    createCount: analysis.createCount,
    updateCount: analysis.updateCount
  });
  sendJson(res, 200, {
    success: true,
    importId,
    summary: {
      totalRows: parsed.totalRows,
      validRows: parsed.records.length,
      createCount: analysis.createCount,
      updateCount: analysis.updateCount,
      failed: parsed.failedRows.length,
      skipped: parsed.failedRows.length,
      duplicates: duplicateRows.length,
      duplicateCount: duplicateRows.length,
      invalid: invalidRows.length,
      invalidCount: invalidRows.length
    },
    preview: analysis.preview,
    actions: analysis.actions,
    failedRows: parsed.failedRows,
    skippedRows: parsed.failedRows,
    duplicateRows,
    invalidRows
  });
}

async function upsertEmployeeAccountFromImport(record, context) {
  const data = record.data;
  const existingUser = getUserByEmail(data.email);
  const phoneUser = data.phone ? getUserByPhone(data.phone) : null;
  if (phoneUser && (!existingUser || phoneUser.id !== existingUser.id)) {
    return { failed: true, reason: "Phone is already registered to another user" };
  }

  const companyId = companyIdForUser(context.user.id);
  const password = randomToken(24);
  const userId = existingUser
    ? existingUser.id
    : createUser({ name: data.fullName, email: data.email, phone: data.phone, password, roleSlug: "employee", companyId, emailVerified: true });
  if (existingUser) {
    db.prepare(`
      UPDATE users
      SET name = ?, phone = COALESCE(?, phone), phone_verified = CASE WHEN ? IS NULL THEN phone_verified ELSE 1 END, updated_at = ?
      WHERE id = ?
    `).run(data.fullName, data.phone || null, data.phone || null, now(), userId);
    assignRole(userId, "employee", companyId);
  }

  const existingCompanyUser = db.prepare("SELECT id FROM company_users WHERE company_id = ? AND user_id = ? LIMIT 1").get(companyId, userId);
  if (!existingCompanyUser) {
    db.prepare(`
      INSERT INTO company_users (company_id, user_id, role_title, status, invited_by, created_at)
      VALUES (?, ?, 'employee', 'active', ?, ?)
    `).run(companyId, userId, context.user.id, now());
  }

  const existingEmployee = db.prepare("SELECT id, employee_code, cv_file_name, cv_stored_name FROM employee_accounts WHERE user_id = ?").get(userId);
  const employeeCode = (existingEmployee?.employee_code || data.employeeCode || String(record.rowNumber).padStart(5, "0")).replace(/\D/g, "").padStart(5, "0");
  const designation = data.currentDesignation || "Employee";
  const department = data.currentCompany || data.location || "General";
  if (existingEmployee) {
    db.prepare(`
      UPDATE employee_accounts
      SET company_id = ?, employee_code = ?, designation = ?, department = ?, location = ?, keywords = ?,
          experience = ?, current_company = ?, current_designation = ?
      WHERE user_id = ?
    `).run(
      companyId,
      employeeCode,
      designation,
      department,
      data.location,
      data.keywords,
      data.experience,
      data.currentCompany,
      designation,
      userId
    );
    const updated = db.prepare(`
      SELECT u.id, ea.employee_code, u.name, u.email, u.phone, ea.designation, ea.department,
             ea.location, ea.keywords, ea.experience, ea.current_company, ea.current_designation,
             ea.cv_file_name, ea.cv_stored_name
      FROM employee_accounts ea
      JOIN users u ON u.id = ea.user_id
      WHERE u.id = ?
    `).get(userId);
    await writeEmployeeAudit(updated, context, "edited");
    return { updated: true, userId };
  }

  db.prepare(`
    INSERT INTO employee_accounts
      (user_id, company_id, employee_code, designation, department, location, keywords, experience,
       current_company, current_designation, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    companyId,
    employeeCode,
    designation,
    department,
    data.location,
    data.keywords,
    data.experience,
    data.currentCompany,
    designation,
    now()
  );
  const created = db.prepare(`
    SELECT u.id, ea.employee_code, u.name, u.email, u.phone, ea.designation, ea.department,
           ea.location, ea.keywords, ea.experience, ea.current_company, ea.current_designation,
           ea.cv_file_name, ea.cv_stored_name
    FROM employee_accounts ea
    JOIN users u ON u.id = ea.user_id
    WHERE u.id = ?
  `).get(userId);
  await writeEmployeeAudit(created, context, "created");
  return { created: true, userId };
}

async function importEmployeesCommit(req, res) {
  const context = await requireAuth(req, res, "employees.manage");
  if (!context) return;
  const body = await parseJsonBody(req);
  const draft = candidateImportDrafts.get(String(body.importId || ""));
  if (!draft || draft.userId !== context.user.id || draft.type !== "employees") {
    return sendError(res, 404, "Import preview expired. Please upload the file again.");
  }

  if (!draft.records.length) {
    const duplicateRows = duplicateImportRows(draft.failedRows);
    const invalidRows = invalidImportRows(draft.failedRows);
    candidateImportDrafts.delete(String(body.importId || ""));
    return sendJson(res, 200, {
      success: false,
      message: "No valid employee rows to import.",
      totalRows: draft.totalRows,
      created: 0,
      updated: 0,
      duplicates: duplicateRows.length,
      duplicateCount: duplicateRows.length,
      failed: draft.failedRows.length,
      invalid: invalidRows.length,
      invalidCount: invalidRows.length,
      skipped: draft.failedRows.length,
      summary: {
        totalRows: draft.totalRows,
        validRows: 0,
        created: 0,
        updated: 0,
        failed: draft.failedRows.length,
        skipped: draft.failedRows.length,
        duplicates: duplicateRows.length,
        duplicateCount: duplicateRows.length,
        invalid: invalidRows.length,
        invalidCount: invalidRows.length
      },
      failedRows: draft.failedRows,
      skippedRows: draft.failedRows,
      duplicateRows,
      invalidRows
    });
  }

  const summary = {
    totalRows: draft.totalRows,
    validRows: draft.records.length,
    created: 0,
    updated: 0,
    failed: draft.failedRows.length,
    skipped: draft.failedRows.length,
    duplicates: duplicateImportRows(draft.failedRows).length,
    duplicateCount: duplicateImportRows(draft.failedRows).length,
    invalid: invalidImportRows(draft.failedRows).length,
    invalidCount: invalidImportRows(draft.failedRows).length
  };
  const failedRows = [...draft.failedRows];

  if (await shouldUsePersistentHrEmployees()) {
    const result = await employeeStore.saveUploadedEmployeesImport({
      records: draft.records,
      failedRows,
      totalRows: draft.totalRows,
      source: draft.source
    });
    Object.assign(summary, result.summary);
    for (const saved of result.savedRows) {
      await writeEmployeeAudit(saved.employee, context, saved.created ? "created" : "edited").catch(() => {});
    }
    candidateImportDrafts.delete(String(body.importId || ""));
    audit(req, context.user.id, "Employee Import Commit", { ...summary, source: draft.source, importId: result.importId }, "hr_employee_records");
    return sendJson(res, 200, {
      success: true,
      message: "Employees uploaded successfully and saved in database.",
      importId: result.importId,
      totalRows: summary.totalRows,
      created: summary.created,
      updated: summary.updated,
      duplicates: summary.duplicates,
      duplicateCount: summary.duplicateCount || summary.duplicates,
      failed: summary.failed,
      invalid: summary.invalid,
      invalidCount: summary.invalidCount || summary.invalid,
      skipped: summary.skipped,
      summary,
      failedRows: result.failedRows,
      skippedRows: result.failedRows,
      duplicateRows: result.duplicateRows,
      invalidRows: result.invalidRows
    });
  }

  for (let index = 0; index < draft.records.length; index += 500) {
    const batch = draft.records.slice(index, index + 500);
    db.exec("BEGIN");
    try {
      for (const record of batch) {
        try {
          const result = await upsertEmployeeAccountFromImport(record, context);
          if (result.created) summary.created += 1;
          if (result.updated) summary.updated += 1;
          if (result.failed) {
            summary.failed += 1;
            summary.skipped += 1;
            summary.invalid += 1;
            summary.invalidCount += 1;
            failedRows.push({ rowNumber: record.rowNumber, reasons: [result.reason] });
          }
        } catch (error) {
          summary.failed += 1;
          summary.skipped += 1;
          summary.invalid += 1;
          summary.invalidCount += 1;
          failedRows.push({ rowNumber: record.rowNumber, reasons: [error.message] });
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    await new Promise(resolve => setImmediate(resolve));
  }

  candidateImportDrafts.delete(String(body.importId || ""));
  audit(req, context.user.id, "Employee Import Commit", { ...summary, source: draft.source }, "employee_accounts");
  sendJson(res, 200, {
    success: true,
    totalRows: summary.totalRows,
    created: summary.created,
    updated: summary.updated,
    duplicates: summary.duplicates,
    duplicateCount: summary.duplicateCount,
    failed: summary.failed,
    invalid: summary.invalid,
    invalidCount: summary.invalidCount,
    skipped: summary.skipped,
    summary,
    failedRows,
    skippedRows: failedRows,
    duplicateRows: duplicateImportRows(failedRows),
    invalidRows: invalidImportRows(failedRows)
  });
}

function findCandidateDuplicate(data) {
  const rows = data.email
    ? db.prepare("SELECT id FROM candidate_records WHERE phone = ? OR lower(email) = lower(?) LIMIT 2").all(data.phone, data.email)
    : db.prepare("SELECT id FROM candidate_records WHERE phone = ? LIMIT 1").all(data.phone);
  return rows;
}

function previewCandidateImport(records) {
  return records.slice(0, 25).map(record => {
    const duplicates = findCandidateDuplicate(record.data);
    return {
      rowNumber: record.rowNumber,
      action: duplicates.length ? "Update" : "Create",
      ...record.data
    };
  });
}

async function importCandidatesPreview(req, res) {
  const context = await requireAuth(req, res, "employees.manage");
  if (!context) return;

  cleanupCandidateImportDrafts();
  const file = await parseMultipartFile(req);
  const rows = parseCandidateWorkbook(file);
  const parsed = parseCandidateRows(rows);
  const importId = randomToken(18);
  candidateImportDrafts.set(importId, {
    type: "candidates",
    userId: context.user.id,
    createdAt: Date.now(),
    records: parsed.records,
    failedRows: parsed.failedRows,
    totalRows: parsed.totalRows
  });

  audit(req, context.user.id, "Candidate Import Preview", { totalRows: parsed.totalRows, validRows: parsed.records.length, failed: parsed.failedRows.length });
  sendJson(res, 200, {
    success: true,
    importId,
    summary: {
      totalRows: parsed.totalRows,
      validRows: parsed.records.length,
      failed: parsed.failedRows.length
    },
    preview: previewCandidateImport(parsed.records),
    failedRows: parsed.failedRows
  });
}

function upsertCandidateRecord(record) {
  const matches = findCandidateDuplicate(record.data);
  if (matches.length > 1) {
    return { failed: true, reason: "Phone and email match different candidates" };
  }

  const data = record.data;
  if (matches.length === 1) {
    db.prepare(`
      UPDATE candidate_records
      SET full_name = ?, email = ?, phone = ?, location = ?, keywords = ?, experience = ?,
          current_company = ?, current_designation = ?, updated_at = ?
      WHERE id = ?
    `).run(
      data.fullName,
      data.email,
      data.phone,
      data.location,
      data.keywords,
      data.experience,
      data.currentCompany,
      data.currentDesignation,
      now(),
      matches[0].id
    );
    if (data.cvFileName || data.cvStoredName) {
      db.prepare(`
        UPDATE candidate_records
        SET cv_file_name = ?, cv_stored_name = ?, updated_at = ?
        WHERE id = ?
      `).run(data.cvFileName || null, data.cvStoredName || null, now(), matches[0].id);
    }
    return { updated: true, duplicate: true };
  }

  db.prepare(`
    INSERT INTO candidate_records
      (full_name, email, phone, location, keywords, experience, current_company, current_designation, cv_file_name, cv_stored_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.fullName,
    data.email,
    data.phone,
    data.location,
    data.keywords,
    data.experience,
    data.currentCompany,
    data.currentDesignation,
    data.cvFileName || null,
    data.cvStoredName || null,
    now(),
    now()
  );
  return { created: true };
}

async function importCandidatesCommit(req, res) {
  const context = await requireAuth(req, res, "employees.manage");
  if (!context) return;
  const body = await parseJsonBody(req);
  const draft = candidateImportDrafts.get(String(body.importId || ""));
  if (!draft || draft.userId !== context.user.id || draft.type !== "candidates") {
    return sendError(res, 404, "Import preview expired. Please upload the file again.");
  }

  const summary = {
    totalRows: draft.totalRows,
    created: 0,
    updated: 0,
    duplicates: 0,
    failed: draft.failedRows.length
  };
  const failedRows = [...draft.failedRows];

  for (let index = 0; index < draft.records.length; index += 500) {
    const batch = draft.records.slice(index, index + 500);
    db.exec("BEGIN");
    try {
      for (const record of batch) {
        try {
          const result = upsertCandidateRecord(record);
          if (result.created) summary.created += 1;
          if (result.updated) summary.updated += 1;
          if (result.duplicate) summary.duplicates += 1;
          if (result.failed) {
            summary.failed += 1;
            failedRows.push({ rowNumber: record.rowNumber, reasons: [result.reason] });
          }
        } catch (error) {
          summary.failed += 1;
          failedRows.push({ rowNumber: record.rowNumber, reasons: [error.message] });
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    await new Promise(resolve => setImmediate(resolve));
  }

  candidateImportDrafts.delete(String(body.importId || ""));
  audit(req, context.user.id, "Candidate Import Commit", summary, "candidate_records");
  sendJson(res, 200, {
    success: true,
    summary,
    failedRows
  });
}

async function createCandidateRecord(req, res) {
  const context = await requireAuth(req, res, "employees.manage");
  if (!context) return;

  const form = await parseMultipartForm(req);
  const cv = saveCandidateCv(form.files.cv);
  const data = {
    ...normalizeCandidateRecord(form.fields),
    ...cv
  };
  const result = upsertCandidateRecord({ rowNumber: 1, data });
  if (result.failed) return sendError(res, 409, result.reason);

  audit(req, context.user.id, "Candidate Manual Add", {
    action: result.created ? "created" : "updated",
    phone: data.phone,
    email: data.email,
    cvFileName: data.cvFileName || null
  }, "candidate_records");
  sendJson(res, result.created ? 201 : 200, {
    success: true,
    message: result.created ? "Candidate added successfully" : "Candidate updated successfully",
    action: result.created ? "created" : "updated"
  });
}

async function candidateApplications(req, res) {
  const context = await requireAuth(req, res, "applications.track");
  if (!context) return;
  sendJson(res, 200, {
    items: [
      { job: "Senior Product Engineer", company: "Acme Talent Labs", stage: "Interview", updatedAt: now() },
      { job: "Frontend Lead", company: "Talme Technologies", stage: "Applied", updatedAt: now() }
    ]
  });
}

async function roleAssign(req, res) {
  const context = await requireAuth(req, res, "admin.roles.manage");
  if (!context) return;
  const body = await parseJsonBody(req);
  assignRole(Number(body.userId), String(body.roleSlug), body.companyId ? Number(body.companyId) : null);
  audit(req, context.user.id, "Permission Changes", { targetUserId: body.userId, roleSlug: body.roleSlug }, "user", body.userId);
  sendJson(res, 200, { message: "Role assigned" });
}

async function dashboardAccess(req, res, pathname) {
  const permission = DASHBOARD_PERMISSIONS[pathname];
  if ((req.headers.accept || "").includes("text/html")) {
    return serveStatic(req, res, "/index.html");
  }
  const context = await requireAuth(req, res, permission);
  if (!context) return;
  sendJson(res, 200, {
    page: pathname,
    permission,
    user: context.safeUser,
    modules: context.safeUser.permissions.filter(item => item !== "*").sort()
  });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? path.join(publicDir, "index.html") : path.join(publicDir, pathname);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(publicDir)) return sendError(res, 403, "Forbidden");
  if (!fs.existsSync(normalized) || fs.statSync(normalized).isDirectory()) {
    filePath = path.join(publicDir, "index.html");
  }
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg"
  };
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

const routes = {
  "GET /api/health": healthCheck,
  "POST /api/auth/login": login,
  "POST /api/auth/register": register,
  "POST /api/auth/forgot-password": forgotPassword,
  "POST /api/auth/forgot-password/verify": verifyForgotPasswordOtp,
  "POST /api/auth/reset-password": resetPassword,
  "POST /api/auth/refresh": refresh,
  "POST /api/auth/logout": logout,
  "POST /api/auth/tab-close": tabCloseLogout,
  "POST /api/auth/logout-all": logoutAll,
  "GET /api/public/profile-count": publicProfileCount,
  "GET /api/me": me,
  "GET /api/auth/login-activity": loginActivity,
  "GET /api/auth/devices": deviceHistory,
  "GET /api/audit-logs": auditLogs,
  "GET /api/admin/users": adminUsers,
  "GET /api/admin/registered-devices": adminRegisteredDevices,
  "GET /api/admin/security/live": adminSecurityLive,
  "POST /api/candidates": createCandidateRecord,
  "POST /api/import/candidates/preview": importCandidatesPreview,
  "POST /api/import/candidates/commit": importCandidatesCommit,
  "POST /api/import/employees/preview": importEmployeesPreview,
  "POST /api/import/employees/commit": importEmployeesCommit,
  "POST /api/admin/roles/assign": roleAssign,
  "GET /api/platform/companies": platformCompanies,
  "GET /api/hr/employees": hrEmployees,
  "GET /api/hr/imported-employees": importedHrEmployees,
  "POST /api/hr/employees": createEmployee,
  "GET /api/candidate/applications": candidateApplications
};

async function requestHandler(req, res) {
  applySecurityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const routeKey = `${req.method} ${url.pathname}`;
  if (!enforceRateLimit(req, res)) return;
  try {
    if (routes[routeKey]) return await routes[routeKey](req, res);
    if (req.method === "GET" && url.pathname.startsWith("/api/hr/employees/") && url.pathname.endsWith("/cv-preview")) {
      const employeeId = url.pathname.slice("/api/hr/employees/".length, -"/cv-preview".length);
      return await hrEmployeeCvPreview(req, res, employeeId);
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/hr/employees/") && url.pathname.endsWith("/cv")) {
      const employeeId = url.pathname.slice("/api/hr/employees/".length, -"/cv".length);
      return await hrEmployeeCv(req, res, employeeId);
    }
    if ((req.method === "PUT" || req.method === "PATCH") && url.pathname.startsWith("/api/hr/employees/")) {
      return await updateHrEmployee(req, res, url.pathname.slice("/api/hr/employees/".length));
    }
    if (req.method === "GET" && DASHBOARD_PERMISSIONS[url.pathname]) return await dashboardAccess(req, res, url.pathname);
    if (url.pathname.startsWith("/api/")) return sendError(res, 404, "API route not found");
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    if (isDatabaseQuotaError(error)) {
      return sendError(res, 503, "Database access is temporarily unavailable: Neon data transfer quota exceeded.");
    }
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500 && !error.expose) console.error(error);
    sendError(res, statusCode, statusCode === 500 && !error.expose ? "Internal server error" : error.message);
  }
}

const server = http.createServer(requestHandler);

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the existing server or run with another port, for example: $env:PORT=4001; npm run dev`);
    process.exit(1);
  }
  throw error;
});

if (require.main === module) {
  server.listen(port, () => {
    console.log(`Talme auth system running at http://localhost:${port}`);
  });
}

module.exports = server;
module.exports.requestHandler = requestHandler;
module.exports.server = server;
