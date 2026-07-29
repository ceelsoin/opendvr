import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PtzJoystick } from "./PtzJoystick";
import { useToastStore } from "../../store/toastStore";

const moveVectorMutate = vi.fn();
const stopMutate = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../api/ptz", () => ({
  usePtzMoveVector: () => ({ mutate: moveVectorMutate }),
  usePtzStop: () => ({ mutate: stopMutate }),
}));

function settleLastCall(mockFn: ReturnType<typeof vi.fn>, kind: "onSettled" | "onError" = "onSettled", arg?: unknown) {
  const lastCall = mockFn.mock.calls[mockFn.mock.calls.length - 1];
  const options = lastCall[lastCall.length - 1];
  options?.[kind]?.(arg);
}

function getBase(): HTMLElement {
  // The draggable track is the only element listening for pointer events;
  // it has no accessible role/text, so grab it via the pointerdown handler
  // it's known to carry (identified by traversing from the visible hint text).
  const hint = screen.getByText("ptz.dragToMove");
  return hint.previousElementSibling as HTMLElement;
}

describe("PtzJoystick", () => {
  beforeEach(() => {
    moveVectorMutate.mockClear();
    stopMutate.mockClear();
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends a pan/tilt vector on pointer down", () => {
    render(<PtzJoystick cameraId="cam-1" />);
    fireEvent.pointerDown(getBase(), { clientX: 20, clientY: 0, pointerId: 1 });

    expect(moveVectorMutate).toHaveBeenCalledTimes(1);
    const [vector] = moveVectorMutate.mock.calls[0];
    expect(vector.pan).toBeGreaterThan(0);
    expect(vector.tilt).toBeCloseTo(0);
  });

  it("inverts tilt so dragging upward (negative screen Y) produces a positive tilt", () => {
    render(<PtzJoystick cameraId="cam-1" />);
    fireEvent.pointerDown(getBase(), { clientX: 0, clientY: -20, pointerId: 1 });

    const [vector] = moveVectorMutate.mock.calls[0];
    expect(vector.tilt).toBeGreaterThan(0);
  });

  it("skips a pointermove send while the previous request is still in flight", () => {
    render(<PtzJoystick cameraId="cam-1" />);
    const base = getBase();
    fireEvent.pointerDown(base, { clientX: 20, clientY: 0, pointerId: 1 });
    expect(moveVectorMutate).toHaveBeenCalledTimes(1);

    // A pointermove right away (before onSettled fires) should be dropped -
    // both by the in-flight guard and the throttle window.
    fireEvent.pointerMove(base, { clientX: 25, clientY: 0, pointerId: 1 });
    expect(moveVectorMutate).toHaveBeenCalledTimes(1);
  });

  it("resumes sending once the in-flight request settles and the throttle window has passed", async () => {
    vi.useFakeTimers();
    render(<PtzJoystick cameraId="cam-1" />);
    const base = getBase();

    fireEvent.pointerDown(base, { clientX: 20, clientY: 0, pointerId: 1 });
    settleLastCall(moveVectorMutate);
    vi.advanceTimersByTime(121);

    fireEvent.pointerMove(base, { clientX: 25, clientY: 0, pointerId: 1 });
    expect(moveVectorMutate).toHaveBeenCalledTimes(2);
  });

  it("keeps resending the last vector on the keep-alive interval while dragging", () => {
    vi.useFakeTimers();
    render(<PtzJoystick cameraId="cam-1" />);
    const base = getBase();

    fireEvent.pointerDown(base, { clientX: 20, clientY: 0, pointerId: 1 });
    settleLastCall(moveVectorMutate);
    expect(moveVectorMutate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(500);
    expect(moveVectorMutate).toHaveBeenCalledTimes(2);
  });

  it("sends a stop command and stops the keep-alive on pointer up", () => {
    vi.useFakeTimers();
    render(<PtzJoystick cameraId="cam-1" />);
    const base = getBase();

    fireEvent.pointerDown(base, { clientX: 20, clientY: 0, pointerId: 1 });
    settleLastCall(moveVectorMutate);
    fireEvent.pointerUp(base, { clientX: 20, clientY: 0, pointerId: 1 });

    expect(stopMutate).toHaveBeenCalledTimes(1);

    const callsBeforeWaiting = moveVectorMutate.mock.calls.length;
    vi.advanceTimersByTime(2000);
    expect(moveVectorMutate).toHaveBeenCalledTimes(callsBeforeWaiting);
  });

  it("shows only one error toast per drag gesture, even if several moves fail", () => {
    render(<PtzJoystick cameraId="cam-1" />);
    const base = getBase();

    fireEvent.pointerDown(base, { clientX: 20, clientY: 0, pointerId: 1 });
    settleLastCall(moveVectorMutate, "onError", new Error("boom"));
    settleLastCall(moveVectorMutate, "onSettled");

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
