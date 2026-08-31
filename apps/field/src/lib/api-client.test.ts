import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiTimeoutError, apiRequest, apiUpload } from "./api-client";

// Phase 7 Wave 1 (F6.1) — apps/field previously had no request timeout at
// all. These tests prove a hung fetch() is aborted after the configured
// budget and surfaces as a distinguishable, technician-friendly error,
// rather than hanging forever.

describe("api-client timeouts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("apiRequest aborts and throws ApiTimeoutError when the server never responds", async () => {
    const hungFetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new DOMException("Aborted", "AbortError");
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", hungFetch);

    const promise = apiRequest("/work-orders/mine", { accessToken: "token-1" });
    const assertion = expect(promise).rejects.toBeInstanceOf(ApiTimeoutError);

    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it("apiRequest resolves normally when the server responds before the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ ok: true }),
          }) as unknown as Promise<Response>,
      ),
    );

    const result = await apiRequest<{ ok: boolean }>("/work-orders/mine", { accessToken: "token-1" });
    expect(result).toEqual({ ok: true });
  });

  it("a real (non-timeout) rejection still surfaces as a plain Error, not ApiTimeoutError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    await expect(apiRequest("/work-orders/mine", { accessToken: "token-1" })).rejects.not.toBeInstanceOf(ApiTimeoutError);
  });

  it("apiUpload aborts after the longer upload timeout budget, not the short request budget", async () => {
    const hungFetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    vi.stubGlobal("fetch", hungFetch);

    const formData = new FormData();
    const promise = apiUpload("/customers/c1/service-reports", formData, "token-1");
    const assertion = expect(promise).rejects.toBeInstanceOf(ApiTimeoutError);

    // Still pending at the short (20s) budget — the upload budget is longer.
    await vi.advanceTimersByTimeAsync(20_000);
    let settled = false;
    promise.catch(() => undefined).finally(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    // Now cross the actual 60s upload budget.
    await vi.advanceTimersByTimeAsync(40_000);
    await assertion;
  });

  it("ApiTimeoutError carries a clear, technician-facing message and status 0", () => {
    const err = new ApiTimeoutError();
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/timed out/i);
  });
});
