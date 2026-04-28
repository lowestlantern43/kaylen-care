export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message) {
  return new HttpError(400, "bad_request", message);
}

export function unauthorized(message = "Please log in to continue.") {
  return new HttpError(401, "unauthorized", message);
}

export function forbidden(message = "You do not have permission to do that.") {
  return new HttpError(403, "forbidden", message);
}

export function notFound(message = "Not found.") {
  return new HttpError(404, "not_found", message);
}
