const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const config = require("./config");
const AppError = require("./utils/AppError");
const errorHandler = require("./middleware/errorHandler");
const logger = require("./utils/logger");
const { createRateLimiter } = require("./middleware/rateLimiter");
const authRoutes = require("./routes/auth.routes");
const documentRoutes = require("./routes/document.routes");
const versionRoutes = require("./routes/version.routes");
const reviewRoutes = require("./routes/review.routes");
const { isRedisReady } = require("./config/redis");
const mongoose = require("mongoose");

const app = express();

app.use(
  morgan("dev", {
    stream: {
      write: (message) => logger.info({ message: message.trim(), type: "http" })
    }
  })
);

app.use(helmet());
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

const apiLimiter = createRateLimiter({
  keyPrefix: `${config.redisPrefix}:api`,
  windowMs: config.rateLimits.apiWindowSeconds * 1000,
  max: config.rateLimits.apiMax
});

app.use("/api", apiLimiter);

app.get("/health", (req, res) => {
  const mongoState = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  const redisState = isRedisReady() ? "connected" : "disconnected";
  res.status(200).json({
    success: true,
    data: {
      status: "ok",
      mongo: mongoState,
      redis: redisState
    }
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/documents/:id/versions", versionRoutes);
app.use("/api/review", reviewRoutes);

// AGENT_RUNNER_START
require("./agent-runner").register(app);
// AGENT_RUNNER_END

app.use((req, res, next) => {
  next(new AppError("Route not found", 404, "NOT_FOUND"));
});

app.use(errorHandler);

module.exports = app;
