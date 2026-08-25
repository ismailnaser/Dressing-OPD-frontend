import { API_BASE_URL } from "./config";
import { setAuthToken, type AuthUser } from "./auth";
import { apiFetch } from "./http";
import { humanizeApiErrorText } from "./apiErrors";

export async function login(username: string, password: string, rememberMe = false) {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, remember_me: rememberMe }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(humanizeApiErrorText(text, `Login failed (${res.status})`, res.status));
  }

  const json = (await res.json()) as { token: string; user: AuthUser };
  setAuthToken(json.token, { persist: rememberMe });
  return json.user;
}

export async function logout() {
  await apiFetch(`${API_BASE_URL}/auth/logout`, { method: "POST" }).catch(() => undefined);
  setAuthToken(null);
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const res = await apiFetch(`${API_BASE_URL}/auth/me`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(humanizeApiErrorText(text, `Request failed (${res.status})`));
  }
  const json = (await res.json()) as { user: AuthUser };
  return json.user;
}

