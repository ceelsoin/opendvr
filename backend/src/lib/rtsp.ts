/**
 * Embeds credentials into an RTSP URL's userinfo component
 * (rtsp://user:pass@host:port/path), which is how MediaMTX authenticates
 * against upstream cameras when pulling their stream as a source.
 */
export function withRtspCredentials(uri: string, username: string, password: string): string {
  const url = new URL(uri);
  url.username = username;
  url.password = password;
  return url.toString();
}
