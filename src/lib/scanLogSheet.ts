import { ageToRange, type AgeRange } from "./ageRange";
import { API_BASE_URL } from "./config";
import { apiFetch } from "./http";
import { humanizeApiErrorText } from "./apiErrors";
import type { Sex } from "./patientsApi";

export type ScannedEntry = {
  rowNo: number;
  id_no: string;
  sex: Sex | null;
  age: number | null;
  ageRange: AgeRange | null;
  ww: boolean;
  lab: boolean;
  burn: boolean;
};

export type ScanResult = {
  dateYmd: string | null;
  dateRaw: string;
  entries: ScannedEntry[];
};

export type ScanFailCode =
  | "timeout"
  | "network"
  | "session"
  | "unsupported"
  | "too_large"
  | "busy"
  | "quota"
  | "unavailable"
  | "empty"
  | "unclear";

export type ScanFailureInfo = {
  title: string;
  message: string;
  hint: string;
};

export class ScanFailedError extends Error {
  readonly code: ScanFailCode;

  constructor(code: ScanFailCode, message?: string) {
    super(message ?? code);
    this.name = "ScanFailedError";
    this.code = code;
  }
}

type ProgressFn = (percent: number, status: string) => void;

const SCAN_FAILURE_COPY: Record<ScanFailCode, ScanFailureInfo> = {
  timeout: {
    title: "Analysis timed out",
    message: "The photo was sent, but the analysis did not finish in time.",
    hint: "Try again with a closer, clearer photo of the sheet.",
  },
  network: {
    title: "Connection problem",
    message: "The scan could not reach the server, so the records were not filled.",
    hint: "Check your internet connection, then try the same photo again.",
  },
  session: {
    title: "Session expired",
    message: "You need to sign in again before scanning.",
    hint: "Sign in, then take or choose the photo again.",
  },
  unsupported: {
    title: "Photo not accepted",
    message: "This file is not a supported image for scanning.",
    hint: "Use a JPEG or PNG photo of the log sheet.",
  },
  too_large: {
    title: "Photo too large",
    message: "The image is larger than the scan allows.",
    hint: "Take a new photo and try again.",
  },
  busy: {
    title: "Scan service is busy",
    message: "Too many scan requests were sent at once.",
    hint: "Wait a few seconds, then retry the same photo.",
  },
  quota: {
    title: "Daily scan limit reached",
    message: "Today's free photo scans for the AI service are all used up.",
    hint: "Enter these records with Manual entry. Scanning works again tomorrow, or an administrator can raise the limit.",
  },
  unavailable: {
    title: "Scan is not available",
    message: "The analysis service is not ready right now.",
    hint: "Try again later. If this continues, ask an administrator.",
  },
  empty: {
    title: "No records found",
    message: "The photo was processed, but no patient IDs could be read.",
    hint: "Make sure the full sheet is in frame, well lit, and not blurry, then try again.",
  },
  unclear: {
    title: "Analysis did not complete",
    message: "The scan could not fill the records from this photo.",
    hint: "Try a clearer, closer photo of the sheet.",
  },
};

function classifyScanMessage(raw: string): ScanFailCode {
  const t = raw.toLowerCase();
  if (!t.trim()) return "unclear";
  if (t.includes("timed out") || t.includes("timeout") || t.includes("abort")) return "timeout";
  if (
    t.includes("failed to fetch") ||
    t.includes("network") ||
    t.includes("cut off") ||
    t.includes("load failed") ||
    t.includes("offline")
  ) {
    return "network";
  }
  if (t.includes("unauthenticated") || t.includes("session") || t.includes("sign in") || t.includes("unauthorized")) {
    return "session";
  }
  if (t.includes("mimes") || t.includes("file of type") || t.includes("supported image")) return "unsupported";
  if (t.includes("too large") || t.includes("greater than") || t.includes("kilobytes")) return "too_large";
  if (t.includes("daily free limit") || t.includes("daily limit") || t.includes("resets tomorrow")) {
    return "quota";
  }
  if (t.includes("busy") || t.includes("rate limit") || t.includes("quota") || t.includes("429")) return "busy";
  if (
    t.includes("not available") ||
    t.includes("api key") ||
    t.includes(".env") ||
    t.includes("gemini") ||
    t.includes("openai")
  ) {
    return "unavailable";
  }
  if (
    t.includes("no records") ||
    t.includes("no patient") ||
    t.includes("empty reading") ||
    t.includes("could not read the sheet") ||
    t.includes("clearer photo")
  ) {
    return "empty";
  }
  return "unclear";
}

function scanErrorFromHttp(status: number, body: string): ScanFailedError {
  if (status === 401 || status === 419) return new ScanFailedError("session");
  if (status === 413) return new ScanFailedError("too_large");
  if (status === 429) return new ScanFailedError("busy");
  if (status === 502 || status === 503 || status === 504) return new ScanFailedError("unavailable");

  const msg = humanizeApiErrorText(body, "");
  const classified = classifyScanMessage(msg || body);
  if (classified !== "unclear") return new ScanFailedError(classified, msg || undefined);

  if (status === 422) {
    const t = `${msg} ${body}`.toLowerCase();
    if (/mimes|file of type|jpeg|png|webp/.test(t)) return new ScanFailedError("unsupported");
    if (/greater than|kilobytes|too large/.test(t)) return new ScanFailedError("too_large");
  }

  return new ScanFailedError("unclear");
}

export function explainScanFailure(err: unknown): ScanFailureInfo {
  const code = err instanceof ScanFailedError ? err.code : classifyScanMessage(err instanceof Error ? err.message : String(err ?? ""));
  return SCAN_FAILURE_COPY[code];
}

export function hasReadableScanRecords(entries: ScannedEntry[]): boolean {
  return entries.some((e) => /^\d{3}$/.test(e.id_no.trim()));
}

const TOTAL_ROWS = 60;

function todayYmdLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MONTH_NAME_TO_NUM: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function isRealYmd(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(y, month - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

function clampSheetYmd(ymd: string, today: string): string | null {
  if (!isRealYmd(ymd)) return null;
  if (ymd > today) return today;
  return ymd;
}

export function parseSheetDate(text: string, today = todayYmdLocal()): string | null {
  const raw = text.trim();
  if (!raw) return null;

  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return clampSheetYmd(`${iso[1]}-${iso[2]}-${iso[3]}`, today);

  const named = raw.match(
    /\b(\d{1,2})\s*[\/.\-\s]\s*([A-Za-z]{3,9})\s*[\/.\-\s,]?\s*(\d{2,4})?\b/
  );
  if (named) {
    const month = MONTH_NAME_TO_NUM[named[2].toLowerCase()];
    if (month) {
      const day = Number(named[1]);
      let year = named[3] ? Number(named[3]) : new Date(`${today}T12:00:00`).getFullYear();
      if (year < 100) year += 2000;
      const pad = (n: number) => String(n).padStart(2, "0");
      return clampSheetYmd(`${year}-${pad(month)}-${pad(day)}`, today);
    }
  }

  const t = raw.replace(/[.\-]/g, "/");
  const m =
    t.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})\b/) ??
    t.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year = new Date(`${today}T12:00:00`).getFullYear();
  if (m[3]) {
    year = Number(m[3]);
    if (year < 100) year += 2000;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  let ymd = `${year}-${pad(month)}-${pad(day)}`;
  if (!m[3] && ymd > today) ymd = `${year - 1}-${pad(month)}-${pad(day)}`;
  return clampSheetYmd(ymd, today);
}

function emptyEntry(rowNo: number): ScannedEntry {
  return {
    rowNo,
    id_no: "",
    sex: "M",
    age: null,
    ageRange: null,
    ww: false,
    lab: false,
    burn: false,
  };
}

export function blankSixtyEntries(): ScannedEntry[] {
  return Array.from({ length: TOTAL_ROWS }, (_, i) => emptyEntry(i + 1));
}

function threeDigitId(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return /^\d{3}$/.test(digits) ? digits : "";
}

function mapService(service: unknown): { ww: boolean; lab: boolean; burn: boolean } {
  const s = String(service ?? "").toLowerCase().trim();
  if (s === "lab") return { ww: false, lab: true, burn: false };
  if (s === "ww" || s === "w") return { ww: true, lab: false, burn: false };
  if (s === "burn") return { ww: false, lab: false, burn: true };
  return { ww: false, lab: false, burn: false };
}

function mapEntry(row: Record<string, unknown>, rowNo: number): ScannedEntry {
  const id_no = threeDigitId(row.id_no ?? row.id);
  const sexRaw = String(row.sex ?? "").toUpperCase();
  const sex: Sex | null = sexRaw === "F" ? "F" : sexRaw === "M" ? "M" : null;
  let age: number | null = null;
  if (typeof row.age === "number" && Number.isFinite(row.age)) age = Math.round(row.age);
  else if (typeof row.age === "string" && row.age.trim() !== "") {
    const n = Number(row.age);
    if (Number.isFinite(n)) age = Math.round(n);
  }
  if (age !== null && (age < 0 || age > 150)) age = null;
  return {
    rowNo,
    id_no,
    sex: sex ?? "M",
    age,
    ageRange: age !== null ? ageToRange(age) : null,
    ...mapService(row.service),
  };
}

async function compressToJpeg(file: Blob, onProgress?: ProgressFn): Promise<Blob> {
  onProgress?.(8, "Preparing photo…");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new ScanFailedError("unclear");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new ScanFailedError("unclear"))),
      "image/jpeg",
      0.84
    );
  });
  return blob;
}

export async function recognizeDressingLog(file: Blob, onProgress?: ProgressFn): Promise<ScanResult> {
  let jpeg: Blob;
  try {
    jpeg = await compressToJpeg(file, onProgress);
  } catch (e) {
    if (e instanceof ScanFailedError) throw e;
    throw new ScanFailedError("unclear");
  }
  onProgress?.(22, "AI is reading the sheet…");

  const body = new FormData();
  body.append("image", jpeg, "sheet.jpg");

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 165_000);
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE_URL}/scan-log-sheet`, {
      method: "POST",
      body,
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ScanFailedError("timeout");
    }
    if (e instanceof TypeError) {
      throw new ScanFailedError("network");
    }
    throw e instanceof ScanFailedError
      ? e
      : new ScanFailedError(classifyScanMessage(e instanceof Error ? e.message : String(e ?? "")));
  } finally {
    window.clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw scanErrorFromHttp(res.status, text);
  }

  onProgress?.(88, "Filling 60 rows…");
  let json: { data?: { date?: string | null; entries?: Array<Record<string, unknown>> } };
  try {
    json = (await res.json()) as {
      data?: { date?: string | null; entries?: Array<Record<string, unknown>> };
    };
  } catch {
    throw new ScanFailedError("unclear");
  }
  const payload = json.data ?? {};
  const dateRaw = typeof payload.date === "string" ? payload.date : "";
  const byNo = new Map<number, ScannedEntry>();
  for (const row of payload.entries ?? []) {
    const no = Number(row.no);
    if (!Number.isInteger(no) || no < 1 || no > TOTAL_ROWS) continue;
    byNo.set(no, mapEntry(row, no));
  }
  const entries = Array.from({ length: TOTAL_ROWS }, (_, i) => byNo.get(i + 1) ?? emptyEntry(i + 1));
  if (!hasReadableScanRecords(entries)) {
    throw new ScanFailedError("empty");
  }
  onProgress?.(100, "Done");
  return {
    dateRaw,
    dateYmd: dateRaw ? parseSheetDate(dateRaw) : null,
    entries,
  };
}
