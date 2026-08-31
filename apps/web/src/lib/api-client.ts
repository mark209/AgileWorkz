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
  // Nest sends a genuinely empty body (Content-Length: 0), not the literal
  // text "null", for a controller returning `null` — e.g.
  // GET .../maintenance-details before any row exists yet. res.json() on
  // an empty body throws ("Unexpected end of JSON input"), so read as text
  // first and only parse when there's something to parse.
  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

// Real byte-level upload progress needs XMLHttpRequest's upload.onprogress —
// fetch() has no equivalent for outgoing request bodies in browsers. This is
// a native browser API, not a new dependency; every other request in this
// app still goes through the plain apiRequest() above. Used only by the
// document upload panel (Step 8).
export function uploadFileWithProgress<T>(
  path: string,
  accessToken: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T);
        return;
      }
      let message = xhr.statusText || "Upload failed";
      try {
        const body = JSON.parse(xhr.responseText);
        message = Array.isArray(body.message) ? body.message.join(", ") : (body.message ?? message);
      } catch {
        // Response wasn't JSON — keep the statusText fallback above.
      }
      reject(new ApiError(xhr.status, message));
    };

    xhr.onerror = () => reject(new ApiError(0, "Network error during upload"));

    xhr.send(formData);
  });
}
