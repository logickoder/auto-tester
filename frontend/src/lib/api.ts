"use client";

import { createClient, supabaseConfigured } from "@/lib/supabase/client";

/**
 * All backend calls go through the /api/backend proxy (a Next.js route
 * handler), so the browser never needs to know the FastAPI URL and CORS
 * never applies. The Supabase access token is attached automatically;
 * FastAPI validates it (PRD FR-16). In dev mode (no Supabase configured)
 * no token is sent and FastAPI runs open against its in-memory store.
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!supabaseConfigured) return {};
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(await authHeaders()),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const data: { detail?: unknown } = await res.json().catch(() => ({}));
    // FastAPI puts a string in "detail"; validation errors put an array there;
    // a crash or a proxy error may have no JSON body at all.
    let detail = "";
    if (typeof data.detail === "string") detail = data.detail;
    else if (data.detail != null) detail = JSON.stringify(data.detail);
    throw new ApiError(res.status, detail || `Request failed (HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""})`);
  }
  return res.json();
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", path, body);
}
