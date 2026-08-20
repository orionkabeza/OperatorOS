import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Explicit rather than relying on vitest's `globals: true` — @testing-library/react's
// auto-cleanup only self-registers when it detects a global `afterEach`, which we
// deliberately don't inject globally (tests import describe/it/expect explicitly).
afterEach(() => {
  cleanup();
});
