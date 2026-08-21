import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements no layout engine and so ships no ResizeObserver, which
// several Radix primitives (@radix-ui/react-use-size, used by Checkbox)
// construct unconditionally in a layout effect -- without this, rendering
// any component containing one throws "ResizeObserver is not defined"
// before a single assertion runs. A no-op is sufficient: nothing under test
// asserts on measured sizes, which jsdom would report as 0 regardless.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Explicit rather than relying on vitest's `globals: true` — @testing-library/react's
// auto-cleanup only self-registers when it detects a global `afterEach`, which we
// deliberately don't inject globally (tests import describe/it/expect explicitly).
afterEach(() => {
  cleanup();
});
