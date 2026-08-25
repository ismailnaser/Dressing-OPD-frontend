import { describe, expect, it } from "vitest";
import { explainScanFailure, ScanFailedError, type ScanFailCode } from "../scanLogSheet";
import { getLandingPathForRole, isSectionAdmin } from "../roleRouting";
import { humanizeApiErrorText } from "../apiErrors";
import { AGE_RANGE_OPTIONS } from "../ageRange";

const SCAN_CODES: ScanFailCode[] = [
  "timeout",
  "network",
  "session",
  "unsupported",
  "too_large",
  "busy",
  "quota",
  "unavailable",
  "empty",
  "unclear",
];

describe("usability contracts", () => {
  it("every scan failure tells the user what happened and what to do next", () => {
    for (const code of SCAN_CODES) {
      const copy = explainScanFailure(new ScanFailedError(code));
      expect(copy.title).not.toMatch(/undefined|error code/i);
      expect(copy.message.split(" ").length).toBeGreaterThan(4);
      expect(copy.hint.toLowerCase()).toMatch(/try|sign in|wait|check|ask|use|take|make sure/);
    }
  });

  it("role landing is predictable so users are not stranded after login", () => {
    expect(getLandingPathForRole("doctor")).toBe("/doctor");
    expect(getLandingPathForRole("doctor_admin")).toBe("/doctor");
    expect(getLandingPathForRole("nurse")).toBe("/");
    expect(getLandingPathForRole("nurse_admin")).toBe("/");
    expect(getLandingPathForRole("admin")).toBe("/");
    expect(isSectionAdmin("nurse")).toBe(false);
  });

  it("age bands are labeled in the same language as the keypad UI", () => {
    expect(AGE_RANGE_OPTIONS.map((o) => o.label)).toEqual(["<5", "5-14", "15-17", ">=18"]);
  });

  it("API errors stay short enough to show in a toast", () => {
    const long = "x".repeat(400);
    const text = humanizeApiErrorText(long, "fallback");
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(241);
  });
});
