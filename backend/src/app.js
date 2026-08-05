const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const env = require("./config/env");
const { apiLimiter } = require("./middleware/rateLimiter");
const { notFoundHandler } = require("./middleware/notFound");
const { errorHandler } = require("./middleware/errorHandler");
const healthRoutes = require("./routes/health.routes");
const candidateRoutes = require("./routes/candidate.routes");
const importRoutes = require("./routes/import.routes");
const { ensureUploadFolders } = require("./utils/ensureUploads");

ensureUploadFolders();

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(apiLimiter);

app.use("/api", healthRoutes);
app.use("/api", candidateRoutes);
app.use("/api", importRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
