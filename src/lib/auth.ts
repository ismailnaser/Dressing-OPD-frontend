export type AuthUser = {
  id: number;
  name: string;
  username: string;
  email: string;
  role: "admin" | "user" | "doctor" | "doctor_admin" | "nurse" | "nurse_admin";
  is_active?: boolean;
};

const TOKEN_KEY = "authToken";
const REMEMBERED_USERNAME_KEY = "rememberedUsername";

function readStorage(storage: Storage): string | null {
  try {
    const t = storage.getItem(TOKEN_KEY);
    return t && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return readStorage(localStorage) ?? readStorage(sessionStorage);
}

export function setAuthToken(token: string | null, options?: { persist?: boolean }) {
  if (typeof window === "undefined") return;
  try {
    if (!token) {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      return;
    }
    const persist = options?.persist ?? true;
    if (persist) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.removeItem(TOKEN_KEY);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function getRememberedUsername(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(REMEMBERED_USERNAME_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setRememberedUsername(username: string | null) {
  if (typeof window === "undefined") return;
  try {
    const value = username?.trim() ?? "";
    if (!value) localStorage.removeItem(REMEMBERED_USERNAME_KEY);
    else localStorage.setItem(REMEMBERED_USERNAME_KEY, value);
  } catch {
    /* ignore */
  }
}
