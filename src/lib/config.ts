declare global {
  interface Window {
    __LAMA_API_URL__?: string;
  }
}

function normalizeApiUrl(v: string): string {
  const t = v.trim().replace(/\/+$/, "");
  // Ensure it ends with /api (your backend routes are /api/*)
  return t.endsWith("/api") ? t : `${t}/api`;
}

export const API_BASE_URL = (() => {
  const env = process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  const envUrl = typeof env === "string" && env.trim() ? normalizeApiUrl(env) : "";

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1";
    // Local dev always uses .env.local / localhost — never the production runtime URL.
    if (isLocal) {
      return envUrl || "http://127.0.0.1:8000/api";
    }

    const w = window.__LAMA_API_URL__;
    if (typeof w === "string" && w.trim()) return normalizeApiUrl(w);
  }

  if (envUrl) return envUrl;

  return "http://127.0.0.1:8000/api";
})();

