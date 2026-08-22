import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLandingPathForRole, isDoctorRole, isSectionAdmin } from "../roleRouting";
import {
  ageRangeLabel,
  ageToRange,
  parseAgeInput,
  rangeToAge,
  resolveAgeForSave,
} from "../ageRange";
import { humanizeApiErrorText } from "../apiErrors";
import { getAuthToken, setAuthToken, getRememberedUsername, setRememberedUsername } from "../auth";
import { flushPendingList, isAlreadyRegisteredTodayError, ymdFromIso } from "../pendingSync";
import { createPatient } from "../patientsApi";
import {
  blankSixtyEntries,
  explainScanFailure,
  hasReadableScanRecords,
  parseSheetDate,
  ScanFailedError,
} from "../scanLogSheet";
import { cachedFetch, clearQueryCache, getCached, invalidateCache, setCached } from "../queryCache";

vi.mock("../patientsApi", async () => {
  const actual = await vi.importActual<typeof import("../patientsApi")>("../patientsApi");
  return {
    ...actual,
    createPatient: vi.fn(),
    listPatients: vi.fn(),
  };
});

describe("roleRouting", () => {
  it("sends doctors to /doctor and everyone else to nurse home", () => {
    expect(isDoctorRole("doctor")).toBe(true);
    expect(isDoctorRole("doctor_admin")).toBe(true);
    expect(isDoctorRole("nurse")).toBe(false);
    expect(isSectionAdmin("nurse_admin")).toBe(true);
    expect(isSectionAdmin("nurse")).toBe(false);
    expect(getLandingPathForRole("doctor")).toBe("/doctor");
    expect(getLandingPathForRole("nurse")).toBe("/");
    expect(getLandingPathForRole("admin")).toBe("/");
  });
});

describe("ageRange", () => {
  it("maps ages to bands and keeps original age when the band is unchanged", () => {
    expect(ageToRange(0)).toBe("lt5");
    expect(ageToRange(4)).toBe("lt5");
    expect(ageToRange(5)).toBe("5to14");
    expect(ageToRange(14)).toBe("5to14");
    expect(ageToRange(17)).toBe("15to17");
    expect(ageToRange(18)).toBe("gte18");
    expect(rangeToAge("lt5")).toBe(4);
    expect(ageRangeLabel(3)).toBe("<5");
    expect(resolveAgeForSave("5to14", 12)).toBe(12);
    expect(resolveAgeForSave("gte18", 12)).toBe(18);
  });

  it("parses typed and OCR ages including months", () => {
    expect(parseAgeInput("22")).toBe(22);
    expect(parseAgeInput("10m")).toBe(0);
    expect(parseAgeInput("10 months")).toBe(0);
    expect(parseAgeInput("8y")).toBe(8);
    expect(parseAgeInput("")).toBeNull();
    expect(parseAgeInput("abc")).toBeNull();
    expect(parseAgeInput("200")).toBeNull();
  });
});

describe("apiErrors", () => {
  it("prefers Laravel message then field errors then fallback", () => {
    expect(humanizeApiErrorText('{"message":"Invalid credentials."}', "x")).toBe("Invalid credentials.");
    expect(humanizeApiErrorText('{"errors":{"id_no":["required"]}}', "x")).toBe("id_no: required");
    expect(humanizeApiErrorText("not-json", "x")).toBe("not-json");
    expect(humanizeApiErrorText("", "offline")).toBe("offline");
  });
});

describe("auth storage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("persists token in localStorage and session-only when persist is false", () => {
    setAuthToken("abc", { persist: true });
    expect(getAuthToken()).toBe("abc");
    expect(localStorage.getItem("authToken")).toBe("abc");
    setAuthToken("xyz", { persist: false });
    expect(getAuthToken()).toBe("xyz");
    expect(localStorage.getItem("authToken")).toBeNull();
    expect(sessionStorage.getItem("authToken")).toBe("xyz");
    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
  });

  it("remembers username", () => {
    setRememberedUsername(" nurse1 ");
    expect(getRememberedUsername()).toBe("nurse1");
    setRememberedUsername(null);
    expect(getRememberedUsername()).toBe("");
  });
});

describe("pendingSync", () => {
  it("detects same-day duplicate errors and formats local dates", () => {
    expect(isAlreadyRegisteredTodayError("This ID number is already registered on this date.")).toBe(true);
    expect(isAlreadyRegisteredTodayError("already registered today")).toBe(true);
    expect(isAlreadyRegisteredTodayError("server down")).toBe(false);
    expect(ymdFromIso("2026-08-22T15:04:00")).toBe("2026-08-22");
    expect(ymdFromIso("bad")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("flushes pending rows and keeps retries", async () => {
    vi.mocked(createPatient)
      .mockResolvedValueOnce({
        id: 1,
        id_no: "111",
        sex: "M",
        age: 10,
        room: "room1",
        ww: false,
        lab: false,
        burn: false,
        notes: null,
        created_at: "2026-08-22T10:00:00Z",
        updated_at: "2026-08-22T10:00:00Z",
      })
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new Error("This ID number is already registered on this date."));

    const result = await flushPendingList(
      [
        { id: "a", created_at: "2026-08-22T10:00:00", id_no: "111" },
        { id: "b", created_at: "2026-08-22T10:00:00", id_no: "222" },
        { id: "c", created_at: "2026-08-22T10:00:00", id_no: "333" },
      ],
      (item) => ({
        id_no: item.id_no,
        sex: "M" as const,
        age: 10,
        room: "room1" as const,
        ww: false,
        lab: false,
        burn: false,
        notes: "",
      })
    );

    expect(result.syncedCount).toBe(2);
    expect(result.remaining.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("scanLogSheet helpers", () => {
  it("parses sheet dates and rejects impossible values", () => {
    expect(parseSheetDate("13/8/2026", "2026-08-22")).toBe("2026-08-13");
    expect(parseSheetDate("13/8", "2026-08-22")).toBe("2026-08-13");
    expect(parseSheetDate("40/1", "2026-08-22")).toBeNull();
    expect(parseSheetDate("no date", "2026-08-22")).toBeNull();
  });

  it("requires a readable 3-digit ID among 60 rows", () => {
    const rows = blankSixtyEntries();
    expect(hasReadableScanRecords(rows)).toBe(false);
    rows[0].id_no = "12";
    expect(hasReadableScanRecords(rows)).toBe(false);
    rows[0].id_no = "128";
    expect(hasReadableScanRecords(rows)).toBe(true);
    expect(rows).toHaveLength(60);
  });

  it("explains every scan failure code for usability", () => {
    const codes = ["timeout", "network", "session", "unsupported", "too_large", "busy", "unavailable", "empty", "unclear"] as const;
    for (const code of codes) {
      const copy = explainScanFailure(new ScanFailedError(code));
      expect(copy.title.length).toBeGreaterThan(3);
      expect(copy.message.length).toBeGreaterThan(8);
      expect(copy.hint.length).toBeGreaterThan(8);
    }
    expect(explainScanFailure(new Error("unauthenticated")).title).toMatch(/session/i);
    expect(explainScanFailure(new Error("failed to fetch")).title).toMatch(/connection/i);
  });
});

describe("queryCache", () => {
  beforeEach(() => {
    clearQueryCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns cached values until TTL and coalesces in-flight requests", async () => {
    setCached("k", 1);
    expect(getCached("k", 1000)).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(getCached("k", 1000)).toBeUndefined();

    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      return "ok";
    });
    const a = cachedFetch("n", 5000, fn);
    const b = cachedFetch("n", 5000, fn);
    await expect(Promise.all([a, b])).resolves.toEqual(["ok", "ok"]);
    expect(calls).toBe(1);

    invalidateCache("n");
    expect(getCached("n", 5000)).toBeUndefined();
  });
});
