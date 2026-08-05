const fs = require("node:fs");
const path = require("node:path");

const uploadRoot = path.join(__dirname, "..", "uploads");
const uploadFolders = [
  path.join(uploadRoot, "resumes"),
  path.join(uploadRoot, "profile"),
  path.join(uploadRoot, "imports")
];

function ensureUploadFolders() {
  for (const folder of uploadFolders) {
    fs.mkdirSync(folder, { recursive: true });
  }
}

module.exports = {
  uploadRoot,
  ensureUploadFolders
};
