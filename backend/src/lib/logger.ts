import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.nodeEnv === "production" ? "info" : "debug",
  transport:
    env.nodeEnv === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        },
});
