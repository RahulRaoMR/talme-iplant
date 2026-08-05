const path = require("node:path");

const rootDir = path.join(__dirname, "..");

module.exports = {
  appName: "Talme",
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-this-secret-before-production",
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
  rememberMeTtlSeconds: 30 * 24 * 60 * 60,
  sessionTimeoutSeconds: 30 * 60,
  dbPath: process.env.DB_PATH || path.join(rootDir, "data", "talme.sqlite"),
  publicDir: path.join(rootDir, "public"),
  employeeInviteCode: process.env.EMPLOYEE_INVITE_CODE || "TALME-EMPLOYEE-2026"
};
