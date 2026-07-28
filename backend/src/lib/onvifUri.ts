export interface ParsedOnvifUri {
  host: string;
  port: number;
  onvifPath: string;
  username: string;
  password: string;
}

/**
 * Parses a full ONVIF service URI (as used by Agent DVR/iSpy) such as
 * `http://admin:secret@192.168.88.35:5000/onvif` into its parts.
 * Falls back to the standard ONVIF service path when the URL has none.
 */
export function parseOnvifUri(input: string): ParsedOnvifUri {
  const url = new URL(input);
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const onvifPath = url.pathname && url.pathname !== "/" ? url.pathname : "/onvif/device_service";

  return {
    host: url.hostname,
    port,
    onvifPath,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}
