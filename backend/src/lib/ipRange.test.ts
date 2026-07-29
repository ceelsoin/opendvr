import { describe, it, expect } from "vitest";
import { parseIpRange } from "./ipRange.js";

describe("parseIpRange", () => {
  it("parses a single IP address", () => {
    expect(parseIpRange("192.168.1.10")).toEqual(["192.168.1.10"]);
  });

  it("parses a full dash range across two complete addresses", () => {
    const result = parseIpRange("192.168.1.1-192.168.1.5");
    expect(result).toEqual(["192.168.1.1", "192.168.1.2", "192.168.1.3", "192.168.1.4", "192.168.1.5"]);
  });

  it("parses the last-octet shorthand dash range", () => {
    const result = parseIpRange("192.168.1.250-253");
    expect(result).toEqual(["192.168.1.250", "192.168.1.251", "192.168.1.252", "192.168.1.253"]);
  });

  it("parses a /24 CIDR block, excluding network and broadcast addresses", () => {
    const result = parseIpRange("192.168.1.0/30");
    // /30 = 4 addresses (.0 network, .1-.2 usable, .3 broadcast)
    expect(result).toEqual(["192.168.1.1", "192.168.1.2"]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseIpRange("  192.168.1.10  ")).toEqual(["192.168.1.10"]);
  });

  it("throws on empty input", () => {
    expect(() => parseIpRange("")).toThrow(/Informe uma faixa/);
    expect(() => parseIpRange("   ")).toThrow(/Informe uma faixa/);
  });

  it("throws on an invalid single IP", () => {
    expect(() => parseIpRange("999.1.1.1")).toThrow(/IP inválido/);
    expect(() => parseIpRange("not.an.ip.address")).toThrow(/IP inválido/);
  });

  it("throws when the dash range end is before the start", () => {
    expect(() => parseIpRange("192.168.1.50-192.168.1.10")).toThrow(/início maior que o fim/);
  });

  it("throws when a CIDR block would exceed MAX_HOSTS (512)", () => {
    expect(() => parseIpRange("10.0.0.0/8")).toThrow(/muito grande/);
  });

  it("throws when a dash range would exceed MAX_HOSTS (512)", () => {
    expect(() => parseIpRange("10.0.0.0-10.0.10.0")).toThrow(/muito grande/);
  });

  it("throws on a malformed CIDR (bad prefix)", () => {
    expect(() => parseIpRange("192.168.1.0/33")).toThrow(/Faixa CIDR inválida/);
  });
});
