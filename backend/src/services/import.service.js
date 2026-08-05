const fs = require("node:fs");
const path = require("node:path");
const csvParser = require("csv-parser");
const xlsx = require("xlsx");

const { prisma } = require("../config/prisma");

const BATCH_SIZE = 500;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const acceptedExtensions = new Set([".xlsx", ".xls", ".csv"]);
const requiredColumns = ["fullName", "phone", "location", "keywords"];
const optionalColumns = ["email", "experience", "currentCompany", "currentDesignation"];
const allowedColumns = new Set([...requiredColumns, ...optionalColumns]);

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function waitForNextTick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeHeader(header) {
  return String(header || "").trim();
}

function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizePhone(phone) {
  return normalizeValue(phone).replace(/[\s().-]/g, "");
}

function validateFile(file) {
  if (!file) {
    throw createHttpError(400, "Candidate import file is required");
  }

  const extension = path.extname(file.originalname || file.path).toLowerCase();
  if (!acceptedExtensions.has(extension)) {
    throw createHttpError(400, "Only .xlsx, .xls, and .csv files are allowed");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw createHttpError(413, "File size must be 50 MB or less");
  }

  return extension;
}

function validateColumns(headers) {
  const headerSet = new Set(headers.map(normalizeHeader).filter(Boolean));
  const missing = requiredColumns.filter((column) => !headerSet.has(column));

  if (missing.length) {
    throw createHttpError(400, `Missing required columns: ${missing.join(", ")}`);
  }
}

function isEmptyRow(row) {
  return Object.values(row).every((value) => normalizeValue(value) === "");
}

async function parseExcel(filePath) {
  const buffer = await fs.promises.readFile(filePath);
  await waitForNextTick();

  const workbook = xlsx.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw createHttpError(400, "Uploaded workbook does not contain any sheets");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false
  });

  if (!rows.length) {
    throw createHttpError(400, "Uploaded file is empty");
  }

  const headers = rows[0].map(normalizeHeader);
  validateColumns(headers);

  const dataRows = rows.slice(1).map((values, index) => {
    const row = {};
    headers.forEach((header, headerIndex) => {
      if (allowedColumns.has(header)) {
        row[header] = values[headerIndex];
      }
    });
    return { rowNumber: index + 2, row };
  });

  return { headers, dataRows };
}

async function parseCsv(filePath) {
  return new Promise((resolve, reject) => {
    const dataRows = [];
    let headers = [];
    let rowNumber = 1;
    let settled = false;

    function rejectOnce(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    const readStream = fs.createReadStream(filePath);
    readStream
      .pipe(
        csvParser({
          mapHeaders: ({ header }) => normalizeHeader(header)
        })
      )
      .on("headers", (parsedHeaders) => {
        headers = parsedHeaders.map(normalizeHeader);
        try {
          validateColumns(headers);
        } catch (error) {
          readStream.destroy();
          rejectOnce(error);
        }
      })
      .on("data", (row) => {
        rowNumber += 1;
        const filteredRow = {};
        for (const [key, value] of Object.entries(row)) {
          if (allowedColumns.has(key)) {
            filteredRow[key] = value;
          }
        }
        dataRows.push({ rowNumber, row: filteredRow });
      })
      .on("error", rejectOnce)
      .on("end", () => {
        if (settled) return;
        if (!headers.length) {
          rejectOnce(createHttpError(400, "Uploaded file is empty"));
          return;
        }
        settled = true;
        resolve({ headers, dataRows });
      });
  });
}

async function parseCandidateFile(filePath, extension) {
  if (extension === ".csv") {
    return parseCsv(filePath);
  }
  return parseExcel(filePath);
}

function normalizeCandidateRow(row) {
  const data = {
    fullName: normalizeValue(row.fullName),
    phone: normalizePhone(row.phone),
    location: normalizeValue(row.location),
    keywords: normalizeValue(row.keywords),
    email: normalizeValue(row.email).toLowerCase() || null,
    currentCompany: normalizeValue(row.currentCompany) || null,
    currentDesignation: normalizeValue(row.currentDesignation) || null
  };

  const experience = normalizeValue(row.experience);
  if (experience === "") {
    data.experience = null;
  } else {
    const parsedExperience = Number(experience);
    if (Number.isNaN(parsedExperience) || parsedExperience < 0) {
      throw new Error("experience must be a positive number");
    }
    data.experience = parsedExperience;
  }

  for (const column of requiredColumns) {
    if (!data[column]) {
      throw new Error(`${column} is required`);
    }
  }

  if (data.email && !isValidEmail(data.email)) {
    throw new Error("Invalid email format");
  }

  return data;
}

function validateRows(dataRows) {
  const records = [];
  const failedRows = [];
  let totalRows = 0;

  for (const { rowNumber, row } of dataRows) {
    if (isEmptyRow(row)) continue;
    totalRows += 1;

    try {
      records.push({
        rowNumber,
        data: normalizeCandidateRow(row)
      });
    } catch (error) {
      failedRows.push({
        rowNumber,
        reasons: [error.message]
      });
    }
  }

  return { records, failedRows, totalRows };
}

function buildDuplicateWhere(data) {
  const duplicateFields = [{ phone: data.phone }];
  if (data.email) {
    duplicateFields.push({ email: data.email });
  }
  return { OR: duplicateFields };
}

function getDatabaseErrorReason(error) {
  if (error.code === "P2002") {
    const fields = Array.isArray(error.meta?.target) ? error.meta.target.join(", ") : "unique field";
    return `Duplicate ${fields}`;
  }
  return error.message || "Failed to import row";
}

async function importBatch(batch) {
  return prisma.$transaction(
    async (tx) => {
      const summary = {
        created: 0,
        updated: 0,
        duplicates: 0,
        failed: 0
      };
      const failedRows = [];

      for (const record of batch) {
        try {
          const matches = await tx.candidate.findMany({
            where: buildDuplicateWhere(record.data),
            select: { id: true },
            take: 2
          });

          if (matches.length > 1) {
            summary.failed += 1;
            failedRows.push({
              rowNumber: record.rowNumber,
              reasons: ["Phone and email match different candidates"]
            });
            continue;
          }

          if (matches.length === 1) {
            summary.duplicates += 1;
            summary.updated += 1;
            await tx.candidate.update({
              where: { id: matches[0].id },
              data: record.data
            });
            continue;
          }

          summary.created += 1;
          await tx.candidate.create({
            data: record.data
          });
        } catch (error) {
          summary.failed += 1;
          failedRows.push({
            rowNumber: record.rowNumber,
            reasons: [getDatabaseErrorReason(error)]
          });
        }
      }

      return { summary, failedRows };
    },
    {
      maxWait: 10000,
      timeout: 60000
    }
  );
}

async function persistRecords(records) {
  const summary = {
    created: 0,
    updated: 0,
    duplicates: 0,
    failed: 0
  };
  const failedRows = [];

  for (let index = 0; index < records.length; index += BATCH_SIZE) {
    const batch = records.slice(index, index + BATCH_SIZE);
    const result = await importBatch(batch);

    summary.created += result.summary.created;
    summary.updated += result.summary.updated;
    summary.duplicates += result.summary.duplicates;
    summary.failed += result.summary.failed;
    failedRows.push(...result.failedRows);

    await waitForNextTick();
  }

  return { summary, failedRows };
}

async function importCandidates(file) {
  const extension = validateFile(file);

  try {
    const parsedFile = await parseCandidateFile(file.path, extension);
    const validation = validateRows(parsedFile.dataRows);
    const persisted = await persistRecords(validation.records);
    const failedRows = [...validation.failedRows, ...persisted.failedRows];

    return {
      summary: {
        totalRows: validation.totalRows,
        created: persisted.summary.created,
        updated: persisted.summary.updated,
        duplicates: persisted.summary.duplicates,
        failed: failedRows.length
      },
      failedRows
    };
  } finally {
    await fs.promises.unlink(file.path).catch(() => {});
  }
}

module.exports = {
  importCandidates
};
