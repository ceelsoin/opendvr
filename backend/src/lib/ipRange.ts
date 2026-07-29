const MAX_HOSTS = 512;

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`IP inválido: ${ip}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function isValidIp(ip: string): boolean {
  try {
    ipToInt(ip);
    return true;
  } catch {
    return false;
  }
}

function parseCidr(input: string): string[] {
  const [base, prefixStr] = input.split("/");
  const prefix = Number(prefixStr);
  if (!isValidIp(base) || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Faixa CIDR inválida: ${input}`);
  }
  const baseInt = ipToInt(base);
  const hostBits = 32 - prefix;
  const count = 2 ** hostBits;
  if (count > MAX_HOSTS + 2) {
    throw new Error(`Faixa muito grande (${count} endereços) - use uma faixa de no máximo ${MAX_HOSTS} hosts.`);
  }
  const networkInt = hostBits >= 32 ? 0 : baseInt & (0xffffffff << hostBits);
  const ips: string[] = [];
  // Skip network (.0) and broadcast (.255) addresses for normal subnets,
  // matching the usual "usable host" convention - not meaningful for /31//32.
  const start = hostBits >= 1 ? 1 : 0;
  const end = hostBits >= 1 ? count - 2 : count - 1;
  for (let i = start; i <= end; i++) {
    ips.push(intToIp(networkInt + i));
  }
  return ips;
}

function parseDashRange(input: string): string[] {
  const [startPart, endPart] = input.split("-").map((s) => s.trim());
  if (!startPart || !endPart) {
    throw new Error(`Faixa inválida: ${input}`);
  }

  let startIp: string;
  let endIp: string;
  if (endPart.includes(".")) {
    // "192.168.1.1-192.168.1.50"
    startIp = startPart;
    endIp = endPart;
  } else {
    // "192.168.1.1-50" - endPart is just the last octet, sharing the first 3 with startPart.
    const segments = startPart.split(".");
    if (segments.length !== 4) {
      throw new Error(`Faixa inválida: ${input}`);
    }
    startIp = startPart;
    endIp = `${segments[0]}.${segments[1]}.${segments[2]}.${endPart}`;
  }

  const startInt = ipToInt(startIp);
  const endInt = ipToInt(endIp);
  if (endInt < startInt) {
    throw new Error(`Faixa inválida: início maior que o fim (${input}).`);
  }
  const count = endInt - startInt + 1;
  if (count > MAX_HOSTS) {
    throw new Error(`Faixa muito grande (${count} endereços) - use uma faixa de no máximo ${MAX_HOSTS} hosts.`);
  }
  const ips: string[] = [];
  for (let i = startInt; i <= endInt; i++) {
    ips.push(intToIp(i));
  }
  return ips;
}

/**
 * Parses an IPv4 range for the network scan feature. Accepts:
 * - CIDR: "192.168.1.0/24"
 * - Full dash range: "192.168.1.1-192.168.1.50"
 * - Last-octet shorthand: "192.168.1.1-50"
 * - A single address: "192.168.1.10"
 * Caps the result at `MAX_HOSTS` addresses so a typo (e.g. a /8) can't kick
 * off a scan that would take forever / hammer the network.
 */
export function parseIpRange(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Informe uma faixa de IP (ex: 192.168.1.0/24 ou 192.168.1.1-254).");
  }
  if (trimmed.includes("/")) {
    return parseCidr(trimmed);
  }
  if (trimmed.includes("-")) {
    return parseDashRange(trimmed);
  }
  if (!isValidIp(trimmed)) {
    throw new Error(`IP inválido: ${trimmed}`);
  }
  return [trimmed];
}
