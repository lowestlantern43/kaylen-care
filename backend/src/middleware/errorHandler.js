import { HttpError } from "../utils/httpError.js";

export function notFoundHandler(req, res) {
  res.status(404).json({
    data: null,
    error: {
      code: "not_found",
      message: `No route found for ${req.method} ${req.originalUrl}`,
    },
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({
      data: null,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  console.error(error);

  res.status(500).json({
    data: null,
    error: {
      code: "server_error",
      message: req.user?.is_platform_admin
        ? error.message || "Something went wrong."
        : "Something went wrong.",
    },
  });
}
