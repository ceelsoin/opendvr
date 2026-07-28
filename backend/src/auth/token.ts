import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AuthTokenPayload {
  sub: string;
  username: string;
}

/** Signs a session JWT for a user - expires per `JWT_EXPIRES_IN` (default 1h, see config/env.ts). */
export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

/** Verifies a session JWT; returns null (never throws) if missing/invalid/expired. */
export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
  } catch {
    return null;
  }
}

export const AUTH_COOKIE_NAME = "token";

/** Minimal manual cookie parsing - avoids adding a `cookie-parser` dependency for a single cookie. */
export function getCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

/** Builds the `Set-Cookie` header value for the session cookie (httpOnly, so it's inaccessible to JS/XSS). */
export function buildAuthCookie(token: string, maxAgeMs: number): string {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  // Deliberately NOT tied to NODE_ENV: this app is commonly deployed via
  // Docker on a LAN, accessed over plain HTTP by IP (not a public HTTPS
  // site) - "production" here does not imply HTTPS. Setting `Secure`
  // unconditionally would make browsers silently refuse to send the cookie
  // at all over HTTP, breaking login with no obvious error. Only opt in via
  // COOKIE_SECURE=true if this is actually deployed behind HTTPS (e.g. a
  // reverse proxy terminating TLS).
  if (env.cookieSecure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildClearAuthCookie(): string {
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
