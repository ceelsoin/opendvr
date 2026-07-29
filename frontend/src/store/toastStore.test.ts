import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useToastStore } from "./toastStore";

describe("useToastStore", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with an empty toast list", () => {
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("adds a toast with the given variant and message", () => {
    useToastStore.getState().addToast("success", "Câmera salva com sucesso");
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ variant: "success", message: "Câmera salva com sucesso" });
    expect(toasts[0].id).toBeTruthy();
  });

  it("assigns a unique id to each toast, even added in the same tick", () => {
    useToastStore.getState().addToast("error", "first");
    useToastStore.getState().addToast("error", "second");
    const ids = useToastStore.getState().toasts.map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("removeToast removes only the matching toast", () => {
    useToastStore.getState().addToast("info", "one");
    useToastStore.getState().addToast("info", "two");
    const [first, second] = useToastStore.getState().toasts;

    useToastStore.getState().removeToast(first.id);

    const remaining = useToastStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(second.id);
  });

  it("auto-dismisses a toast after 5 seconds", () => {
    vi.useFakeTimers();
    useToastStore.getState().addToast("success", "temporary");
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(4999);
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
