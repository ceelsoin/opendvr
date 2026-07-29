import { describe, it, expect } from "vitest";
import { extractErrorMessage } from "./apiError";

function fakeAxiosError(data: unknown) {
  return { isAxiosError: true, response: { data } };
}

describe("extractErrorMessage", () => {
  it("returns the fallback for a non-axios error (e.g. a network failure)", () => {
    expect(extractErrorMessage(new Error("Network Error"), "Falha ao mover a câmera")).toBe("Falha ao mover a câmera");
  });

  it("returns the fallback when the axios error has no response body", () => {
    const err = { isAxiosError: true, response: undefined };
    expect(extractErrorMessage(err, "fallback")).toBe("fallback");
  });

  it("uses the server's `error` message when present", () => {
    const err = fakeAxiosError({ error: "Câmera não encontrada" });
    expect(extractErrorMessage(err, "fallback")).toBe("Câmera não encontrada");
  });

  it("appends `details` in parentheses when present", () => {
    const err = fakeAxiosError({ error: "Falha ao mover PTZ", details: "socket hang up" });
    expect(extractErrorMessage(err, "fallback")).toBe("Falha ao mover PTZ (socket hang up)");
  });

  it("falls back to the given fallback message when the server sent no `error` field", () => {
    const err = fakeAxiosError({ details: "some low-level detail" });
    expect(extractErrorMessage(err, "fallback message")).toBe("fallback message (some low-level detail)");
  });

  it("does not append details when it's an empty string", () => {
    const err = fakeAxiosError({ error: "Falhou", details: "" });
    expect(extractErrorMessage(err, "fallback")).toBe("Falhou");
  });
});
