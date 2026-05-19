import { createPatient, listPatients, type PatientFilters, type Sex } from "./patientsApi";

export type PendingSyncMeta = {
  id: string;
  created_at: string;
};

export type NursePendingPayload = {
  id_no: string;
  sex: Sex;
  age: number;
  room: "room1" | "room2";
  ww: boolean;
  lab: boolean;
  burn: boolean;
  notes: string;
};

export function ymdFromIso(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return todayYmdLocal();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayYmdLocal() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isAlreadyRegisteredTodayError(message: string): boolean {
  return message.toLowerCase().includes("already registered today");
}

/** True if this ID already exists on the server for the pending row's calendar day. */
export async function patientExistsOnServerForPendingDay(
  idNo: string,
  recordedAtIso: string
): Promise<boolean> {
  const date = ymdFromIso(recordedAtIso);
  const rows = await listPatients({ id_no_exact: idNo.trim(), date });
  return rows.length > 0;
}

export type CreatePatientBody = Parameters<typeof createPatient>[0];

/**
 * Upload one pending row: idempotent on the server, reconciles if already saved
 * (slow network / lost response). Returns whether to remove it from local pending.
 */
export async function syncOnePendingPatient(
  meta: PendingSyncMeta,
  body: Omit<CreatePatientBody, "client_request_id" | "recorded_at">
): Promise<"synced" | "retry"> {
  try {
    await createPatient({
      ...body,
      client_request_id: meta.id,
      recorded_at: meta.created_at,
    });
    return "synced";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (isAlreadyRegisteredTodayError(msg)) {
      return "synced";
    }
  }

  try {
    const exists = await patientExistsOnServerForPendingDay(body.id_no, meta.created_at);
    if (exists) return "synced";
  } catch {
    // keep in pending when we cannot verify
  }

  return "retry";
}

export async function flushPendingList<T extends PendingSyncMeta>(
  items: T[],
  toBody: (item: T) => Omit<CreatePatientBody, "client_request_id" | "recorded_at">
): Promise<{ remaining: T[]; syncedCount: number }> {
  const remaining: T[] = [];
  let syncedCount = 0;
  for (const item of items) {
    const result = await syncOnePendingPatient(item, toBody(item));
    if (result === "synced") {
      syncedCount += 1;
    } else {
      remaining.push(item);
    }
  }
  return { remaining, syncedCount };
}
