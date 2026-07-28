import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";

export interface RawSoapAttempt {
  label: string;
  ok: boolean;
  statusCode?: number;
  bodyPreview?: string;
  error?: string;
}

/**
 * Builds a WS-Security UsernameToken header (PasswordDigest), in the same
 * format the `onvif` package uses for its authenticated calls (see
 * `Cam.prototype._envelopeHeader` / `_passwordDigest` in
 * node_modules/onvif/lib/cam.js). Used here to test whether a camera that
 * resets the connection on unauthenticated requests behaves differently
 * once credentials are included.
 */
function buildWsSecurityHeader(username: string, password: string): string {
  const nonce = crypto.randomBytes(16);
  const created = new Date().toISOString();
  const digest = crypto
    .createHash("sha1")
    .update(Buffer.concat([nonce, Buffer.from(created, "ascii"), Buffer.from(password, "ascii")]))
    .digest("base64");

  return (
    '<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">' +
    "<UsernameToken>" +
    `<Username>${username}</Username>` +
    '<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">' +
    `${digest}</Password>` +
    '<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">' +
    `${nonce.toString("base64")}</Nonce>` +
    '<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">' +
    `${created}</Created>` +
    "</UsernameToken>" +
    "</Security>"
  );
}

function rawSoapRequest(options: {
  host: string;
  port: number;
  path: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
}): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: options.host,
        port: options.port,
        path: options.path,
        method: "POST",
        headers: {
          ...options.headers,
          "Content-Length": Buffer.byteLength(options.body, "utf8"),
        },
        timeout: options.timeoutMs ?? 8000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("Network timeout"));
    });
    req.on("error", reject);
    req.write(options.body);
    req.end();
  });
}

/**
 * Sends the HTTP request as a single raw TCP write (status line + headers +
 * blank line + body all concatenated into one buffer), instead of using
 * Node's `http.request` (which may flush headers and body as separate
 * writes/packets). Some bare-bones embedded HTTP servers found in cheap
 * ONVIF cameras only parse correctly when the full request arrives in one
 * read() on their end - this tests that specific hypothesis.
 */
function rawSocketRequest(options: {
  host: string;
  port: number;
  path: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
}): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const bodyBuffer = Buffer.from(options.body, "utf8");
    const headerLines = Object.entries({
      Host: `${options.host}:${options.port}`,
      ...options.headers,
      "Content-Length": String(bodyBuffer.length),
      Connection: "close",
    }).map(([key, value]) => `${key}: ${value}`);

    const requestText =
      `POST ${options.path} HTTP/1.1\r\n` + headerLines.join("\r\n") + "\r\n\r\n" + options.body;

    const socket = new net.Socket();
    const timeoutMs = options.timeoutMs ?? 8000;
    let settled = false;
    const chunks: Buffer[] = [];

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finish(() => reject(new Error("Network timeout"))));
    socket.once("error", (err) => finish(() => reject(err)));
    socket.once("connect", () => {
      // Single write() call: the whole request goes out as one TCP send()
      // (still may be split into multiple packets by the OS/network if it
      // exceeds the MSS, but this avoids Node's http client's own internal
      // buffering/flushing behavior).
      socket.write(requestText);
    });
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => {
      finish(() => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const [head, ...rest] = raw.split("\r\n\r\n");
        const statusMatch = head.match(/^HTTP\/\d\.\d (\d+)/);
        resolve({
          statusCode: statusMatch ? Number(statusMatch[1]) : undefined,
          body: rest.join("\r\n\r\n"),
        });
      });
    });
    socket.connect(options.port, options.host);
  });
}

const GET_SYSTEM_DATE_AND_TIME_BODY_INNER =
  '<GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/>';
const ACTION = "http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime";

/**
 * Sends the same unauthenticated ONVIF call (GetSystemDateAndTime, which
 * requires no WS-Security) using both SOAP 1.1 and SOAP 1.2 wire formats,
 * bypassing the `onvif` npm package entirely (it only ever sends SOAP 1.2).
 * This isolates whether a camera's ECONNRESET/"socket hang up" is really a
 * SOAP-version incompatibility, without touching any of the library/app
 * code paths used for real camera operations.
 */
export async function diagnoseSoapCompatibility(
  host: string,
  port: number,
  path: string,
  credentials?: { username: string; password: string }
): Promise<RawSoapAttempt[]> {
  const attempts: Array<{ label: string; headers: Record<string, string>; body: string }> = [
    {
      label: "SOAP 1.2 (application/soap+xml, o que o pacote 'onvif' usa hoje)",
      headers: {
        "Content-Type": `application/soap+xml;charset=utf-8;action="${ACTION}"`,
      },
      body:
        '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">' +
        `<s:Body>${GET_SYSTEM_DATE_AND_TIME_BODY_INNER}</s:Body>` +
        "</s:Envelope>",
    },
    {
      label: "SOAP 1.1 (text/xml + SOAPAction, formato usado por Agent DVR/iSpy)",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${ACTION}"`,
      },
      body:
        '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">' +
        `<SOAP-ENV:Body>${GET_SYSTEM_DATE_AND_TIME_BODY_INNER}</SOAP-ENV:Body>` +
        "</SOAP-ENV:Envelope>",
    },
  ];

  const results: RawSoapAttempt[] = [];
  for (const attempt of attempts) {
    try {
      const { statusCode, body } = await rawSoapRequest({
        host,
        port,
        path,
        headers: attempt.headers,
        body: attempt.body,
      });
      const looksLikeSuccess =
        statusCode !== undefined && statusCode < 400 && /GetSystemDateAndTimeResponse/i.test(body);
      results.push({
        label: attempt.label,
        ok: looksLikeSuccess,
        statusCode,
        bodyPreview: body.slice(0, 300),
      });
    } catch (err) {
      results.push({
        label: attempt.label,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Third attempt: same SOAP 1.1 request as above, but written to the raw
  // TCP socket as a single buffer instead of through Node's http.request
  // (which may flush headers/body as separate writes). Some bare-bones
  // embedded HTTP servers in cheap cameras only parse correctly when the
  // whole request arrives in a single read() on their end.
  const soap11 = attempts[1];
  try {
    const { statusCode, body } = await rawSocketRequest({
      host,
      port,
      path,
      headers: soap11.headers,
      body: soap11.body,
    });
    const looksLikeSuccess =
      statusCode !== undefined && statusCode < 400 && /GetSystemDateAndTimeResponse/i.test(body);
    results.push({
      label: "SOAP 1.1 via socket TCP bruto (1 único write, contorna o cliente http do Node)",
      ok: looksLikeSuccess,
      statusCode,
      bodyPreview: body.slice(0, 300),
    });
  } catch (err) {
    results.push({
      label: "SOAP 1.1 via socket TCP bruto (1 único write, contorna o cliente http do Node)",
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Fourth attempt (only if credentials were provided): the `onvif` package
  // always sends its very first call (GetSystemDateAndTime, used to sync
  // clocks before anything else) WITHOUT any authentication, per the ONVIF
  // spec's suggestion that it doesn't require it. Some non-compliant cheap
  // cameras reset the connection on ANY unauthenticated request, regardless
  // of SOAP version - which would explain all 3 failures above regardless
  // of wire format. This tests that theory directly by adding WS-Security
  // to the exact same call.
  if (credentials) {
    const securityHeader = buildWsSecurityHeader(credentials.username, credentials.password);
    const body =
      '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">' +
      `<s:Header>${securityHeader}</s:Header>` +
      `<s:Body>${GET_SYSTEM_DATE_AND_TIME_BODY_INNER}</s:Body>` +
      "</s:Envelope>";
    const label = "SOAP 1.2 + WS-Security (autenticado, como as chamadas reais da lib 'onvif')";
    try {
      const { statusCode, body: respBody } = await rawSoapRequest({
        host,
        port,
        path,
        headers: { "Content-Type": `application/soap+xml;charset=utf-8;action="${ACTION}"` },
        body,
      });
      const looksLikeSuccess =
        statusCode !== undefined && statusCode < 400 && /GetSystemDateAndTimeResponse/i.test(respBody);
      results.push({
        label,
        ok: looksLikeSuccess,
        statusCode,
        bodyPreview: respBody.slice(0, 300),
      });
    } catch (err) {
      results.push({
        label,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
