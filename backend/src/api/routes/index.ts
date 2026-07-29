import { Router } from "express";
import { camerasRouter } from "./cameras.routes.js";
import { discoveryRouter } from "./discovery.routes.js";
import { onvifRouter } from "./onvif.routes.js";
import { ptzRouter } from "./ptz.routes.js";
import { recordingsRouter } from "./recordings.routes.js";
import { eventsRouter } from "./events.routes.js";
import { gridsRouter } from "./grids.routes.js";
import { settingsRouter } from "./settings.routes.js";
import { systemRouter } from "./system.routes.js";
import { authRouter } from "./auth.routes.js";
import { maintenanceRouter } from "./maintenance.routes.js";
import { pushRouter } from "./push.routes.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/cameras", camerasRouter);
apiRouter.use("/discovery", discoveryRouter);
apiRouter.use("/onvif", onvifRouter);
apiRouter.use("/ptz", ptzRouter);
apiRouter.use("/recordings", recordingsRouter);
apiRouter.use("/events", eventsRouter);
apiRouter.use("/grids", gridsRouter);
apiRouter.use("/settings", settingsRouter);
apiRouter.use("/system", systemRouter);
apiRouter.use("/maintenance", maintenanceRouter);
apiRouter.use("/push", pushRouter);
