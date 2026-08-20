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

type ProgressFn = (percent: number, status: string) => void;

const TOTAL_ROWS = 60;

function todayYmdLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseSheetDate(text: string, today = todayYmdLocal()): string | null {
  const t = text.replace(/[.\-]/g, "/");
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
  if (ymd > today) return today;
  return ymd;
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
    throw new Error("Canvas is not available.");
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not compress the photo."))),
      "image/jpeg",
      0.84
    );
  });
  return blob;
}

export async function recognizeDressingLog(file: Blob, onProgress?: ProgressFn): Promise<ScanResult> {
  const jpeg = await compressToJpeg(file, onProgress);
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
      throw new Error("AI reading timed out. Retry with the same photo.");
    }
    if (e instanceof TypeError) {
      throw new Error("AI reading was cut off. Retry with the same photo.");
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(humanizeApiErrorText(text, `Scan failed (${res.status})`));
  }

  onProgress?.(88, "Filling 60 rows…");
  const json = (await res.json()) as {
    data?: { date?: string | null; entries?: Array<Record<string, unknown>> };
  };
  const payload = json.data ?? {};
  const dateRaw = typeof payload.date === "string" ? payload.date : "";
  const byNo = new Map<number, ScannedEntry>();
  for (const row of payload.entries ?? []) {
    const no = Number(row.no);
    if (!Number.isInteger(no) || no < 1 || no > TOTAL_ROWS) continue;
    byNo.set(no, mapEntry(row, no));
  }
  const entries = Array.from({ length: TOTAL_ROWS }, (_, i) => byNo.get(i + 1) ?? emptyEntry(i + 1));
  onProgress?.(100, "Done");
  return {
    dateRaw,
    dateYmd: dateRaw ? parseSheetDate(dateRaw) : null,
    entries,
  };
}
