import { Router } from "express";
import { z } from "zod";
import { getVapidPublicKey } from "../../lib/webPush.js";
import { deletePushSubscription, upsertPushSubscription } from "../../db/pushSubscriptions.repository.js";
import { t } from "../../i18n/index.js";

export const pushRouter = Router();

/**
 * Public key the frontend needs to create a `PushSubscription` via
 * `pushManager.subscribe()`. Not a secret (it's sent to the browser's push
 * service anyway) - safe to expose, but still gated behind the app's
 * global auth like the rest of `/api` (see auth/requireAuth.ts), since
 * there's no reason to expose it to unauthenticated clients either.
 */
pushRouter.get("/vapid-public-key", (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

pushRouter.post("/subscribe", (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }
  upsertPushSubscription({
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
  });
  res.status(201).json({ ok: true });
});

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

pushRouter.post("/unsubscribe", (req, res) => {
  const parsed = unsubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: t("errors.invalidPayload"), details: parsed.error.flatten() });
    return;
  }
  deletePushSubscription(parsed.data.endpoint);
  res.json({ ok: true });
});
