const path = require("node:path");
const multer = require("multer");
const { uploadRoot } = require("../utils/ensureUploads");

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const targetFolder = file.fieldname === "profile" ? "profile" : "resumes";
    cb(null, path.join(uploadRoot, targetFolder));
  },
  filename(req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({ storage });

module.exports = { upload };
