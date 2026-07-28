#!/usr/bin/env node
/**
 * Standalone RTSP handshake tester - bypasses MediaMTX/ffmpeg/ffprobe
 * entirely and talks raw RTSP over a plain TCP socket, so we can see the
 * EXACT request/response bytes exchanged with a camera that MediaMTX
 * rejects with "bad status code: 400 (Bad Request)" while VLC connects
 * fine.
 *
 * IMPORTANT: many cheap embedded RTSP stacks (e.g. HiSilicon-based, seen
 * here as realm="HIipCamera") tie the Digest auth nonce to the SAME TCP
 * connection where the 401 challenge was issued - sending the
 * authenticated retry on a brand new connection gets rejected with 400
 * instead of being validated. VLC (live555) always keeps one persistent
 * connection for the whole handshake, so this script now does the same:
 * OPTIONS -> DESCRIBE (expect 401) -> DESCRIBE with Digest auth, all on
 * ONE socket, plus a same-connection Basic-auth fallback if useful.
 *
 * Usage:
 *   node scripts/test-rtsp-isolated.js <host> <port> <path> <username> <password>
 *
 * Example (Yoosee-style camera):
 *   node scripts/test-rtsp-isolated.js 192.168.88.35 554 /onvif1 admin dhy42imb
 */

const net = require("node:net");
const crypto = require("node:crypto");

const host = process.argv[2];
const port = Number(process.argv[3]) || 554;
const rtspPath = (process.argv[4] || "/").replace(/^([^/])/, "/$1");
const username = process.argv[5];
const password = process.argv[6];

if (!host || !username || !password) {
  console.error("Uso: node scripts/test-rtsp-isolated.js <host> <port> <path> <username> <password>");
  process.exit(1);
}

function section(title) {
  console.log("\n" + "=".repeat(70));
  console.log(title);
  console.log("=".repeat(70));
}

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function parseStatusCode(raw) {
  const m = raw?.match(/^RTSP\/1\.0 (\d+)/);
  return m ? Number(m[1]) : null;
}

function parseHeader(raw, name) {
  const re = new RegExp(`^${name}:\\s*(.+)$`, "im");
  const m = raw?.match(re);
  return m ? m[1].trim() : null;
}

function buildDigestAuthHeader({ method, uri, wwwAuthenticate }) {
  const realm = /realm="([^"]+)"/.exec(wwwAuthenticate)?.[1] ?? "";
  const nonce = /nonce="([^"]+)"/.exec(wwwAuthenticate)?.[1] ?? "";
  const qop = /qop="?([^",]+)"?/.exec(wwwAuthenticate)?.[1];
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  if (qop) {
    const nc = "00000001";
    const cnonce = crypto.randomBytes(8).toString("hex");
    const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  }
  const response = md5(`${ha1}:${nonce}:${ha2}`);
  return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
}

function buildBasicAuthHeader() {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

/** Keeps a single persistent TCP connection alive across multiple sequential RTSP requests (mimics VLC/live555/MediaMTX behavior). */
class RtspSession {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.buffer = "";
    this.pending = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.host, port: this.port });
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
      this.socket.on("data", (chunk) => this._onData(chunk));
      this.socket.on("close", () => {
        if (this.pending) {
          const { reject: rejectPending } = this.pending;
          this.pending = null;
          rejectPending(new Error("conexão fechada antes de completar a resposta"));
        }
      });
    });
  }

  _onData(chunk) {
    this.buffer += chunk.toString("utf8");
    if (!this.pending) return;
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const headerPart = this.buffer.slice(0, headerEnd);
    const contentLengthMatch = /^Content-Length:\s*(\d+)/im.exec(headerPart);
    const contentLength = contentLengthMatch ? Number(contentLengthMatch[1]) : 0;
    const bodyStart = headerEnd + 4;
    if (this.buffer.length - bodyStart < contentLength) return;
    const full = this.buffer.slice(0, bodyStart + contentLength);
    this.buffer = this.buffer.slice(bodyStart + contentLength);
    const { resolve, timer } = this.pending;
    this.pending = null;
    clearTimeout(timer);
    resolve(full);
  }

  send(requestLines, { timeoutMs = 6000 } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`timeout após ${timeoutMs}ms sem resposta completa`));
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
      this.socket.write(requestLines.join("\r\n") + "\r\n\r\n");
    });
  }

  close() {
    this.socket?.destroy();
  }
}

async function runOnSameConnection(label, buildSteps) {
  section(label);
  const session = new RtspSession(host, port);
  try {
    await session.connect();
  } catch (err) {
    console.log(`Falha ao conectar: ${err.message}`);
    return;
  }
  let cseq = 1;
  let lastResponse = null;
  for (const step of buildSteps) {
    const lines = step(cseq, lastResponse);
    if (!lines) break;
    console.log(`\n--- Requisição (CSeq ${cseq}) ---`);
    console.log(lines.join("\r\n"));
    try {
      lastResponse = await session.send(lines);
      console.log("--- Resposta ---");
      console.log(lastResponse);
    } catch (err) {
      console.log(`FALHOU: ${err.message}`);
      lastResponse = null;
      break;
    }
    cseq += 1;
  }
  session.close();
  return lastResponse;
}

async function main() {
  const uri = `rtsp://${host}:${port}${rtspPath}`;
  const uriWithCreds = `rtsp://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}${rtspPath}`;

  // Todo o handshake (OPTIONS -> DESCRIBE sem auth -> DESCRIBE com Digest)
  // acontece na MESMA conexão TCP - é assim que VLC/live555 e o MediaMTX
  // fazem. Muitas câmeras baratas (stacks HiSilicon mínimas) só validam o
  // nonce corretamente se a tentativa autenticada vier na mesma conexão.
  await runOnSameConnection("1) Handshake completo numa ÚNICA conexão TCP (igual VLC/MediaMTX)", [
    (cseq) => [`OPTIONS ${uri} RTSP/1.0`, `CSeq: ${cseq}`, "User-Agent: ipcam-diag/1.0"],
    (cseq) => [`DESCRIBE ${uri} RTSP/1.0`, `CSeq: ${cseq}`, "Accept: application/sdp", "User-Agent: ipcam-diag/1.0"],
    (cseq, lastResponse) => {
      const statusCode = parseStatusCode(lastResponse);
      if (statusCode !== 401) {
        console.log(`\n(Resposta anterior não foi 401 Unauthorized - código: ${statusCode ?? "?"} - pulando etapa de auth)`);
        return null;
      }
      const wwwAuth = parseHeader(lastResponse, "WWW-Authenticate");
      const authHeader = wwwAuth?.toLowerCase().startsWith("digest")
        ? buildDigestAuthHeader({ method: "DESCRIBE", uri, wwwAuthenticate: wwwAuth })
        : buildBasicAuthHeader();
      return [
        `DESCRIBE ${uri} RTSP/1.0`,
        `CSeq: ${cseq}`,
        "Accept: application/sdp",
        "User-Agent: ipcam-diag/1.0",
        `Authorization: ${authHeader}`,
      ];
    },
  ]);

  // Para comparação: a mesma tentativa autenticada, mas trocando de conexão
  // TCP entre o desafio 401 e a resposta com Authorization (era o que o
  // script fazia antes - deixado aqui só para evidenciar a diferença).
  section("2) (Comparação) Desafio 401 e resposta autenticada em conexões TCP DIFERENTES");
  const s1 = new RtspSession(host, port);
  await s1.connect();
  const challenge = await s1.send([`DESCRIBE ${uri} RTSP/1.0`, "CSeq: 2", "Accept: application/sdp", "User-Agent: ipcam-diag/1.0"]);
  s1.close();
  console.log("Desafio recebido (conexão A):");
  console.log(challenge);
  const wwwAuth2 = parseHeader(challenge, "WWW-Authenticate");
  if (wwwAuth2) {
    const authHeader = buildDigestAuthHeader({ method: "DESCRIBE", uri, wwwAuthenticate: wwwAuth2 });
    const s2 = new RtspSession(host, port);
    await s2.connect();
    const retryResp = await s2.send([
      `DESCRIBE ${uri} RTSP/1.0`,
      "CSeq: 2",
      "Accept: application/sdp",
      "User-Agent: ipcam-diag/1.0",
      `Authorization: ${authHeader}`,
    ]);
    s2.close();
    console.log("\nResposta autenticada (conexão B, diferente da A):");
    console.log(retryResp);
  }

  // 3) Testa a hipótese de whitelist por User-Agent: será que a câmera só
  // libera acesso sem autenticação para clientes que "parecem" VLC/ffmpeg?
  // (O usuário relatou que o VLC tocou o mesmo stream SEM pedir senha,
  // enquanto nosso client com User-Agent "ipcam-diag/1.0" recebeu 401.)
  section("3) DESCRIBE sem auth, variando o header User-Agent");
  const userAgentsToTest = [
    "ipcam-diag/1.0",
    "LibVLC/3.0.20 (LIVE555 Streaming Media v2016.11.28)",
    "Lavf/60.16.100",
    null, // sem header User-Agent nenhum
  ];
  for (const ua of userAgentsToTest) {
    const session = new RtspSession(host, port);
    await session.connect();
    const lines = [`DESCRIBE ${uri} RTSP/1.0`, "CSeq: 1", "Accept: application/sdp"];
    if (ua) lines.splice(2, 0, `User-Agent: ${ua}`);
    console.log(`\n--- User-Agent: ${ua ?? "(nenhum)"} ---`);
    try {
      const resp = await session.send(lines);
      console.log(`Status: ${parseStatusCode(resp)}`);
      console.log(resp);
    } catch (err) {
      console.log(`FALHOU: ${err.message}`);
    }
    session.close();
  }

  // 4) Igual à seção 1 (mesma conexão), mas com as credenciais embutidas na
  // URI/Request-Line em TODAS as requisições - exatamente como o MediaMTX
  // envia (nosso backend monta `source: rtsp://user:senha@host:porta/path`).
  // Testa se é o "user:pass@" na linha de requisição, e não a autenticação
  // em si, que essa câmera rejeita com 400.
  await runOnSameConnection("4) Handshake numa ÚNICA conexão, com credenciais NA URI (como o MediaMTX manda)", [
    (cseq) => [`OPTIONS ${uriWithCreds} RTSP/1.0`, `CSeq: ${cseq}`, "User-Agent: ipcam-diag/1.0"],
    (cseq) => [`DESCRIBE ${uriWithCreds} RTSP/1.0`, `CSeq: ${cseq}`, "Accept: application/sdp", "User-Agent: ipcam-diag/1.0"],
    (cseq, lastResponse) => {
      const statusCode = parseStatusCode(lastResponse);
      if (statusCode !== 401) {
        console.log(`\n(Resposta anterior não foi 401 Unauthorized - código: ${statusCode ?? "?"} - pulando etapa de auth)`);
        return null;
      }
      const wwwAuth = parseHeader(lastResponse, "WWW-Authenticate");
      // Nota: o campo "uri=" do Authorization deve bater com a URI usada na
      // linha de requisição - aqui usamos a versão COM credenciais também,
      // pra replicar fielmente o que o MediaMTX faria.
      const authHeader = wwwAuth?.toLowerCase().startsWith("digest")
        ? buildDigestAuthHeader({ method: "DESCRIBE", uri: uriWithCreds, wwwAuthenticate: wwwAuth })
        : buildBasicAuthHeader();
      return [
        `DESCRIBE ${uriWithCreds} RTSP/1.0`,
        `CSeq: ${cseq}`,
        "Accept: application/sdp",
        "User-Agent: ipcam-diag/1.0",
        `Authorization: ${authHeader}`,
      ];
    },
  ]);

  console.log("\nCompartilhe a saída completa acima para diagnóstico.");
}

main().catch((err) => {
  console.error("Erro inesperado:", err);
  process.exit(1);
});
