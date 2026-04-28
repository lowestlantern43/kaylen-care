import jwt from "jsonwebtoken";
import { config } from "../config.js";

export const sessionCookieName = "kaylens_diary_session";

export function createSessionToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.sessionSecret, {
    expiresIn: "7d",
  });
}

export function verifySessionToken(token) {
  return jwt.verify(token, config.sessionSecret);
}

export function setSessionCookie(res, token) {
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? "none" : "lax",
    path: "/",
  });
}
