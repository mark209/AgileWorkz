import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, setSessionRefresher } from "./api-client";

describe("expired sessions", () => {
  afterEach(() => {
    setSessionRefresher(null);
    vi.unstubAllGlobals();
  });

  it("renews the token and retries quotation submission after Unauthorized", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true, text: () => Promise.resolve('{"status":"PENDING_APPROVAL"}') });
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn().mockResolvedValue("renewed-token");
    setSessionRefresher(refresh);

    await expect(apiRequest("/quotations/quote-1/revisions/revision-1/submit", {
      method: "PATCH", accessToken: "expired-token",
    })).resolves.toEqual({ status: "PENDING_APPROVAL" });
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer renewed-token");
  });
});
