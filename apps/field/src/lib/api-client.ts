const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

// Phase 7 Wave 1 (F6.1) — the field app previously had no request timeout
// at all: a slow or interrupted cellular connection could leave a
// technician staring at a spinner indefinitely with no feedback and no
// way to recover short of navigating away. Two budgets: a shorter one for
// ordinary JSON calls (list/detail/lifecycle actions, which are small and
// fast once the connection is actually working), a longer one for file
// uploads (up to 25MB over a possibly-slow cellular link legitimately
// takes longer). Both are plain client-side UX timeouts — they change
// nothing about server-side behavior, lifecycle rules, or business logic;
// a timed-out request may or may not have been received by the server,
// exactly like any other network failure the existing error handling
// already had to tolerate.
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const TIMEOUT_MESSAGE = "Request timed out. Check your connection and try again.";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// A timed-out request is distinguishable from a real server error (status
// 0, a fixed, non-technical message) so a caller that wants to react
// differently to "the network is bad" versus "the server rejected this"
// can — none of the existing call sites need to change, since they all
// already just do `e instanceof ApiError ? e.message : ...`, and this
// message is written to be shown to the technician as-is.
export class ApiTimeoutError extends ApiError {
  constructor() {
    super(0, TIMEOUT_MESSAGE);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiTimeoutError();
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<T> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
    REQUEST_TIMEOUT_MS,
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, Array.isArray(body.message) ? body.message.join(", ") : body.message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Phase 4 Operations Frontend — the Service Report upload form needs
// multipart/form-data (a real file plus text fields), which apiRequest
// above can't send: it always JSON.stringifies the body and forces
// Content-Type: application/json. Deliberately NOT setting Content-Type
// here either — the browser must set it itself (multipart/form-data with
// the correct boundary), which it only does when left alone.
export async function apiUpload<T>(path: string, formData: FormData, accessToken: string): Promise<T> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    },
    UPLOAD_TIMEOUT_MS,
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, Array.isArray(body.message) ? body.message.join(", ") : body.message);
  }

  return res.json() as Promise<T>;
}
