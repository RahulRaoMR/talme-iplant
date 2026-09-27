const path = require("node:path");
const { spawnSync } = require("node:child_process");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), ...process.argv.slice(2)], { stdio: "inherit", cwd: path.resolve(__dirname, ".."), env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
