const importService = require("../services/import.service");

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function importCandidates(req, res, next) {
  try {
    if (!req.file) {
      throw createHttpError(400, "Candidate import file is required");
    }

    const result = await importService.importCandidates(req.file);

    res.status(200).json({
      success: true,
      summary: result.summary,
      ...(result.failedRows.length ? { failedRows: result.failedRows } : {})
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  importCandidates
};
