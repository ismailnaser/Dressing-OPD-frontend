import { API_BASE_URL } from "./config";
import { apiFetch } from "./http";
import { humanizeApiErrorText } from "./apiErrors";
import { cachedFetch, invalidateCache } from "./queryCache";

export type Sex = "M" | "F";

export type Patient = {
  id: number;
  id_no: string;
  sex: Sex;
  age: number;
  created_by?: string;
  room: "room1" | "room2" | null;
  ww: boolean;
  lab: boolean;
  burn: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientFilters = {
  id_no?: string;
  /** Exact match (no partial/LIKE) — use with `date` for same-day duplicate checks */
  id_no_exact?: string;
  date?: string;
  from_date?: string;
  to_date?: string;
};

function errorMessageFromResponseBody(text: string, fallback: string): string {
  return humanizeApiErrorText(text, fallback);
}

function toQueryString(filters: PatientFilters) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && `${v}`.trim() !== "") {
      params.set(k, `${v}`);
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

const LIST_TTL_MS = 8_000;
const COUNT_TTL_MS = 20_000;

export function invalidatePatientQueries() {
  invalidateCache("patients:");
}

export async function listPatients(filters: PatientFilters, options?: { fresh?: boolean }) {
  const skipCache = Boolean(options?.fresh || filters.id_no_exact);
  const key = `patients:list:${toQueryString(filters)}`;
  const load = async () => {
    const res = await apiFetch(`${API_BASE_URL}/patients${toQueryString(filters)}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Request failed (${res.status})`);
    }
    const json = (await res.json()) as { data: Patient[] };
    return json.data;
  };
  if (skipCache) return load();
  return cachedFetch(key, LIST_TTL_MS, load);
}

export async function createPatient(input: {
  id_no: string;
  sex: Sex;
  age: number;
  room: "room1" | "room2";
  ww?: boolean;
  lab?: boolean;
  burn?: boolean;
  notes?: string | null;
  /** Same UUID as the pending row — safe retries after a lost HTTP response. */
  client_request_id?: string;
  /** When the case was recorded offline (ISO); used for same-day duplicate checks. */
  recorded_at?: string;
}) {
  const res = await apiFetch(`${API_BASE_URL}/patients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_no: input.id_no,
      sex: input.sex,
      age: input.age,
      room: input.room,
      ww: input.ww ?? false,
      lab: input.lab ?? false,
      burn: input.burn ?? false,
      notes: input.notes?.trim() ? input.notes.trim() : null,
      client_request_id: input.client_request_id ?? null,
      recorded_at: input.recorded_at ?? null,
    }),
  });
  if (res.status === 409) {
    const text = await res.text().catch(() => "");
    try {
      const j = JSON.parse(text) as { data?: Patient; message?: string };
      if (j?.data && typeof j.data === "object" && "id" in j.data) {
        invalidatePatientQueries();
        return j.data;
      }
    } catch {
      /* fall through */
    }
    throw new Error(errorMessageFromResponseBody(text, `Request failed (${res.status})`));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(errorMessageFromResponseBody(text, `Request failed (${res.status})`));
  }
  const json = (await res.json()) as { data: Patient };
  invalidatePatientQueries();
  return json.data;
}

export async function exportPatientsExcel(filters: PatientFilters) {
  const res = await apiFetch(`${API_BASE_URL}/patients/excel${toQueryString(filters)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Excel export failed (${res.status})`);
  }
  const blob = await res.blob();
  return blob;
}

export async function getPatientsCount() {
  return cachedFetch("patients:count", COUNT_TTL_MS, async () => {
    const res = await apiFetch(`${API_BASE_URL}/patients/count`, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Request failed (${res.status})`);
    }
    const json = (await res.json()) as { count: number };
    return json.count;
  });
}

export async function updatePatient(
  id: number,
  input: Partial<{
    id_no: string;
    sex: Sex;
    age: number;
    room: "room1" | "room2";
    ww: boolean;
    lab: boolean;
    burn: boolean;
    notes: string | null;
  }>
) {
  const res = await apiFetch(`${API_BASE_URL}/patients/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(errorMessageFromResponseBody(text, `Request failed (${res.status})`));
  }
  const json = (await res.json()) as { data: Patient };
  invalidatePatientQueries();
  return json.data;
}

export async function deletePatient(id: number) {
  const res = await apiFetch(`${API_BASE_URL}/patients/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  invalidatePatientQueries();
}

export type PatientAuditLog = {
  id: number;
  action: "created" | "updated" | "deleted";
  username: string | null;
  user_id: number | null;
  changes: { before: unknown; after: unknown } | null;
  created_at: string;
};

export async function getPatientAudits(id: number) {
  const res = await apiFetch(`${API_BASE_URL}/patients/${id}/audits`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  const json = (await res.json()) as { data: PatientAuditLog[] };
  return json.data;
}
