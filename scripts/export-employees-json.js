const fs = require("node:fs");
const path = require("node:path");
const xlsx = require("xlsx");

const workbookPath = process.argv[2];
const outputPath = process.argv[3] || path.join(__dirname, "..", "data", "imported-employees.json");

if (!workbookPath) {
  console.error("Usage: node scripts/export-employees-json.js <file.xlsx> [output.json]");
  process.exit(1);
}

function cell(value) {
  return value == null ? "" : String(value).trim();
}

function normalizePhone(value) {
  let phone = cell(value).replace(/[^\d+]/g, "");
  if (phone.startsWith("+91")) phone = phone.slice(3);
  if (phone.startsWith("91") && phone.length === 12) phone = phone.slice(2);
  return phone.replace(/[^\d]/g, "");
}

function parseExperience(value) {
  const text = cell(value);
  const match = text.match(/(\d+(?:\.\d+)?)\s*yr(?:\s*(\d+(?:\.\d+)?)\s*m)?/i);
  if (!match) return null;
  const years = Number(match[1]);
  const months = Number(match[2] || 0);
  return Number((years + months / 12).toFixed(1));
}

function parseLocation(value) {
  let text = cell(value);
  text = text.replace(/^\d+(?:\.\d+)?\s*yr(?:\s*\d+(?:\.\d+)?\s*m)?/i, "");
  text = text.replace(/\b\d+(?:\.\d+)?\s*Lac\(s\)/ig, "");
  text = text.replace(/\bPref\b.*$/i, "");
  text = text.replace(/\s+/g, " ").trim();
  return text || "";
}

function normalizeKeywords(value) {
  return cell(value)
    .replace(/\s*IT Skills Details\s*$/i, "")
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .join(",");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const workbook = xlsx.readFile(path.resolve(workbookPath));
const sheet = workbook.Sheets[workbook.SheetNames[0]];
if (!sheet) throw new Error("Workbook does not contain a sheet");

const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
const seen = new Set();
const skipped = [];
const items = [];

rows.slice(2).forEach((row, index) => {
  const rowNumber = index + 3;
  const name = cell(row[0]);
  const phone = normalizePhone(row[1]);
  const email = cell(row[2]).toLowerCase();
  const location = parseLocation(row[3]);
  const experience = parseExperience(row[3]);
  const keywords = normalizeKeywords(row[4]);
  const key = `${email}|${phone}`;

  const reasons = [];
  if (!name) reasons.push("missing name");
  if (!phone) reasons.push("missing phone");
  if (!email) reasons.push("missing email");
  if (email && !isValidEmail(email)) reasons.push("invalid email");
  if (!keywords) reasons.push("missing keywords");
  if (seen.has(key)) reasons.push("duplicate in sheet");

  if (reasons.length) {
    skipped.push({ rowNumber, name, email, phone, reasons });
    return;
  }

  seen.add(key);
  items.push({
    id: `xlsx-${rowNumber}`,
    employee_code: `XLSX-${String(rowNumber).padStart(5, "0")}`,
    name,
    email,
    phone,
    designation: "Employee",
    department: location || "General",
    location,
    keywords,
    experience,
    current_company: null,
    current_designation: "Employee",
    source: "1.xlsx",
    rowNumber
  });
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({
  source: path.basename(workbookPath),
  generatedAt: new Date().toISOString(),
  totalRows: Math.max(rows.length - 2, 0),
  importedRows: items.length,
  skippedRows: skipped.length,
  skippedPreview: skipped.slice(0, 25),
  items
}, null, 2)}\n`);

console.log(JSON.stringify({
  outputPath: path.resolve(outputPath),
  totalRows: Math.max(rows.length - 2, 0),
  importedRows: items.length,
  skippedRows: skipped.length,
  skippedPreview: skipped.slice(0, 10)
}, null, 2));
