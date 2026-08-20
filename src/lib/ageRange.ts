export type AgeRange = "lt5" | "5to14" | "15to17" | "gte18";

export const AGE_RANGE_OPTIONS: Array<{ id: AgeRange; label: string }> = [
  { id: "lt5", label: "<5" },
  { id: "5to14", label: "5-14" },
  { id: "15to17", label: "15-17" },
  { id: "gte18", label: ">=18" },
];

export function ageToRange(age: number): AgeRange {
  if (age <= 4) return "lt5";
  if (age <= 14) return "5to14";
  if (age <= 17) return "15to17";
  return "gte18";
}

export function rangeToAge(range: AgeRange): number {
  if (range === "lt5") return 4;
  if (range === "5to14") return 10;
  if (range === "15to17") return 16;
  return 18;
}

export function ageRangeLabel(age: number): string {
  const id = ageToRange(age);
  return AGE_RANGE_OPTIONS.find((o) => o.id === id)?.label ?? String(age);
}

/** Keep the stored age when the selected period still matches (old exact ages stay unchanged). */
export function resolveAgeForSave(selectedRange: AgeRange, originalAge?: number): number {
  if (
    typeof originalAge === "number" &&
    Number.isFinite(originalAge) &&
    ageToRange(originalAge) === selectedRange
  ) {
    return originalAge;
  }
  return rangeToAge(selectedRange);
}

/**
 * Parse a typed or OCR age: "22", "10m", "10mon", "10 months".
 * Ages given in months (under 1 year) are stored as 0 so they map to &lt;5.
 */
export function parseAgeInput(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/,/g, ".").replace(/\.+$/, "");
  if (!t) return null;
  const mon = t.match(/^(\d+(?:\.\d+)?)\s*(m|mo|mon|mons|month|months)$/i);
  if (mon) {
    const months = Number(mon[1]);
    if (!Number.isFinite(months) || months < 0) return null;
    return 0;
  }
  if (!/^\d+(?:\.\d+)?$/.test(t)) {
    const digits = t.match(/^(\d{1,3})\s*(y|yr|yrs|year|years)?$/i);
    if (!digits) return null;
    const n = Number(digits[1]);
    if (!Number.isFinite(n) || n < 0 || n > 150) return null;
    return Math.round(n);
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 150) return null;
  return Math.round(n);
}
