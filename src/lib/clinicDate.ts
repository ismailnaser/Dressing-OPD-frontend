/** Clinic calendar timezone. Duplicate checks and date filters must use this day, not UTC. */
export const CLINIC_TIMEZONE = "Asia/Gaza";

export function isYmd(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function todayYmdClinic(): string {
  return ymdInClinicTz(new Date().toISOString());
}

export function ymdInClinicTz(isoLike: string): string {
  const raw = isoLike.trim();
  if (isYmd(raw) && !raw.includes("T")) return raw;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return todayYmdClinic();
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: CLINIC_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch {
    /* fall through to local */
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Visible as dd/mm/yyyy so Arabic RTL phones do not scramble native date inputs. */
export function formatYmdDisplay(ymd: string): string {
  if (!isYmd(ymd)) return ymd || "";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
