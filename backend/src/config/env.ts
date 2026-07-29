import "dotenv/config";
import path from "node:path";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),

  // Used to format human-readable timestamps in notification messages (see
  // notifications/webhooks.ts). Deliberately NOT relying on the container's
  // system/`TZ` env var alone for this - Node's `Intl`/`toLocaleString`
  // resolves the timezone through ICU, which is bundled with Node itself
  // (unlike the OS's own tzdata), so passing it explicitly here is more
  // reliable across environments/base images than hoping `TZ` propagates.
  timezone: process.env.TZ ?? "America/Sao_Paulo",

  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "1h",
  // Longer-lived session used when the user checks "Manter conectado" at
  // login (see auth.routes.ts) - trades some security for convenience on
  // trusted personal devices, same idea as most apps' "remember me".
  jwtRememberMeExpiresIn: process.env.JWT_REMEMBER_ME_EXPIRES_IN ?? "30d",
  // See auth/token.ts's buildAuthCookie for why this defaults to false.
  cookieSecure: process.env.COOKIE_SECURE === "true",

  dataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
  recordingsDir: path.resolve(process.env.RECORDINGS_DIR ?? "./data/recordings"),
  snapshotsDir: path.resolve(process.env.SNAPSHOTS_DIR ?? "./data/snapshots"),
  dbFile: path.resolve(process.env.DB_FILE ?? "./data/ipcam.db"),

  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",

  mediamtxApiUrl: process.env.MEDIAMTX_API_URL ?? "http://127.0.0.1:9997",
  mediamtxRtspUrl: process.env.MEDIAMTX_RTSP_URL ?? "rtsp://127.0.0.1:8554",
  mediamtxHlsUrl: process.env.MEDIAMTX_HLS_URL ?? "http://127.0.0.1:8888",
  mediamtxPlaybackUrl: process.env.MEDIAMTX_PLAYBACK_URL ?? "http://127.0.0.1:9996",

  vlcPath: process.env.VLC_PATH ?? "cvlc",
  // Hostname other containers (MediaMTX) should use to reach this backend's
  // VLC relay processes. Defaults to the docker-compose service name.
  vlcRelayHost: process.env.VLC_RELAY_HOST ?? "backend",
  vlcRelayPortStart: Number(process.env.VLC_RELAY_PORT_START ?? 9500),

  // Alpine's chromium package binary path, used by media/webpageBridge.ts
  // (the "webpage" camera source type) via playwright-core's
  // `executablePath` - Playwright's own bundled browser download is
  // skipped entirely (see Dockerfile comment).
  chromiumPath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium-browser",

  // Optional external notifications on motion/tamper events. Any of these
  // left unset simply disables that specific channel (see
  // notifications/*.ts) - none are required for the app to work. All are
  // also editable at runtime from the Settings page (persisted in the
  // `settings` table, which takes precedence over these).
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || null,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || null,
  telegramChatId: process.env.TELEGRAM_CHAT_ID || null,
  genericWebhookUrl: process.env.GENERIC_WEBHOOK_URL || null,
  smtpHost: process.env.SMTP_HOST || null,
  smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null,
  smtpUser: process.env.SMTP_USER || null,
  smtpPass: process.env.SMTP_PASS || null,
  smtpSecure: process.env.SMTP_SECURE === "true",
  emailFrom: process.env.EMAIL_FROM || null,
  emailTo: process.env.EMAIL_TO || null,
  // Used to build clickable links back to the Timeline in notifications
  // (e.g. "http://192.168.1.50:4000") - optional, since this is a LAN app
  // with no single canonical hostname otherwise known to the backend.
  publicBaseUrl: process.env.PUBLIC_BASE_URL || null,

  // Optional S3-compatible object storage (AWS S3, Linode, DigitalOcean
  // Spaces, MinIO, etc) used to publish event snapshots at a public URL -
  // needed because Discord/Telegram can accept an image URL directly
  // (simpler/more reliable than multipart file upload for some webhook
  // setups), and some generic webhook consumers expect a URL rather than a
  // base64 blob. Entirely optional: when unset, snapshots are only ever
  // attached as raw file bytes (existing behavior), never uploaded anywhere.
  s3Endpoint: process.env.S3_ENDPOINT || null,
  s3Region: process.env.S3_REGION || "us-east-1",
  s3AccessKey: process.env.S3_ACCESS_KEY || null,
  s3SecretKey: process.env.S3_SECRET_KEY || null,
  s3BucketName: process.env.S3_BUCKET_NAME || null,

  // Web Push (browser/PWA push notifications, see lib/webPush.ts). Both
  // unset by default - a VAPID key pair is generated automatically on
  // first use and persisted in the `settings` table, so no manual
  // `web-push generate-vapid-keys` step is required. Setting these two env
  // vars instead pins a specific key pair (e.g. to keep the same identity
  // across a DB restore/migration to a fresh `app-data` volume).
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || null,
  // Contact URI required by the Web Push protocol (sent to push services
  // so they can reach the sender about issues) - a mailto: or https: URL.
  vapidSubject: process.env.VAPID_SUBJECT || "mailto:admin@opendvr.local",
};
