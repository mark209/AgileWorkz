"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  cancelWorkOrder,
  closeWorkOrder,
  completeWorkOrder,
  dismissCancellationRequest,
  requestCancelWorkOrder,
  scheduleWorkOrder,
  type WorkOrder,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";

type DialogKind = "close" | "requestCancel" | "cancel" | "dismissCancel" | null;

/**
 * Phase 4 Operations Frontend — every action here mirrors a real backend
 * transition exactly (DRAFT->SCHEDULED->IN_PROGRESS->COMPLETED->CLOSED,
 * plus the two-step cancellation-request flow); only the transitions valid
 * from the CURRENT status/permission set are rendered — UX convenience
 * only, the server remains the sole enforcer of every precondition (D2/D4/
 * D5/D6). Technician's own SCHEDULED->IN_PROGRESS self-start lives in
 * apps/field, never here — Office Staff+ has no "start" action at all.
 */
export function WorkOrderLifecycleActions({ workOrder, onChanged }: { workOrder: WorkOrder; onChanged: () => void }) {
  const { accessToken, hasPermission } = useAuth();
  const [scheduledDate, setScheduledDate] = useState(workOrder.scheduledDate?.slice(0, 10) ?? "");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpdate = hasPermission("work_orders", "update");
  const canComplete = hasPermission("work_orders", "complete");
  const canClose = hasPermission("work_orders", "close");
  const canRequestCancel = hasPermission("work_orders", "request_cancel");
  const canCancel = hasPermission("work_orders", "cancel");

  const hasOpenCancellationRequest = workOrder.cancellationRequestedAt !== null && workOrder.cancelledAt === null;
  const cancellable = ["DRAFT", "SCHEDULED", "IN_PROGRESS"].includes(workOrder.status);

  async function run(action: () => Promise<unknown>) {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await action();
      setDialog(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {hasOpenCancellationRequest && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Cancellation requested</p>
          {workOrder.cancellationRequestedReason && <p className="mt-1">{workOrder.cancellationRequestedReason}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        {canUpdate && workOrder.status === "DRAFT" && (
          <>
            <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="h-9 w-auto" />
            <Button size="sm" disabled={submitting || !scheduledDate} onClick={() => run(() => scheduleWorkOrder(accessToken!, workOrder.id, scheduledDate))}>
              Schedule
            </Button>
          </>
        )}

        {canComplete && workOrder.status === "IN_PROGRESS" && (
          <Button size="sm" disabled={submitting} onClick={() => run(() => completeWorkOrder(accessToken!, workOrder.id))}>
            Mark Completed
          </Button>
        )}

        {canClose && workOrder.status === "COMPLETED" && (
          <Button size="sm" onClick={() => setDialog("close")}>
            Close Work Order
          </Button>
        )}

        {canRequestCancel && cancellable && !hasOpenCancellationRequest && (
          <Button size="sm" variant="outline" onClick={() => setDialog("requestCancel")}>
            Request Cancellation
          </Button>
        )}

        {canCancel && cancellable && hasOpenCancellationRequest && (
          <Button size="sm" variant="destructive" onClick={() => setDialog("cancel")}>
            Confirm Cancellation
          </Button>
        )}
        {canCancel && cancellable && hasOpenCancellationRequest && (
          <Button size="sm" variant="outline" onClick={() => setDialog("dismissCancel")}>
            Dismiss Request
          </Button>
        )}
        {canCancel && cancellable && !hasOpenCancellationRequest && (
          <Button size="sm" variant="destructive" onClick={() => setDialog("cancel")}>
            Cancel Work Order
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ActionConfirmDialog
        open={dialog === "close"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Close this work order?"
        description="Final administrative sign-off requires a verified Service Report. Review the linked report and any applicable actual costs first."
        reasonMode="none"
        confirmLabel="Close Work Order"
        submitting={submitting}
        error={error}
        onConfirm={() => run(() => closeWorkOrder(accessToken!, workOrder.id))}
      />

      <ActionConfirmDialog
        open={dialog === "requestCancel"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Request cancellation"
        description="This does not cancel the work order by itself — a Manager or Admin/Owner must confirm or dismiss the request."
        reasonMode="required"
        confirmLabel="Request Cancellation"
        submitting={submitting}
        error={error}
        onConfirm={(reason) => run(() => requestCancelWorkOrder(accessToken!, workOrder.id, reason))}
      />

      <ActionConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Cancel this work order?"
        description="This is the final authority to cancel. This cannot be undone."
        reasonMode="required"
        confirmLabel="Cancel Work Order"
        confirmVariant="destructive"
        submitting={submitting}
        error={error}
        onConfirm={(reason) => run(() => cancelWorkOrder(accessToken!, workOrder.id, reason))}
      />

      <ActionConfirmDialog
        open={dialog === "dismissCancel"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Dismiss this cancellation request?"
        description="The work order continues as normal — the request is cleared without cancelling anything."
        reasonMode="none"
        confirmLabel="Dismiss Request"
        submitting={submitting}
        error={error}
        onConfirm={() => run(() => dismissCancellationRequest(accessToken!, workOrder.id))}
      />
    </div>
  );
}
