"use client";

import { Camera, CircleAlert, ImagePlus, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AGE_RANGE_OPTIONS, ageToRange, resolveAgeForSave, type AgeRange } from "@/lib/ageRange";
import { explainScanFailure, recognizeDressingLog, type ScanFailureInfo, type ScannedEntry } from "@/lib/scanLogSheet";
import type { Sex } from "@/lib/patientsApi";

export type ScanImportRow = {
  id_no: string;
  sex: Sex;
  age: number;
  ww: boolean;
  lab: boolean;
  burn: boolean;
};

export type ScanImportResult = {
  saved: number;
  offline: number;
  skipped: number;
  failed: number;
};

type ReviewRow = {
  key: string;
  rowNo: number;
  selected: boolean;
  id_no: string;
  sex: Sex;
  ageRange: AgeRange | "";
  originalAge: number | null;
  ww: boolean;
  lab: boolean;
  burn: boolean;
  duplicate: boolean;
  note: string;
};

const fieldClass =
  "w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600";

function todayYmd() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function CompactAgeButtons({
  value,
  onChange,
}: {
  value: AgeRange | "";
  onChange: (next: AgeRange) => void;
}) {
  return (
    <div className="grid min-w-40 grid-cols-4 gap-0.5">
      {AGE_RANGE_OPTIONS.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-md border px-1 py-1.5 text-[11px] font-semibold ${
              selected
                ? "border-slate-600 bg-slate-600 text-white"
                : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function isThreeDigitId(id: string): boolean {
  return /^\d{3}$/.test(id.trim());
}

function isRowReady(r: ReviewRow): boolean {
  return !r.duplicate && isThreeDigitId(r.id_no) && r.ageRange !== "";
}

function canSelectRow(r: ReviewRow): boolean {
  return !r.duplicate && isThreeDigitId(r.id_no);
}

export function ScanLogSheet({
  defaultDate,
  getRegisteredIds,
  onImport,
}: {
  defaultDate: string;
  getRegisteredIds: (dateYmd: string) => Promise<string[]>;
  onImport: (
    rows: ScanImportRow[],
    dateYmd: string,
    room: "room1" | "room2"
  ) => Promise<ScanImportResult>;
}) {
  const today = todayYmd();
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [caseDate, setCaseDate] = useState(defaultDate);
  const [room, setRoom] = useState<"room1" | "room2">("room1");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [photoZoom, setPhotoZoom] = useState(1);
  const [failOpen, setFailOpen] = useState(false);
  const [failInfo, setFailInfo] = useState<ScanFailureInfo | null>(null);

  function rowsFromEntries(entries: ScannedEntry[]): ReviewRow[] {
    return entries.map((e) => ({
      key: `row-${e.rowNo}`,
      rowNo: e.rowNo,
      selected: false,
      id_no: e.id_no,
      sex: e.sex ?? "M",
      ageRange: e.ageRange ?? "",
      originalAge: e.age,
      ww: e.ww,
      lab: e.lab,
      burn: e.burn,
      duplicate: false,
      note: "",
    }));
  }

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function annotateDuplicates(
    nextRows: ReviewRow[],
    dateYmd: string,
    mode: "init" | "keep"
  ): Promise<ReviewRow[]> {
    let registered = new Set<string>();
    try {
      registered = new Set((await getRegisteredIds(dateYmd)).map((id) => id.trim()));
    } catch {
      registered = new Set();
    }
    const seen = new Set<string>();
    const out: ReviewRow[] = [];
    for (const row of nextRows) {
      const id = row.id_no.trim();
      let duplicate = false;
      let note = "";
      if (id) {
        if (seen.has(id) || registered.has(id)) {
          duplicate = true;
          note = seen.has(id) ? "Duplicate ID on this sheet" : "Already registered on this date";
        } else {
          seen.add(id);
        }
      }
      if (!note && id && !isThreeDigitId(id)) note = "ID must be 3 digits";
      if (!note && !row.ageRange) note = "Pick age period";
      const selected =
        duplicate ? false : mode === "init" ? isThreeDigitId(id) : row.selected && isThreeDigitId(id);
      out.push({
        ...row,
        duplicate,
        selected,
        note,
      });
    }
    return out;
  }

  function showScanFailure(e: unknown) {
    setFailInfo(explainScanFailure(e));
    setFailOpen(true);
  }

  async function applyAiResult(file: File) {
    const result = await recognizeDressingLog(file, (pct, status) => setProgress({ pct, status }));
    const dateYmd = result.dateYmd || defaultDate;
    setCaseDate(dateYmd);
    const annotated = await annotateDuplicates(rowsFromEntries(result.entries), dateYmd, "init");
    setRows(annotated);
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setFailOpen(false);
    setBusy(true);
    setProgress({ pct: 4, status: "Sending photo to AI…" });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setScanFile(file);
    setPhotoZoom(1);
    try {
      await applyAiResult(file);
      setReviewOpen(true);
    } catch (e) {
      showScanFailure(e);
    } finally {
      setBusy(false);
      setProgress(null);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function fillWithAi() {
    if (!scanFile) return;
    setBusy(true);
    setError(null);
    setProgress({ pct: 8, status: "AI is filling the 60 rows…" });
    try {
      await applyAiResult(scanFile);
      setFailOpen(false);
      setReviewOpen(true);
    } catch (e) {
      showScanFailure(e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const selectedValid = useMemo(() => rows.filter((r) => r.selected && isRowReady(r)), [rows]);
  const selectedCount = useMemo(() => rows.filter((r) => r.selected && canSelectRow(r)).length, [rows]);

  async function onChangeDate(next: string) {
    const dateYmd = next || defaultDate;
    setCaseDate(dateYmd);
    setRows(await annotateDuplicates(rows, dateYmd, "keep"));
  }

  function patchRow(key: string, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function importSelected() {
    if (selectedValid.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const payload: ScanImportRow[] = [];
      const seen = new Set<string>();
      for (const r of selectedValid) {
        const id = r.id_no.trim();
        if (!id || !r.ageRange || seen.has(id)) continue;
        seen.add(id);
        payload.push({
          id_no: id,
          sex: r.sex,
          age: resolveAgeForSave(r.ageRange, r.originalAge ?? undefined),
          ww: r.ww,
          lab: r.lab,
          burn: r.burn,
        });
      }
      setImportProgress(`Saving ${payload.length}…`);
      const result = await onImport(payload, caseDate, room);
      setImportProgress("");
      setReviewOpen(false);
      setRows([]);
      if (!result.saved && !result.offline && result.failed) {
        setError("No new records were imported.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
      setImportProgress("");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        Photograph the sheet. AI fills all 60 rows directly. Check the list, then uncheck any row
        you do not want. ID is 3 digits. Dressing does not tick a box; only Lab, WW, or Burn.
      </p>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onPickFile(e.target.files?.[0])}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPickFile(e.target.files?.[0])}
      />

      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => cameraRef.current?.click()}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs font-semibold disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <Camera className="h-4 w-4" />
          Take photo
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs font-semibold disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <ImagePlus className="h-4 w-4" />
          Choose image
        </button>
      </div>

      {previewUrl && !reviewOpen ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Selected log sheet"
          className="max-h-36 w-full rounded-xl border border-zinc-200 object-contain dark:border-zinc-800"
        />
      ) : null}

      {busy || progress ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-1 flex items-center gap-2 font-medium text-zinc-700 dark:text-zinc-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {progress?.status ?? "Reading…"}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full bg-slate-600 transition-all"
              style={{ width: `${Math.max(4, progress?.pct ?? 4)}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </div>
      ) : null}

      {failOpen && failInfo ? (
        <div
          className="fixed inset-0 z-80 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scan-fail-title"
          aria-describedby="scan-fail-message"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            onClick={() => !busy && setFailOpen(false)}
            aria-label="Close"
          />
          <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                <CircleAlert className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 id="scan-fail-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {failInfo.title}
                </h2>
                <p id="scan-fail-message" className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                  {failInfo.message}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {failInfo.hint}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setFailOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950"
              >
                Close
              </button>
              {scanFile ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void fillWithAi()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {busy ? "Analyzing…" : "Retry same photo"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {reviewOpen ? (
        <div
          className="fixed inset-0 z-70 flex items-center justify-center p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Review scanned records"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => !importing && setReviewOpen(false)}
            aria-label="Close"
          />
          <div className="relative flex max-h-[92vh] w-full max-w-7xl flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                AI filled 60 rows · {selectedCount} selected · {selectedValid.length} ready to save
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={busy || importing || !scanFile}
                  onClick={() => void fillWithAi()}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  {busy ? "Reading…" : "Retry AI fill"}
                </button>
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => setReviewOpen(false)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-950"
                >
                  Close
                </button>
              </div>
            </div>

            <p className="mb-3 text-xs text-zinc-500">
              AI filled these rows from the photo. Uncheck a row to skip it. Age is only {"<5"}, 5-14,
              15-17, or {">=18"}. Dressing = no box.
            </p>

            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Case date
                <input
                  type="date"
                  value={caseDate}
                  max={today}
                  onChange={(e) => void onChangeDate(e.target.value)}
                  className={`mt-1 ${fieldClass}`}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void annotateDuplicates(rows, caseDate, "keep").then(setRows)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-2 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-950"
                >
                  Re-check IDs
                </button>
              </div>
              <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Room
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {(["room1", "room2"] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setRoom(id)}
                      className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                        room === id
                          ? "border-slate-600 bg-slate-600 text-white"
                          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                      }`}
                    >
                      {id === "room1" ? "Room 1" : "Room 2"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
              {previewUrl ? (
                <div className="flex max-h-[36vh] flex-col overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950 lg:max-h-none lg:w-[42%]">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-500">
                    Photo
                    <input
                      type="range"
                      min={1}
                      max={2.5}
                      step={0.1}
                      value={photoZoom}
                      onChange={(e) => setPhotoZoom(Number(e.target.value))}
                      className="flex-1"
                      aria-label="Zoom photo"
                    />
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Log sheet"
                    className="w-full origin-top-left object-contain"
                    style={{ transform: `scale(${photoZoom})` }}
                  />
                </div>
              ) : null}

            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="w-full min-w-180 text-left text-xs">
                <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-950">
                  <tr className="border-b border-zinc-200 dark:border-zinc-800">
                    <th className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={
                          selectedCount > 0 &&
                          selectedCount === rows.filter((r) => canSelectRow(r)).length
                        }
                        onChange={(e) => {
                          const on = e.target.checked;
                          setRows((prev) => prev.map((r) => ({ ...r, selected: on && canSelectRow(r) })));
                        }}
                        aria-label="Select all valid rows"
                      />
                    </th>
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">ID NO</th>
                    <th className="px-2 py-2">Sex</th>
                    <th className="px-2 py-2">Age period</th>
                    <th className="px-2 py-2">WW</th>
                    <th className="px-2 py-2">Lab</th>
                    <th className="px-2 py-2">Burn</th>
                    <th className="px-2 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.key}
                      className={`border-b border-zinc-100 dark:border-zinc-800 ${
                        r.duplicate ? "bg-red-50/70 dark:bg-red-950/20" : ""
                      }`}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={r.selected}
                          disabled={!canSelectRow(r)}
                          onChange={(e) => patchRow(r.key, { selected: e.target.checked })}
                          aria-label={`Select row ${r.rowNo}`}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-zinc-500">{r.rowNo}</td>
                      <td className="px-2 py-1.5">
                        <input
                          value={r.id_no}
                          inputMode="numeric"
                          maxLength={3}
                          onChange={(e) => {
                            const id_no = e.target.value.replace(/\D/g, "").slice(0, 3);
                            patchRow(r.key, {
                              id_no,
                              duplicate: false,
                              selected: isThreeDigitId(id_no) && !r.duplicate,
                            });
                          }}
                          className={fieldClass}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={r.sex}
                          onChange={(e) => patchRow(r.key, { sex: e.target.value as Sex })}
                          className={fieldClass}
                          aria-label="Sex"
                        >
                          <option value="M">M</option>
                          <option value="F">F</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <CompactAgeButtons
                          value={r.ageRange}
                          onChange={(next) =>
                            patchRow(r.key, {
                              ageRange: next,
                              originalAge:
                                r.originalAge != null && ageToRange(r.originalAge) === next
                                  ? r.originalAge
                                  : null,
                              selected: isThreeDigitId(r.id_no) && !r.duplicate,
                              note: r.note === "Pick age period" ? "" : r.note,
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={r.ww}
                          onChange={(e) => patchRow(r.key, { ww: e.target.checked })}
                          aria-label="WW"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={r.lab}
                          onChange={(e) => patchRow(r.key, { lab: e.target.checked })}
                          aria-label="Lab"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={r.burn}
                          onChange={(e) => patchRow(r.key, { burn: e.target.checked })}
                          aria-label="Burn"
                        />
                      </td>
                      <td className="max-w-40 px-2 py-1.5 text-zinc-500">{r.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-zinc-500">{importProgress}</div>
              <button
                type="button"
                disabled={importing || selectedValid.length === 0}
                onClick={() => void importSelected()}
                className="rounded-xl bg-slate-600 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? "Saving…" : `Save ${selectedValid.length} record${selectedValid.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
