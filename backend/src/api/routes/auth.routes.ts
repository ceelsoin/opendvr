import { Router } from "express";
import bcrypt from "bcryptjs";
import ms from "ms";
import { z } from "zod";
import { countUsers, createUser, getUserByUsername } from "../../db/users.repository.js";
import { buildAuthCookie, buildClearAuthCookie, getCookie, signAuthToken, verifyAuthToken } from "../../auth/token.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

export const authRouter = Router();

const SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1h - matches env.jwtExpiresIn's default

/** Tells the frontend whether to show Setup (no account yet) or Login, and whether the current request is already authenticated. */
authRouter.get("/status", (req, res) => {
  const hasUser = countUsers() > 0;
  const token = getCookie(req.headers.cookie, "token");
  const authenticated = Boolean(token && verifyAuthToken(token));
  res.json({ hasUser, authenticated });
});

const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(8).max(200),
  // "Manter conectado" - issues a much longer-lived session (JWT +
  // cookie) instead of the default short one. See config/env.ts's
  // jwtRememberMeExpiresIn.
  rememberMe: z.boolean().optional(),
});

/** Resolves the session's expiresIn (JWT) + matching cookie Max-Age (ms) from the rememberMe flag. */
function resolveSessionDuration(rememberMe: boolean | undefined): { expiresIn: string; maxAgeMs: number } {
  if (rememberMe) {
    return { expiresIn: env.jwtRememberMeExpiresIn, maxAgeMs: ms(env.jwtRememberMeExpiresIn as ms.StringValue) };
  }
  return { expiresIn: env.jwtExpiresIn, maxAgeMs: SESSION_MAX_AGE_MS };
}

/** Creates the first (and typically only) admin account. Refuses if one already exists - use /login instead. */
authRouter.post("/setup", async (req, res) => {
  if (countUsers() > 0) {
    res.status(409).json({ error: "Já existe uma conta configurada. Use a tela de login." });
    return;
  }

  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = createUser(parsed.data.username, passwordHash);
  logger.info({ username: user.username }, "Admin account created");

  const { expiresIn, maxAgeMs } = resolveSessionDuration(parsed.data.rememberMe);
  const token = signAuthToken({ sub: user.id, username: user.username }, expiresIn);
  res.setHeader("Set-Cookie", buildAuthCookie(token, maxAgeMs));
  res.status(201).json({ ok: true });
});

authRouter.post("/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Usuário ou senha inválidos" });
    return;
  }

  const user = getUserByUsername(parsed.data.username);
  const validPassword = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
  if (!user || !validPassword) {
    res.status(401).json({ error: "Usuário ou senha inválidos" });
    return;
  }

  const { expiresIn, maxAgeMs } = resolveSessionDuration(parsed.data.rememberMe);
  const token = signAuthToken({ sub: user.id, username: user.username }, expiresIn);
  res.setHeader("Set-Cookie", buildAuthCookie(token, maxAgeMs));
  res.json({ ok: true });
});

authRouter.post("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", buildClearAuthCookie());
  res.json({ ok: true });
});
