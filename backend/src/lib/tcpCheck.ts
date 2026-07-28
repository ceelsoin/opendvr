import net from "node:net";

/**
 * Quick raw-TCP reachability check, used to distinguish "the network path to
 * this host:port doesn't work at all" from "TCP connects fine but the ONVIF
 * SOAP exchange itself fails" (protocol-level issue), since both surface as
 * different kinds of errors from the ONVIF library and warrant different
 * troubleshooting.
 */
export function isTcpPortReachable(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}
