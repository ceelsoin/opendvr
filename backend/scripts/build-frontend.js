// Builds the frontend and copies its output into dist/web, so the backend
// can serve it as static files under the /web route (see src/app.ts).
// Runs automatically as part of `npm run build` (see package.json).

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.resolve(__dirname, "..", "..", "frontend");
const frontendDist = path.join(frontendDir, "dist");
const backendDistWeb = path.resolve(__dirname, "..", "dist", "web");

console.log(`[build-frontend] Building frontend at ${frontendDir}...`);
execSync("npm run build", { cwd: frontendDir, stdio: "inherit" });

if (!fs.existsSync(frontendDist)) {
  console.error(`[build-frontend] Expected frontend build output at ${frontendDist}, but it does not exist.`);
  process.exit(1);
}

console.log(`[build-frontend] Copying ${frontendDist} -> ${backendDistWeb}`);
fs.rmSync(backendDistWeb, { recursive: true, force: true });
fs.cpSync(frontendDist, backendDistWeb, { recursive: true });

console.log("[build-frontend] Done.");
