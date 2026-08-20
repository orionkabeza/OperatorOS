/**
 * D.4: "A barcode scanner (USB HID) types fast and ends with Enter —
 * detected by inter-keystroke timing and treated as an exact barcode
 * lookup." No physical scanner exists in this sandbox to test against
 * (same honestly-flagged gap as Phase 0's TOTP hardware and phase-1 plan
 * §0.5) — this is verified by simulating fast synthetic keystrokes in
 * Playwright (e2e/counter.spec.ts), not real hardware.
 *
 * A human typing on a keyboard rarely sustains under ~40ms between
 * keystrokes for more than a couple of characters; USB HID barcode
 * scanners typically emit each character a few milliseconds apart. The
 * threshold and minimum-length guard below are deliberately generous
 * (fewer false "barcode" positives from a fast typist beats missing a
 * real scan) and are pure/testable independent of any DOM event.
 */
const MAX_INTERVAL_MS = 30;
const MIN_SCAN_LENGTH = 4;

export function isLikelyBarcodeScan(keystrokeTimestamps: number[]): boolean {
  if (keystrokeTimestamps.length < MIN_SCAN_LENGTH) return false;
  for (let i = 1; i < keystrokeTimestamps.length; i++) {
    const interval = keystrokeTimestamps[i]! - keystrokeTimestamps[i - 1]!;
    if (interval > MAX_INTERVAL_MS) return false;
  }
  return true;
}

/** Tracks keystroke timestamps for one input session, reset on blur/clear. */
export class BarcodeTimingTracker {
  private timestamps: number[] = [];

  record(now: number = Date.now()) {
    this.timestamps.push(now);
  }

  reset() {
    this.timestamps = [];
  }

  isLikelyScan(): boolean {
    return isLikelyBarcodeScan(this.timestamps);
  }
}
