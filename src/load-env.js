const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.join(__dirname, "..");
const backendFallbackKeys = new Set([
  "DATABASE_URL",
  "JWT_SECRET",
  "EMPLOYEE_INVITE_CODE",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "EMAIL_FROM",
  "AUTH_EMAIL_FROM",
  "APP_URL"
]);
let loaded = false;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    let value = match[2] || "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function applyEnv(values, allowedKeys = null) {
  for (const [key, value] of Object.entries(values)) {
    if (allowedKeys && !allowedKeys.has(key)) continue;
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function loadLocalEnv() {
  if (loaded) return;
  loaded = true;
  applyEnv(parseEnvFile(path.join(rootDir, ".env")));
  applyEnv(parseEnvFile(path.join(rootDir, "backend", ".env")), backendFallbackKeys);
}

module.exports = { loadLocalEnv };
