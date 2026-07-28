#!/usr/bin/env node
/**
 * Standalone ONVIF connectivity tester - bypasses the whole app (API, DB,
 * MediaMTX) so we can quickly iterate against a real camera that isn't
 * working through the normal flow (e.g. Yoosee cameras). Tries more than
 * one client library so we can see empirically which one (if any) actually
 * talks to the device correctly.
 *
 * Usage (from inside the backend container or locally with deps installed):
 *   node scripts/test-onvif-isolated.js <host> <port> <path> <username> <password>
 *
 * Example (matches Yoosee's typical ONVIF port/path):
 *   node scripts/test-onvif-isolated.js 192.168.88.35 5000 /onvif admin dhy42imb
 *
 * To also test the 'node-onvif' library (used by Shinobi's fork), install it
 * first (not a permanent dependency of this project, just for this test):
 *   npm install node-onvif --no-save
 */

const host = process.argv[2];
const port = Number(process.argv[3]) || 80;
const onvifPath = process.argv[4] || "/onvif/device_service";
const username = process.argv[5];
const password = process.argv[6];

if (!host || !username || !password) {
  console.error("Uso: node scripts/test-onvif-isolated.js <host> <port> <path> <username> <password>");
  process.exit(1);
}

function section(title) {
  console.log("\n" + "=".repeat(70));
  console.log(title);
  console.log("=".repeat(70));
}

async function testOnvifPackage() {
  section("1) Pacote 'onvif' (o que o backend usa hoje)");
  const onvif = require("onvif/promises");
  const cam = new onvif.Cam({ hostname: host, port, path: onvifPath, username, password, timeout: 15000 });
  try {
    await cam.connect();
    console.log("Conectou! Device information:", cam.deviceInformation);
    const profiles = await cam.getProfiles();
    console.log(`${profiles.length} perfil(is) encontrado(s)`);
    for (const p of profiles) {
      const token = p?.$?.token ?? p?.token;
      try {
        const { uri } = await cam.getStreamUri({ protocol: "RTSP", profileToken: token });
        console.log(`   - ${p.name || token}: ${uri}`);
      } catch (e) {
        console.log(`   - ${p.name || token}: falhou ao obter stream URI (${e.message})`);
      }
    }
  } catch (err) {
    console.log("FALHOU:", err.message);
  }
}

async function testNodeOnvif() {
  section("2) Pacote 'node-onvif' (base do fork que o Shinobi usa)");
  let onvif;
  try {
    onvif = require("node-onvif");
  } catch {
    console.log("'node-onvif' não está instalado nesta pasta. Para testar, rode:");
    console.log("  npm install node-onvif --no-save && node scripts/test-onvif-isolated.js ...");
    return;
  }
  const device = new onvif.OnvifDevice({
    xaddr: `http://${host}:${port}${onvifPath}`,
    user: username,
    pass: password,
  });
  try {
    const info = await device.init();
    console.log("Conectou! Device information:", info);
    const profile = device.getCurrentProfile();
    console.log("Stream do perfil atual:", JSON.stringify(profile && profile.stream, null, 2));
  } catch (err) {
    console.log("FALHOU:", err.message);
  }
}

async function main() {
  console.log(`Testando http://${host}:${port}${onvifPath} com usuario "${username}"`);
  await testOnvifPackage();
  await testNodeOnvif();
  section("Fim dos testes");
}

main();
