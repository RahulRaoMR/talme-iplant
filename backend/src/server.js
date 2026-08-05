const app = require("./app");
const env = require("./config/env");
const { prisma } = require("./config/prisma");

const server = app.listen(env.port, () => {
  console.log(`Candidate backend running on port ${env.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received. Closing server...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
