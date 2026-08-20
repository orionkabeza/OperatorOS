import { describe, expect, it } from "vitest";
import { BarcodeTimingTracker, isLikelyBarcodeScan } from "./barcode";

describe("barcode HID-timing detection (D.4) — simulated, no physical scanner available", () => {
  it("treats a fast, evenly-spaced run of keystrokes as a scan", () => {
    // A USB HID scanner emitting "6001234500019" — ~8ms apart.
    const timestamps = Array.from({ length: 13 }, (_, i) => i * 8);
    expect(isLikelyBarcodeScan(timestamps)).toBe(true);
  });

  it("does not treat normal human typing speed as a scan", () => {
    // A person typing "cement" at a realistic ~150ms/keystroke.
    const timestamps = [0, 160, 300, 470, 610, 780];
    expect(isLikelyBarcodeScan(timestamps)).toBe(false);
  });

  it("does not treat a short burst below the minimum length as a scan", () => {
    const timestamps = [0, 5, 10]; // fast, but too short — could be a fast typist on a 3-char SKU
    expect(isLikelyBarcodeScan(timestamps)).toBe(false);
  });

  it("rejects a run with even one slow gap in the middle", () => {
    const timestamps = [0, 5, 10, 15, 200, 205, 210]; // a pause mid-scan shouldn't happen for real hardware
    expect(isLikelyBarcodeScan(timestamps)).toBe(false);
  });

  it("BarcodeTimingTracker records and resets correctly", () => {
    const tracker = new BarcodeTimingTracker();
    tracker.record(0);
    tracker.record(5);
    tracker.record(10);
    tracker.record(15);
    expect(tracker.isLikelyScan()).toBe(true);
    tracker.reset();
    expect(tracker.isLikelyScan()).toBe(false);
  });
});
