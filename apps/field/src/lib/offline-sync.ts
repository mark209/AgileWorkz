import { ApiError } from "./api-client";
import { uploadServiceReport } from "./api";
import {
  getQueuedServiceReports,
  markQueuedServiceReportNeedsAttention,
  removeQueuedServiceReport,
} from "./offline-store";

export const OFFLINE_QUEUE_UPDATED_EVENT = "agileworks-offline-queue-updated";

export async function syncQueuedServiceReports(userId: string, accessToken: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine) return;

  const queuedReports = await getQueuedServiceReports(userId);
  for (const queued of queuedReports) {
    if (queued.status !== "PENDING") continue;
    try {
      const file = new File([queued.file], queued.fileName, { type: queued.fileType });
      await uploadServiceReport(accessToken, queued.customerId, {
        siteId: queued.siteId,
        workOrderId: queued.workOrderId,
        reportTypeCode: queued.reportTypeCode,
        file,
        idempotencyKey: queued.idempotencyKey,
      });
      await removeQueuedServiceReport(queued.idempotencyKey);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status)) {
        const message = error.status === 403
          ? "The server no longer allows this report for your account or this job. Contact the office."
          : `The server rejected this report (HTTP ${error.status}). Contact the office before deleting it.`;
        await markQueuedServiceReportNeedsAttention(queued.idempotencyKey, message);
        continue;
      }
      // Connectivity errors, expired sessions, timeouts, and server errors
      // remain queued. A later online event or sign-in retries the same
      // idempotency key, so a timed-out request cannot create a duplicate.
      break;
    }
  }
  window.dispatchEvent(new Event(OFFLINE_QUEUE_UPDATED_EVENT));
}
