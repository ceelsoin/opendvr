import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PtzControls } from "./PtzControls";
import { useToastStore } from "../../store/toastStore";

const moveMutate = vi.fn();
const stopMutate = vi.fn();
const gotoPresetMutate = vi.fn();
const savePresetMutate = vi.fn();
let presetsData: Array<{ token: string; name?: string }> = [];

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../api/ptz", () => ({
  usePtzMove: () => ({ mutate: moveMutate }),
  usePtzStop: () => ({ mutate: stopMutate }),
  usePtzPresets: () => ({ data: presetsData }),
  usePtzGotoPreset: () => ({ mutate: gotoPresetMutate }),
  usePtzSavePreset: () => ({ mutate: savePresetMutate }),
}));

/** Simulates the mutation settling (as react-query would after the request resolves), invoking whichever options were passed to the last `mutate()` call. */
function settleLastCall(mockFn: ReturnType<typeof vi.fn>, kind: "onSettled" | "onError" = "onSettled", arg?: unknown) {
  const lastCall = mockFn.mock.calls[mockFn.mock.calls.length - 1];
  const options = lastCall[lastCall.length - 1];
  options?.[kind]?.(arg);
}

describe("PtzControls", () => {
  beforeEach(() => {
    moveMutate.mockClear();
    stopMutate.mockClear();
    gotoPresetMutate.mockClear();
    savePresetMutate.mockClear();
    presetsData = [];
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends a move command immediately when a direction button is pressed", () => {
    render(<PtzControls cameraId="cam-1" />);
    fireEvent.mouseDown(screen.getByText("↑"));
    expect(moveMutate).toHaveBeenCalledTimes(1);
    expect(moveMutate).toHaveBeenCalledWith({ direction: "up" }, expect.any(Object));
  });

  it("does not send a second move while the first one is still in flight", () => {
    render(<PtzControls cameraId="cam-1" />);
    const upButton = screen.getByText("↑");
    fireEvent.mouseDown(upButton);
    expect(moveMutate).toHaveBeenCalledTimes(1);

    // Pressing again before the first request settles must be ignored.
    fireEvent.mouseDown(upButton);
    expect(moveMutate).toHaveBeenCalledTimes(1);
  });

  it("keeps resending the move command every HOLD_REPEAT_MS while the button is held down", () => {
    vi.useFakeTimers();
    render(<PtzControls cameraId="cam-1" />);
    const upButton = screen.getByText("↑");

    fireEvent.mouseDown(upButton);
    expect(moveMutate).toHaveBeenCalledTimes(1);
    settleLastCall(moveMutate);

    vi.advanceTimersByTime(500);
    expect(moveMutate).toHaveBeenCalledTimes(2);
    settleLastCall(moveMutate);

    vi.advanceTimersByTime(500);
    expect(moveMutate).toHaveBeenCalledTimes(3);
  });

  it("stops the hold-repeat interval and sends a stop command on release", () => {
    vi.useFakeTimers();
    render(<PtzControls cameraId="cam-1" />);
    const upButton = screen.getByText("↑");

    fireEvent.mouseDown(upButton);
    settleLastCall(moveMutate);
    fireEvent.mouseUp(upButton);

    expect(stopMutate).toHaveBeenCalledTimes(1);

    // No further move calls should happen after release, even as time passes.
    const callsBeforeWaiting = moveMutate.mock.calls.length;
    vi.advanceTimersByTime(2000);
    expect(moveMutate).toHaveBeenCalledTimes(callsBeforeWaiting);
  });

  it("also stops on mouse leave (dragging the cursor off the button while held)", () => {
    render(<PtzControls cameraId="cam-1" />);
    const upButton = screen.getByText("↑");
    fireEvent.mouseDown(upButton);
    fireEvent.mouseLeave(upButton);
    expect(stopMutate).toHaveBeenCalledTimes(1);
  });

  it("the dedicated stop button also triggers a stop", () => {
    render(<PtzControls cameraId="cam-1" />);
    fireEvent.click(screen.getByText("stop"));
    expect(stopMutate).toHaveBeenCalledTimes(1);
  });

  it("shows an error toast when a move request fails", () => {
    render(<PtzControls cameraId="cam-1" />);
    fireEvent.mouseDown(screen.getByText("↑"));
    settleLastCall(moveMutate, "onError", new Error("boom"));

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].variant).toBe("error");
  });

  it("renders a button per saved preset and triggers gotoPreset with its token", () => {
    presetsData = [{ token: "p1", name: "Garagem" }, { token: "p2" }];
    render(<PtzControls cameraId="cam-1" />);

    fireEvent.click(screen.getByText("Garagem"));
    expect(gotoPresetMutate).toHaveBeenCalledWith("p1", expect.any(Object));

    fireEvent.click(screen.getByText("p2"));
    expect(gotoPresetMutate).toHaveBeenCalledWith("p2", expect.any(Object));
  });

  it("saves a new preset with the name entered in the prompt", () => {
    vi.spyOn(window, "prompt").mockReturnValue("Nova posição");
    render(<PtzControls cameraId="cam-1" />);

    fireEvent.click(screen.getByText("ptz.savePresetButton"));
    expect(savePresetMutate).toHaveBeenCalledWith("Nova posição", expect.any(Object));
  });

  it("does not save a preset when the prompt is cancelled", () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    render(<PtzControls cameraId="cam-1" />);

    fireEvent.click(screen.getByText("ptz.savePresetButton"));
    expect(savePresetMutate).not.toHaveBeenCalled();
  });
});
