const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const dotenv = require("dotenv");
const XLSX = require("xlsx");
const { Prisma, PrismaClient } = require("@prisma/client");

const backendEnvPath = path.resolve(__dirname, "../.env");
const rootEnvPath = path.resolve(__dirname, "../../.env");
dotenv.config({ path: fs.existsSync(backendEnvPath) ? backendEnvPath : rootEnvPath });

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{8,}\d)/g;
const EXPERIENCE_PATTERN = /(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?|yr|y)\b/i;
const MONTHS_PATTERN = /(\d{1,2})\s*(?:months?|mos?|m)\b/i;
const DEFAULT_BATCH_SIZE = 250;

const HEADERS = {
  name: ["name", "candidate name", "full name", "candidate", "employee name"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact", "contact number", "phone no", "mobile no"],
  email: ["email", "email id", "email-id", "mail", "mail id", "mail-id", "gmail", "e-mail"],
  experience: ["experience", "years of experience", "years of exp", "year of exp", "exp", "total experience"],
  location: ["location", "current location", "preferred location", "city"],
  skills: ["skills", "skill", "key skills", "keywords", "technology", "technologies", "technical skills"]
};

const NON_NAMES = [
  "candidate", "company", "contact", "designation", "email", "experience", "gmail", "interview",
  "job description", "job requirement", "location", "mail", "mobile", "name", "notice period",
  "phone", "qualification", "requirement", "role", "salary", "skill", "technology", "years of exp"
];

const CITIES = [
  "Ahmedabad", "Bangalore", "Bengaluru", "Chandigarh", "Chennai", "Coimbatore", "Delhi", "Gurgaon",
  "Gurugram", "Hyderabad", "Kochi", "Kolkata", "Mumbai", "Mysore", "Noida", "Pune", "Thane",
  "Trivandrum", "Vadodara", "Visakhapatnam"
];

function parseArgs(argv) {
  const options = { batchSize: DEFAULT_BATCH_SIZE, commit: false, offline: false, preview: 10 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--file" || value === "-f") options.file = argv[++index];
    else if (value === "--batch-size") options.batchSize = Number(argv[++index]);
    else if (value === "--preview") options.preview = Number(argv[++index]);
    else if (value === "--commit") options.commit = true;
    else if (value === "--dry-run") options.commit = false;
    else if (value === "--offline") options.offline = true;
    else if (value === "--help" || value === "-h") options.help = true;
    else if (!value.startsWith("-") && !options.file) options.file = value;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1000) {
    throw new Error("--batch-size must be an integer from 1 to 1000");
  }
  if (!Number.isInteger(options.preview) || options.preview < 0 || options.preview > 100) {
    throw new Error("--preview must be an integer from 0 to 100");
  }
  if (options.offline && options.commit) throw new Error("--offline cannot be combined with --commit");
  return options;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/import-master-workbook.js --file <workbook.xlsx> --dry-run
  node scripts/import-master-workbook.js --file <workbook.xlsx> --commit

Options:
  -f, --file <path>       Workbook path (required)
      --dry-run           Compare with PostgreSQL without writing (default)
      --offline           Parse without connecting to PostgreSQL
      --commit            Insert/update PostgreSQL records
      --batch-size <n>    Batch size, 1-1000 (default: 250)
      --preview <n>       Masked candidates to preview (default: 10)
  -h, --help              Show help
`);
}

function stringValue(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return Number.isInteger(value) ? value.toFixed(0) : String(value);
  return String(value).replace(/\u0000/g, "").trim();
}

function normalizedHeader(value) {
  return stringValue(value).toLowerCase().replace(/[_./\\]+/g, " ")
    .replace(/[^a-z0-9 -]+/g, "").replace(/\s+/g, " ").trim();
}

function detectHeaderMap(cells) {
  const map = {};
  cells.forEach((cell, index) => {
    const header = normalizedHeader(cell);
    for (const [field, aliases] of Object.entries(HEADERS)) {
      if (aliases.includes(header) && map[field] === undefined) map[field] = index;
    }
  });
  const fields = Object.keys(map);
  return fields.length >= 2 && fields.some((field) => ["name", "phone", "email"].includes(field)) ? map : null;
}

function emailsFrom(value) {
  const matches = stringValue(value).match(EMAIL_PATTERN) || [];
  return [...new Set(matches.map((email) => email.toLowerCase().replace(/[),.;:]+$/g, "")))];
}

function normalizePhone(digits) {
  let phone = digits.replace(/\D/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.length === 11 && phone.startsWith("0")) phone = phone.slice(1);
  if (phone.length === 10 && /^[6-9]/.test(phone)) return `+91${phone}`;
  if (phone.length === 12 && phone.startsWith("91") && /^[6-9]/.test(phone.slice(2))) return `+${phone}`;
  if (phone.length >= 11 && phone.length <= 15 && !phone.startsWith("0")) return `+${phone}`;
  return null;
}

function phonesFrom(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const phone = normalizePhone(Math.trunc(value).toFixed(0));
    return phone ? [phone] : [];
  }
  const raw = stringValue(value);
  if (/^\d(?:\.\d+)?e\+\d+$/i.test(raw)) {
    const numeric = Number(raw);
    if (Number.isSafeInteger(numeric)) {
      const phone = normalizePhone(numeric.toFixed(0));
      return phone ? [phone] : [];
    }
  }
  return [...new Set((raw.match(PHONE_PATTERN) || []).map(normalizePhone).filter(Boolean))];
}

function cleanName(value) {
  return stringValue(value).replace(/^(?:mr|mrs|ms|miss|dr)\.?\s+/i, "").replace(/\s+/g, " ").trim();
}

function plausibleName(value) {
  const name = cleanName(value);
  if (name.length < 2 || name.length > 80 || /[@,;|]/.test(name)) return false;
  if (!/[A-Za-z]/.test(name) || /\d{3,}/.test(name) || name.split(/\s+/).length > 7) return false;
  const lower = name.toLowerCase();
  if (NON_NAMES.some((term) => lower === term || lower.startsWith(`${term}:`) || lower.startsWith(`${term}-`))) return false;
  return !(/\b(?:years?|yrs?|lacs?|salary|opening|hiring)\b/i.test(name) && name.split(/\s+/).length > 3);
}

function nameFromEmail(email) {
  const local = email.split("@")[0].replace(/\d+/g, " ").replace(/[._-]+/g, " ").trim();
  if (!local) return "Unknown Candidate";
  return local.split(/\s+/).slice(0, 6)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(" ");
}

function experienceFrom(value, allowNumber = false) {
  const raw = stringValue(value);
  if (!raw) return null;
  if (/\bfresher\b/i.test(raw)) return 0;
  const years = raw.match(EXPERIENCE_PATTERN);
  const months = raw.match(MONTHS_PATTERN);
  if (years) return Number((Number(years[1]) + (months ? Math.min(Number(months[1]), 11) / 12 : 0)).toFixed(2));
  if (allowNumber && /^\d{1,2}(?:\.\d{1,2})?$/.test(raw)) {
    const number = Number(raw);
    return number >= 0 && number <= 60 ? number : null;
  }
  return null;
}

function cleanLocation(value) {
  const location = stringValue(value)
    .replace(EMAIL_PATTERN, " ").replace(PHONE_PATTERN, " ")
    .replace(/\b\d{1,2}(?:\.\d+)?\s*\+?\s*(?:years?|yrs?|yr|y)\b/gi, " ")
    .replace(/\b\d{1,2}\s*(?:months?|mos?|m)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:lacs?|lakhs?)(?:\(s\))?\b/gi, " ")
    .replace(/\(s\)/gi, " ")
    .replace(/\b(?:pref(?:erred)?|preferred location)\b.*$/i, " ")
    .replace(/\s+/g, " ").replace(/^[\s,;:/-]+|[\s,;:/-]+$/g, "").trim();
  if (!location || location.length > 100 || /\b(?:skills?|salary|notice|qualification)\b/i.test(location)) return null;
  return location;
}

function locationFrom(cells, headers) {
  if (headers?.location !== undefined) {
    const value = cleanLocation(cells[headers.location]);
    if (value) return value;
  }
  for (const cell of cells) {
    const raw = stringValue(cell);
    if (EXPERIENCE_PATTERN.test(raw) || /\b(?:lacs?|lakhs?)\b/i.test(raw)) {
      const value = cleanLocation(raw);
      if (value) return value;
    }
  }
  const allText = cells.map(stringValue).join(" | ");
  const cities = CITIES.filter((city) => new RegExp(`\\b${city}\\b`, "i").test(allText));
  return cities.length ? [...new Set(cities)].slice(0, 3).join(", ") : null;
}

function cleanSkill(value) {
  return stringValue(value).replace(/\bIT Skills Details\b/gi, "").replace(/\s+/g, " ")
    .replace(/^[\s,;|:-]+|[\s,;|:-]+$/g, "").trim();
}

function normalizedSkill(value) {
  return cleanSkill(value).toLowerCase().replace(/\s+/g, " ");
}

function splitSkills(value) {
  const raw = cleanSkill(value);
  const seen = new Set();
  const skills = [];
  if (!raw) return skills;
  for (const part of raw.split(/[,;|\n\r]+/)) {
    const skill = cleanSkill(part);
    const normalized = normalizedSkill(skill);
    if (!normalized || seen.has(normalized) || skill.length < 2 || skill.length > 80) continue;
    if (emailsFrom(skill).length || phonesFrom(skill).length || !/[A-Za-z+#.]/.test(skill)) continue;
    if (/^(?:n\/a|na|none|null|nil|skills?|key skills)$/i.test(skill)) continue;
    seen.add(normalized);
    skills.push(skill);
    if (skills.length === 100) break;
  }
  return skills;
}

function skillsFrom(cells, headers) {
  if (headers?.skills !== undefined) {
    const skills = splitSkills(cells[headers.skills]);
    if (skills.length) return skills;
  }
  let best = { score: 0, value: "" };
  cells.forEach((cell) => {
    const value = stringValue(cell);
    if (EXPERIENCE_PATTERN.test(value) || /\b(?:lacs?|lakhs?|pref(?:erred)?)\b/i.test(value)) return;
    const separators = (value.match(/[,;|]/g) || []).length;
    const score = separators * 10 + Math.min(value.length, 300) + (/IT Skills Details/i.test(value) ? 100 : 0);
    if (separators >= 2 && !emailsFrom(value).length && score > best.score) best = { score, value };
  });
  return splitSkills(best.value);
}

function candidateName(cells, headers, contactColumns) {
  if (headers?.name !== undefined && plausibleName(cells[headers.name])) return cleanName(cells[headers.name]);
  const firstContact = contactColumns.length ? Math.min(...contactColumns) : cells.length;
  const order = [...cells.keys()].sort((left, right) => (left < firstContact ? -1 : 1) - (right < firstContact ? -1 : 1));
  for (const index of order) {
    const value = cleanName(cells[index]);
    if (!emailsFrom(value).length && !phonesFrom(value).length && plausibleName(value)) return value;
  }
  return null;
}

function extractCandidate(cells, sheet, rowNumber, headers) {
  const emails = [];
  const phones = [];
  cells.forEach((cell, column) => {
    emailsFrom(cell).forEach((value) => emails.push({ column, value }));
    phonesFrom(cell).forEach((value) => phones.push({ column, value }));
  });
  const email = (headers?.email !== undefined ? emailsFrom(cells[headers.email])[0] : null) || emails[0]?.value || null;
  const phone = (headers?.phone !== undefined ? phonesFrom(cells[headers.phone])[0] : null) || phones[0]?.value || null;
  if (!email && !phone) return null;

  let name = candidateName(cells, headers, [...emails, ...phones].map((item) => item.column));
  let derivedName = false;
  if (!name && email) {
    name = nameFromEmail(email);
    derivedName = true;
  }
  if (!name) return null;

  let experience = headers?.experience !== undefined ? experienceFrom(cells[headers.experience], true) : null;
  if (experience === null) {
    for (const cell of cells) {
      experience = experienceFrom(cell);
      if (experience !== null) break;
    }
  }
  const rawData = {};
  cells.forEach((cell, index) => {
    const value = stringValue(cell);
    if (value) rawData[XLSX.utils.encode_col(index)] = value;
  });
  return {
    derivedName,
    email,
    experience,
    location: locationFrom(cells, headers),
    name,
    phone,
    skills: skillsFrom(cells, headers),
    sources: [{
      raw_data: rawData,
      raw_text: Object.values(rawData).join(" | "),
      recruiter: sheet.trim(),
      row_number: rowNumber,
      source_sheet: sheet.trim()
    }]
  };
}

function mergeCandidate(target, source) {
  if (target.derivedName && !source.derivedName) {
    target.name = source.name;
    target.derivedName = false;
  }
  target.email ||= source.email;
  target.phone ||= source.phone;
  target.location ||= source.location;
  if (target.experience === null && source.experience !== null) target.experience = source.experience;
  const skills = new Map(target.skills.map((skill) => [normalizedSkill(skill), skill]));
  source.skills.forEach((skill) => skills.set(normalizedSkill(skill), skills.get(normalizedSkill(skill)) || skill));
  target.skills = [...skills.values()];
  target.sources.push(...source.sources);
}

function deduplicate(candidates) {
  const unique = [];
  const emails = new Map();
  const phones = new Map();
  let duplicates = 0;
  for (const candidate of candidates) {
    const emailMatch = candidate.email ? emails.get(candidate.email) : null;
    const phoneMatch = candidate.phone ? phones.get(candidate.phone) : null;
    let target = emailMatch || phoneMatch;
    if (emailMatch && phoneMatch && emailMatch !== phoneMatch) {
      target = emailMatch;
      mergeCandidate(target, phoneMatch);
      phoneMatch.merged = true;
      if (phoneMatch.email) emails.set(phoneMatch.email, target);
      if (phoneMatch.phone) phones.set(phoneMatch.phone, target);
    }
    if (target) {
      mergeCandidate(target, candidate);
      duplicates += 1;
    } else {
      target = candidate;
      unique.push(target);
    }
    if (candidate.email) emails.set(candidate.email, target);
    if (candidate.phone) phones.set(candidate.phone, target);
  }
  return { duplicates, unique: unique.filter((candidate) => !candidate.merged) };
}

function parseWorkbook(file) {
  const workbook = XLSX.readFile(file, { cellDates: true });
  const candidates = [];
  const stats = { candidatesDetected: 0, emptyRows: 0, errors: [], nonCandidates: 0, sheets: workbook.SheetNames.length, totalRows: 0 };
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
    if (!range) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { blankrows: true, defval: null, header: 1, raw: true });
    let headers = null;
    rows.forEach((cells, index) => {
      const rowNumber = range.s.r + index + 1;
      stats.totalRows += 1;
      if (!cells.some((cell) => stringValue(cell))) {
        stats.emptyRows += 1;
        return;
      }
      const detectedHeaders = detectHeaderMap(cells);
      if (detectedHeaders) {
        headers = detectedHeaders;
        stats.nonCandidates += 1;
        return;
      }
      try {
        const candidate = extractCandidate(cells, sheetName, rowNumber, headers);
        if (!candidate) stats.nonCandidates += 1;
        else {
          candidates.push(candidate);
          stats.candidatesDetected += 1;
        }
      } catch (error) {
        stats.errors.push({ message: error.message, row: rowNumber, sheet: sheetName.trim() });
      }
    });
  }
  const result = deduplicate(candidates);
  return {
    candidates: result.unique,
    stats: {
      ...stats,
      duplicates: stats.candidatesDetected - result.unique.length,
      skippedInvalid: stats.nonCandidates + stats.errors.length,
      uniqueCandidates: result.unique.length
    }
  };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function recordKey(candidate) {
  const identity = candidate.email ? `email:${candidate.email}` : `phone:${candidate.phone}`;
  return `excel-master:${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function payload(candidate, file) {
  return {
    master_workbook_import: {
      raw_data: candidate.sources.map((source) => source.raw_data),
      raw_text: candidate.sources.map((source) => source.raw_text),
      recruiter: [...new Set(candidate.sources.map((source) => source.recruiter))],
      source_file: file,
      source_sheet: [...new Set(candidate.sources.map((source) => source.source_sheet))],
      sources: candidate.sources
    }
  };
}

function combinedKeywords(existing, skills) {
  const result = new Map();
  [...splitSkills(existing || ""), ...skills].forEach((skill) => result.set(normalizedSkill(skill), skill));
  return [...result.values()].join(", ") || null;
}

async function existingRecords(prisma, candidates, batchSize) {
  const records = [];
  for (const batch of chunks(candidates, batchSize)) {
    const emailValues = [...new Set(batch.map((item) => item.email).filter(Boolean))];
    const phoneValues = [...new Set(batch.map((item) => item.phone).filter(Boolean))];
    const filters = [];
    if (emailValues.length) filters.push({ email: { in: emailValues, mode: "insensitive" } });
    if (phoneValues.length) filters.push({ phone: { in: phoneValues } });
    if (!filters.length) continue;
    records.push(...await prisma.hrEmployeeRecord.findMany({
      where: { OR: filters },
      select: { email: true, id: true, keywords: true, phone: true, recordKey: true }
    }));
  }
  return records;
}

async function planImport(prisma, candidates, batchSize) {
  const records = await existingRecords(prisma, candidates, batchSize);
  const emails = new Map();
  const phones = new Map();
  records.forEach((record) => {
    if (record.email) {
      const email = record.email.toLowerCase();
      emails.set(email, [...(emails.get(email) || []), record]);
    }
    if (record.phone) phones.set(record.phone, [...(phones.get(record.phone) || []), record]);
  });
  const plan = { errors: [], inserts: [], updates: [] };
  candidates.forEach((candidate) => {
    const emailMatches = candidate.email ? emails.get(candidate.email) || [] : [];
    const phoneMatches = candidate.phone ? phones.get(candidate.phone) || [] : [];
    const emailMatch = emailMatches[0];
    const phoneMatch = phoneMatches[0];
    if (emailMatches.length > 1 || phoneMatches.length > 1 || (emailMatch && phoneMatch && emailMatch.id !== phoneMatch.id)) {
      plan.errors.push({ candidate, reason: "Email and/or phone matches multiple existing employee records" });
      return;
    }
    const existing = emailMatch || phoneMatch;
    candidate.keywords = combinedKeywords(existing?.keywords, candidate.skills);
    if (existing) {
      candidate.existing = existing;
      plan.updates.push(candidate);
    } else {
      candidate.recordKey = recordKey(candidate);
      plan.inserts.push(candidate);
    }
  });
  return plan;
}

function createData(candidate, importId, file) {
  const source = candidate.sources[0];
  return {
    email: candidate.email,
    experience: candidate.experience,
    importId,
    keywords: candidate.keywords,
    location: candidate.location,
    name: candidate.name,
    phone: candidate.phone,
    recordKey: candidate.recordKey,
    rowNumber: source.row_number,
    sourceFile: file,
    sourceId: `sheet:${source.source_sheet}`,
    sourcePayload: payload(candidate, file),
    sourceType: "imported",
    status: "active"
  };
}

async function bulkUpdate(tx, candidates, importId, file) {
  if (!candidates.length) return;
  const values = candidates.map((candidate) => {
    const source = candidate.sources[0];
    return Prisma.sql`(
      ${candidate.existing.id}::bigint, ${candidate.derivedName ? null : candidate.name}::text,
      ${candidate.email}::text, ${candidate.phone}::text, ${candidate.location}::text,
      ${candidate.keywords}::text, ${candidate.experience}::double precision,
      ${`sheet:${source.source_sheet}`}::text, ${file}::text, ${source.row_number}::integer,
      ${importId}::bigint, ${JSON.stringify(payload(candidate, file))}::jsonb
    )`;
  });
  await tx.$executeRaw(Prisma.sql`
    UPDATE "hr_employee_records" target SET
      "name" = COALESCE(incoming.name, target."name"),
      "email" = COALESCE(incoming.email, target."email"),
      "phone" = COALESCE(incoming.phone, target."phone"),
      "location" = COALESCE(incoming.location, target."location"),
      "keywords" = COALESCE(incoming.keywords, target."keywords"),
      "experience" = COALESCE(incoming.experience, target."experience"),
      "source_id" = incoming.source_id, "source_file" = incoming.source_file,
      "row_number" = incoming.row_number, "import_id" = incoming.import_id,
      "source_payload" = COALESCE(target."source_payload", '{}'::jsonb) || incoming.source_payload,
      "updated_at" = NOW()
    FROM (VALUES ${Prisma.join(values)}) AS incoming(
      id, name, email, phone, location, keywords, experience,
      source_id, source_file, row_number, import_id, source_payload
    ) WHERE target."id" = incoming.id
  `);
}

async function addSkills(tx, candidates, insertedByKey) {
  const names = new Map();
  candidates.forEach((candidate) => candidate.skills.forEach((skill) => names.set(normalizedSkill(skill), skill)));
  if (!names.size) return;
  await tx.skill.createMany({
    data: [...names].map(([normalizedName, skillName]) => ({ normalizedName, skillName })),
    skipDuplicates: true
  });
  const skills = await tx.skill.findMany({
    where: { normalizedName: { in: [...names.keys()] } },
    select: { id: true, normalizedName: true }
  });
  const skillIds = new Map(skills.map((skill) => [skill.normalizedName, skill.id]));
  const links = [];
  candidates.forEach((candidate) => {
    const employee = candidate.existing || insertedByKey.get(candidate.recordKey);
    if (!employee) return;
    candidate.skills.forEach((skill) => {
      const skillId = skillIds.get(normalizedSkill(skill));
      if (skillId) links.push({ employeeRecordId: employee.id, skillId });
    });
  });
  if (links.length) await tx.employeeSkill.createMany({ data: links, skipDuplicates: true });
}

async function commitImport(prisma, plan, parsed, options, file) {
  const log = await prisma.hrEmployeeImport.create({
    data: {
      importedRows: 0,
      skippedPreview: parsed.stats.errors.slice(0, 25),
      skippedRows: parsed.stats.skippedInvalid,
      source: file,
      totalRows: parsed.stats.totalRows
    }
  });
  try {
    for (const batch of chunks([...plan.inserts, ...plan.updates], options.batchSize)) {
      const inserts = batch.filter((candidate) => !candidate.existing);
      const updates = batch.filter((candidate) => candidate.existing);
      await prisma.$transaction(async (tx) => {
        if (inserts.length) {
          await tx.hrEmployeeRecord.createMany({ data: inserts.map((item) => createData(item, log.id, file)), skipDuplicates: true });
        }
        await bulkUpdate(tx, updates, log.id, file);
        const inserted = inserts.length ? await tx.hrEmployeeRecord.findMany({
          where: { recordKey: { in: inserts.map((item) => item.recordKey) } },
          select: { id: true, recordKey: true }
        }) : [];
        await addSkills(tx, batch, new Map(inserted.map((item) => [item.recordKey, item])));
      }, { maxWait: 30000, timeout: 120000 });
    }
    await prisma.hrEmployeeImport.update({
      where: { id: log.id },
      data: {
        importedRows: plan.inserts.length + plan.updates.length,
        skippedPreview: [...parsed.stats.errors, ...plan.errors.map((item) => ({ reason: item.reason }))].slice(0, 25),
        skippedRows: parsed.stats.skippedInvalid + plan.errors.length
      }
    });
  } catch (error) {
    await prisma.hrEmployeeImport.update({
      where: { id: log.id },
      data: { skippedPreview: [{ message: error.message }] }
    }).catch(() => {});
    throw error;
  }
}

function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

function preview(candidates, size) {
  if (!size) return;
  console.log("\nCandidate preview (contacts masked):");
  console.table(candidates.slice(0, size).map((candidate) => ({
    email: maskEmail(candidate.email),
    experience: candidate.experience,
    location: candidate.location,
    name: candidate.name,
    phone: candidate.phone ? `${candidate.phone.slice(0, 3)}*******${candidate.phone.slice(-2)}` : null,
    recruiter: candidate.sources[0].recruiter,
    skills: candidate.skills.slice(0, 5).join(", ")
  })));
}

function summary(parsed, plan, mode) {
  const stats = parsed.stats;
  console.log("\nImport summary");
  console.log(`Mode: ${mode}`);
  console.log(`Worksheets read: ${stats.sheets}`);
  console.log(`Total Excel rows read: ${stats.totalRows}`);
  console.log(`Completely empty rows: ${stats.emptyRows}`);
  console.log(`Candidates detected: ${stats.candidatesDetected}`);
  console.log(`Unique candidates: ${stats.uniqueCandidates}`);
  console.log(`Inserted: ${plan ? plan.inserts.length : "not calculated (offline)"}`);
  console.log(`Updated: ${plan ? plan.updates.length : "not calculated (offline)"}`);
  console.log(`Duplicates: ${stats.duplicates}`);
  console.log(`Skipped/invalid rows: ${stats.skippedInvalid}`);
  console.log(`Errors: ${stats.errors.length + (plan?.errors.length || 0)}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  if (!options.file) throw new Error("Workbook path is required. Use --file <path>.");
  const file = path.resolve(options.file);
  if (!fs.existsSync(file)) throw new Error(`Workbook not found: ${file}`);
  if (!/[.]xlsx?$/i.test(file)) throw new Error("Input must be an .xlsx or .xls workbook");

  console.log(`Reading workbook: ${file}`);
  const parsed = parseWorkbook(file);
  preview(parsed.candidates, options.preview);
  if (options.offline) return summary(parsed, null, "DRY RUN (offline)");
  if (!process.env.DATABASE_URL) throw new Error(`DATABASE_URL is missing from ${backendEnvPath}`);

  const prisma = new PrismaClient();
  try {
    const plan = await planImport(prisma, parsed.candidates, options.batchSize);
    summary(parsed, plan, options.commit ? "COMMIT" : "DRY RUN");
    if (!options.commit) {
      console.log("\nDry run complete. No database rows were changed.");
      return;
    }
    await commitImport(prisma, plan, parsed, options, path.basename(file));
    console.log("\nImport completed successfully.");
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    const migrationHint = error.code === "P2021"
      ? "\nThe HR tables are missing. Run `npm run prisma:deploy` before the database dry run."
      : "";
    console.error(`\nImport failed: ${error.message}${migrationHint}`);
    process.exitCode = 1;
  });
}

module.exports = { emailsFrom, experienceFrom, extractCandidate, parseWorkbook, phonesFrom };
