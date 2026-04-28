import { forbidden } from "../utils/httpError.js";

export function requirePlatformAdmin(req, res, next) {
  if (!req.user?.is_platform_admin) {
    next(forbidden("Platform admin access is required."));
    return;
  }

  next();
}
