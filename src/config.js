const path = require("node:path");
const os = require("node:os");

const rootDir = path.join(__dirname, "..");
const defaultDbPath = process.env.VERCEL
  ? path.join(os.tmpdir(), "talme.sqlite")
  : path.join(rootDir, "data", "talme.sqlite");
const defaultCvUploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), "candidate-cvs")
  : path.join(rootDir, "data", "candidate-cvs");

module.exports = {
  appName: "Talme",
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-this-secret-before-production",
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
  rememberMeTtlSeconds: 30 * 24 * 60 * 60,
  sessionTimeoutSeconds: 30 * 60,
  dbPath: process.env.DB_PATH || defaultDbPath,
  cvUploadDir: process.env.CV_UPLOAD_DIR || defaultCvUploadDir,
  publicDir: path.join(rootDir, "public"),
  employeeInviteCode: process.env.EMPLOYEE_INVITE_CODE || "TALME-EMPLOYEE-2026"
};
