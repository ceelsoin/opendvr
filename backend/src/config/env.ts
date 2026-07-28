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

  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "1h",
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
};
