import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import { syncQueuedServiceReports } from "./offline-sync";
import type { QueuedServiceReport } from "./offline-store";

const { uploadServiceReportMock } = vi.hoisted(() => ({ uploadServiceReportMock: vi.fn() }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, uploadServiceReport: uploadServiceReportMock };
});

const { getQueuedServiceReportsMock, removeQueuedServiceReportMock, markNeedsAttentionMock } = vi.hoisted(() => ({
  getQueuedServiceReportsMock: vi.fn(),
  removeQueuedServiceReportMock: vi.fn(),
  markNeedsAttentionMock: vi.fn(),
}));
vi.mock("./offline-store", () => ({
  getQueuedServiceReports: getQueuedServiceReportsMock,
  removeQueuedServiceReport: removeQueuedServiceReportMock,
  markQueuedServiceReportNeedsAttention: markNeedsAttentionMock,
}));

function queuedReport(overrides: Partial<QueuedServiceReport> = {}): QueuedServiceReport {
  return {
    idempotencyKey: "retry-key-1",
    userId: "tech-1",
    customerId: "customer-1",
    siteId: "site-1",
    workOrderId: "wo-1",
    reportTypeCode: "MAINTENANCE_CLEANING",
    file: new Blob(["report"], { type: "image/jpeg" }),
    fileName: "report.jpg",
    fileType: "image/jpeg",
    queuedAt: Date.now(),
    status: "PENDING",
    ...overrides,
  };
}

describe("syncQueuedServiceReports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    getQueuedServiceReportsMock.mockResolvedValue([queuedReport()]);
    uploadServiceReportMock.mockResolvedValue({ id: "sr-1" });
  });

  it("uploads in the technician's identity scope and reuses the original idempotency key", async () => {
    await syncQueuedServiceReports("tech-1", "fresh-access-token");

    expect(uploadServiceReportMock).toHaveBeenCalledWith("fresh-access-token", "customer-1", expect.objectContaining({
      siteId: "site-1",
      workOrderId: "wo-1",
      reportTypeCode: "MAINTENANCE_CLEANING",
      idempotencyKey: "retry-key-1",
      file: expect.objectContaining({ name: "report.jpg", type: "image/jpeg" }),
    }));
    expect(removeQueuedServiceReportMock).toHaveBeenCalledWith("retry-key-1");
    expect(markNeedsAttentionMock).not.toHaveBeenCalled();
  });

  it("keeps the queue untouched while offline", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    await syncQueuedServiceReports("tech-1", "fresh-access-token");

    expect(getQueuedServiceReportsMock).not.toHaveBeenCalled();
    expect(uploadServiceReportMock).not.toHaveBeenCalled();
  });

  it("flags permanent permission rejection for office attention", async () => {
    uploadServiceReportMock.mockRejectedValue(new ApiError(403, "Forbidden"));

    await syncQueuedServiceReports("tech-1", "fresh-access-token");

    expect(markNeedsAttentionMock).toHaveBeenCalledWith("retry-key-1", expect.stringMatching(/server no longer allows/i));
    expect(removeQueuedServiceReportMock).not.toHaveBeenCalled();
  });

  it("leaves a concurrent idempotency conflict queued for a later retry", async () => {
    uploadServiceReportMock.mockRejectedValue(new ApiError(409, "Request is still in progress"));

    await syncQueuedServiceReports("tech-1", "fresh-access-token");

    expect(markNeedsAttentionMock).not.toHaveBeenCalled();
    expect(removeQueuedServiceReportMock).not.toHaveBeenCalled();
  });
});
