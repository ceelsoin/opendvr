#!/usr/bin/env node
/**
 * Transparent TCP proxy that logs every byte exchanged between a client
 * (e.g. MediaMTX, running inside Docker) and a real RTSP camera. Used to
 * capture the EXACT request/response sequence MediaMTX's Go RTSP client
 * (gortsplib) sends, since it fails with "bad status code: 400 (Bad
 * Request)" against a specific camera while our own raw-socket test
 * (single-connection Digest handshake) succeeds.
 *
 * Usage:
 *   node scripts/rtsp-proxy-logger.js <listenPort> <targetHost> <targetPort>
 *
 * Example:
 *   node scripts/rtsp-proxy-logger.js 5554 192.168.88.35 554
 *
 * Then point MediaMTX's path "source" at this proxy instead of the camera
 * directly, e.g.:
 *   rtsp://admin:senha@host.docker.internal:5554/onvif1
 * (host.docker.internal resolves to the host machine from inside Docker on
 * macOS/OrbStack, where this script would be running.)
 *
 * All traffic is logged to stdout, tagged with direction and a per-connection
 * id, both as text (for the RTSP control channel) - binary RTP/RTCP data (if
 * the session gets that far) will just show up as unreadable bytes, which is
 * fine, we only care about the control handshake here.
 */

const net = require("node:net");

const listenPort = Number(process.argv[2]);
const targetHost = process.argv[3];
const targetPort = Number(process.argv[4]);

if (!listenPort || !targetHost || !targetPort) {
  console.error("Uso: node scripts/rtsp-proxy-logger.js <listenPort> <targetHost> <targetPort>");
  process.exit(1);
}

let connectionCounter = 0;

function log(connId, direction, chunk) {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] [conn ${connId}] ${direction} (${chunk.length} bytes)`);
  console.log(chunk.toString("utf8"));
}

const server = net.createServer((clientSocket) => {
  const connId = ++connectionCounter;
  console.log(`\n>>> Nova conexão recebida (conn ${connId}) de ${clientSocket.remoteAddress}:${clientSocket.remotePort}`);

  const upstreamSocket = net.createConnection({ host: targetHost, port: targetPort }, () => {
    console.log(`>>> (conn ${connId}) conectado ao destino real ${targetHost}:${targetPort}`);
  });

  clientSocket.on("data", (chunk) => {
    log(connId, "CLIENTE -> CÂMERA", chunk);
    upstreamSocket.write(chunk);
  });

  upstreamSocket.on("data", (chunk) => {
    log(connId, "CÂMERA -> CLIENTE", chunk);
    clientSocket.write(chunk);
  });

  const closeBoth = (reason) => {
    console.log(`>>> (conn ${connId}) encerrando: ${reason}`);
    clientSocket.destroy();
    upstreamSocket.destroy();
  };

  clientSocket.on("close", () => closeBoth("cliente fechou a conexão"));
  clientSocket.on("error", (err) => closeBoth(`erro no cliente: ${err.message}`));
  upstreamSocket.on("close", () => closeBoth("câmera fechou a conexão"));
  upstreamSocket.on("error", (err) => closeBoth(`erro na câmera: ${err.message}`));
});

server.listen(listenPort, () => {
  console.log(`Proxy RTSP escutando em :${listenPort}, encaminhando para ${targetHost}:${targetPort}`);
  console.log("Aponte o source da câmera no MediaMTX para este proxy pra capturar o handshake real.");
});
