import { randomBytes, createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { parseStringPromise } from "xml2js";

/**
 * Manual ONVIF Events (WS-BaseNotification PullPoint) client built directly
 * on top of `node-onvif`'s already-connected device (see onvif/device.ts),
 * instead of the legacy `onvif` (agsh) package.
 *
 * Why: the legacy package's `Cam.connect()` always starts with an
 * *unauthenticated* GetSystemDateAndTime call (see its lib/cam.js), which
 * several cheap/OEM cameras reset the TCP connection on - the exact same
 * incompatibility that motivated migrating device/media/PTZ to `node-onvif`
 * (see device.ts's docstring). `node-onvif` never makes that unauthenticated
 * call and already connects fine to these cameras; it just doesn't
 * implement PullPoint subscriptions itself (only `getEventProperties`). This
 * module fills that gap with raw SOAP requests, reusing the connection
 * info (`xaddr`/credentials/clock offset) `node-onvif` already resolved.
 */

export interface OnvifEventsService {
  xaddr: string;
  user: string;
  pass: string;
  /** Device clock minus local clock, in ms (computed by node-onvif from GetSystemDateAndTime). Used for WS-Security digest timestamps. */
  time_diff?: number;
}

export interface OnvifNotification {
  topic: string;
  message: unknown;
}

const XML_PARSE_OPTIONS = {
  explicitRoot: false,
  explicitArray: false,
  ignoreAttrs: false,
  tagNameProcessors: [(name: string) => name.replace(/^.*:/, "")],
};

function createSoapUserToken(user: string, pass: string, diffMs: number): string {
  const date = new Date(Date.now() + diffMs).toISOString();
  const nonce = randomBytes(16);
  const digest = createHash("sha1")
    .update(Buffer.concat([nonce, Buffer.from(date), Buffer.from(pass)]))
    .digest("base64");
  return (
    '<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">' +
    "<UsernameToken>" +
    `<Username>${user}</Username>` +
    '<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">' +
    `${digest}</Password>` +
    '<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">' +
    `${nonce.toString("base64")}</Nonce>` +
    `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${date}</Created>` +
    "</UsernameToken>" +
    "</Security>"
  );
}

function buildEnvelope(body: string, service: OnvifEventsService): string {
  const header = service.user ? createSoapUserToken(service.user, service.pass, service.time_diff ?? 0) : "";
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" ' +
    'xmlns:wsa="http://www.w3.org/2005/08/addressing" ' +
    'xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2" ' +
    'xmlns:tev="http://www.onvif.org/ver10/events/wsdl">' +
    `<s:Header>${header}</s:Header>` +
    `<s:Body>${body}</s:Body>` +
    "</s:Envelope>";
  return xml.replace(/>\s+</g, "><");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function soapRequest(url: string, body: string, service: OnvifEventsService): Promise<any> {
  const envelope = buildEnvelope(body, service);
  const res = await httpPost(url, envelope);
  const parsed = await parseStringPromise(res.body, XML_PARSE_OPTIONS).catch(() => null);

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const fault = parsed?.Body?.Fault?.Reason?.Text;
    const faultText = typeof fault === "string" ? fault : (fault?._ ?? null);
    throw new Error(faultText ?? `ONVIF Events SOAP request failed: ${res.statusCode} ${res.statusText}`);
  }
  if (!parsed) {
    throw new Error("Failed to parse ONVIF Events SOAP response");
  }
  return parsed;
}

interface HttpPostResult {
  statusCode: number;
  statusText: string;
  body: string;
}

/**
 * Plain `node:http`/`node:https` POST (mirroring exactly what node-onvif's
 * own soap.js does internally - raw socket, explicit Content-Length, no
 * chunked encoding), instead of the global `fetch` (undici): some cheap/OEM
 * camera HTTP servers close the connection on undici's request (confirmed
 * empirically - "other side closed" - even though the same request over a
 * plain http.request succeeds), so matching node-onvif's proven-compatible
 * transport here avoids reintroducing a different flavor of the same class
 * of interoperability bug this module exists to fix.
 */
function httpPost(url: string, body: string): Promise<HttpPostResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;

    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8;",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 20000,
      },
      (res) => {
        res.setEncoding("utf8");
        let xml = "";
        res.on("data", (chunk: string) => {
          xml += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, statusText: res.statusMessage ?? "", body: xml });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("ONVIF Events request timed out"));
    });
    req.on("error", (err) => reject(err));
    req.end(body);
  });
}

/** Extracts either a plain string node or a `{_, $}` (has-attributes) node's text value. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textOf(node: any): string | undefined {
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && typeof node._ === "string") return node._;
  return undefined;
}

/** Creates a PullPoint subscription and returns the URL to send PullMessages/Unsubscribe requests to. */
export async function createPullPointSubscription(service: OnvifEventsService): Promise<string> {
  const body =
    "<tev:CreatePullPointSubscription>" +
    "<tev:InitialTerminationTime>PT5M</tev:InitialTerminationTime>" +
    "</tev:CreatePullPointSubscription>";
  const result = await soapRequest(service.xaddr, body, service);
  const address = result?.Body?.CreatePullPointSubscriptionResponse?.SubscriptionReference?.Address;
  // Some cameras return a SubscriptionReference pointing at an internal/unreachable
  // address (e.g. a private IP behind NAT, or a malformed URL) - falling back to the
  // original Events xaddr (which we know is reachable, since we just used it) is the
  // pragmatic/common workaround other ONVIF clients use for this.
  return textOf(address) || service.xaddr;
}

/** Long-polls for new notifications; resolves (possibly with an empty array) after up to `timeoutSeconds`. */
export async function pullMessages(
  subscriptionUrl: string,
  service: OnvifEventsService,
  timeoutSeconds = 30,
  messageLimit = 50
): Promise<OnvifNotification[]> {
  const body =
    "<tev:PullMessages>" +
    `<tev:Timeout>PT${timeoutSeconds}S</tev:Timeout>` +
    `<tev:MessageLimit>${messageLimit}</tev:MessageLimit>` +
    "</tev:PullMessages>";
  const result = await soapRequest(subscriptionUrl, body, service);
  const response = result?.Body?.PullMessagesResponse;
  if (!response?.NotificationMessage) {
    return [];
  }
  const messages = Array.isArray(response.NotificationMessage)
    ? response.NotificationMessage
    : [response.NotificationMessage];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return messages.map((msg: any) => ({
    topic: textOf(msg?.Topic) ?? "unknown",
    message: msg?.Message,
  }));
}

/** Best-effort: tells the camera we're done, so it can free the subscription early. Never throws. */
export async function unsubscribe(subscriptionUrl: string, service: OnvifEventsService): Promise<void> {
  try {
    await soapRequest(subscriptionUrl, "<wsnt:Unsubscribe/>", service);
  } catch {
    // Best-effort only - the subscription will expire on its own otherwise.
  }
}
