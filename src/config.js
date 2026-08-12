const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { loadLocalEnv } = require("./load-env");

loadLocalEnv();
const rootDir = path.join(__dirname, "..");
const isProductionRuntime = Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET || (isProductionRuntime ? "" : crypto.randomBytes(32).toString("hex"));
if (!jwtSecret) {
  throw new Error("JWT_SECRET is required for production authentication.");
}
const defaultDbPath = process.env.VERCEL
  ? path.join(os.tmpdir(), "talme.sqlite")
  : path.join(rootDir, "data", "talme.sqlite");
const defaultCvUploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), "candidate-cvs")
  : path.join(rootDir, "data", "candidate-cvs");

module.exports = {
  appName: "Talme",
  port: Number(process.env.PORT || 4000),
  jwtSecret,
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
  rememberMeTtlSeconds: 30 * 24 * 60 * 60,
  sessionTimeoutSeconds: 30 * 60,
  dbPath: process.env.DB_PATH || defaultDbPath,
  cvUploadDir: process.env.CV_UPLOAD_DIR || defaultCvUploadDir,
  publicDir: path.join(rootDir, "public"),
  employeeInviteCode: process.env.EMPLOYEE_INVITE_CODE || ""
};
