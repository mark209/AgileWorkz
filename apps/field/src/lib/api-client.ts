const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; accessToken?: string } = {},
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

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
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, Array.isArray(body.message) ? body.message.join(", ") : body.message);
  }

  return res.json() as Promise<T>;
}
