import type { AuthTokenPayload } from "../auth/token.js";

// Augments Express's Request with the decoded session JWT payload, set by
// auth/requireAuth.ts once a request passes the auth gate - lets route
// handlers (e.g. maintenance.routes.ts's change-password/factory-reset)
// know which admin account is making the request without re-parsing the
// cookie themselves.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export {};
