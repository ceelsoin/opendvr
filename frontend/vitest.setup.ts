import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// React Testing Library's automatic post-test unmount relies on detecting a
// global `afterEach` hook - since this project runs Vitest with
// `test.globals: false` (explicit imports everywhere), that auto-detection
// doesn't kick in, so it's wired up explicitly here instead. Without this,
// every component test in a file renders into the same jsdom `document`
// without ever unmounting the previous one, breaking any query that expects
// a single match (e.g. `getByText`).
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement the Pointer Events capture API (used by
// PtzJoystick's drag handling) - stub it so component tests don't throw
// "not implemented" errors when calling setPointerCapture/releasePointerCapture.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
