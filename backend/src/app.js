import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiRouter } from "./routes/index.js";
import { stripeRouter } from "./routes/stripe.routes.js";

export function createApp() {
  const app = express();
  const configuredOrigins = config.frontendUrl
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }

        const isConfiguredOrigin = configuredOrigins.includes(origin);
        const isLocalDevOrigin =
          !config.isProduction &&
          /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(
            origin,
          );

        callback(null, isConfiguredOrigin || isLocalDevOrigin);
      },
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use("/api/stripe", express.raw({ type: "application/json" }), stripeRouter);
  app.use("/stripe", express.raw({ type: "application/json" }), stripeRouter);
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", apiRouter);
  app.use("/", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
