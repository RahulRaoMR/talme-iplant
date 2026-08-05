const path = require("node:path");
const multer = require("multer");
const router = require("express").Router();

const importController = require("../controllers/import.controller");
const { uploadRoot } = require("../utils/ensureUploads");

const acceptedExtensions = new Set([".xlsx", ".xls", ".csv"]);
const importUploadFolder = path.join(uploadRoot, "imports");

const storage = multer.diskStorage({
  destination: importUploadFolder,
  filename: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
    callback(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024
  },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!acceptedExtensions.has(extension)) {
      const error = new Error("Only .xlsx, .xls, and .csv files are allowed");
      error.statusCode = 400;
      callback(error);
      return;
    }
    callback(null, true);
  }
});

function uploadCandidateFile(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      error.statusCode = 413;
      error.message = "File size must be 50 MB or less";
    } else {
      error.statusCode = error.statusCode || 400;
    }

    next(error);
  });
}

router.post("/import/candidates", uploadCandidateFile, importController.importCandidates);

module.exports = router;
