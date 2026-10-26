import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are disabled, so Testing Library's auto-cleanup is not installed.
afterEach(cleanup);

// React Flow's `updateNodeInternals` schedules a frame that constructs a
// DOMMatrixReadOnly to read the viewport zoom. jsdom has no DOMMatrix, and the
// frame can land after a test has finished, which surfaces as an unhandled
// error even though the assertion passed. Only `m22` is read.
if (typeof window !== "undefined" && typeof window.DOMMatrixReadOnly !== "function") {
  class DOMMatrixReadOnlyStub {
    m22 = 1;
  }
  Object.defineProperty(window, "DOMMatrixReadOnly", {
    configurable: true,
    writable: true,
    value: DOMMatrixReadOnlyStub,
  });
}
