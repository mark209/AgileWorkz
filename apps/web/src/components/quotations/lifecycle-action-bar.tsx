"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  approveRevision,
  createNextRevision,
  expireRevision,
  recordRevisionDecision,
  rejectRevision,
  sendRevision,
  submitRevision,
  type QuotationRevision,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";

type DialogKind = "reject" | "send" | "accept" | "decline" | "expire" | null;

// Contextual lifecycle actions — only the transitions valid from the
// CURRENT revision's CURRENT status are rendered, mirroring the backend's
// own precondition guards (§10/Step 7). This is UX convenience only; every
// action still goes through the real endpoint, which remains the sole
// enforcer (D4).
//
// A stale/concurrent transition surfaces as EITHER a 409 (the atomic
// updateMany guard lost a true simultaneous race) OR a 400 whose message
// contains "— this revision is " (the ordinary precondition check already
// saw the new status because enough time passed since this view was
// loaded — the far more common case in practice). Both mean the same thing
// to the user — "someone else already acted on this" — so both get the
// same friendly onConflict() treatment (message + refetch) rather than
// showing a raw validation error for one and a nice message for the other.
// The substring is authored verbatim in quotations.service.ts's own
// precondition messages (e.g. "Only a PENDING_APPROVAL revision can be
// approved — this revision is APPROVED"), so matching it here is matching
// this app's own contract, not guessing at someone else's wording.
function isStaleStatusError(e: unknown): e is ApiError {
  return e instanceof ApiError && (e.status === 409 || (e.status === 400 && e.message.includes("— this revision is ")));
}
export function LifecycleActionBar({
  quotationId,
  revision,
  lineItemCount,
  onChanged,
  onConflict,
  onNextRevisionCreated,
}: {
  quotationId: string;
  revision: QuotationRevision;
  lineItemCount: number;
  onChanged: () => void;
  onConflict: () => void;
  onNextRevisionCreated: (newRevisionId: string) => void;
}) {
  const { accessToken, hasPermission } = useAuth();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingRevision, setCreatingRevision] = useState(false);

  const canApprove = hasPermission("quotations", "approve");
  const canReject = hasPermission("quotations", "reject");
  const canUpdate = hasPermission("quotations", "update");
  const canCreate = hasPermission("quotations", "create");

  async function run(action: () => Promise<unknown>) {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await action();
      setDialog(null);
      onChanged();
    } catch (e) {
      if (isStaleStatusError(e)) {
        setDialog(null);
        onConflict();
        return;
      }
      setError(e instanceof ApiError ? e.message : "Action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateNextRevision() {
    if (!accessToken) return;
    setCreatingRevision(true);
    setError(null);
    try {
      const next = await createNextRevision(accessToken, quotationId);
      onNextRevisionCreated(next.id);
    } catch (e) {
      if (isStaleStatusError(e)) {
        onConflict();
      } else {
        setError(e instanceof ApiError ? e.message : "Failed to create the next revision.");
      }
    } finally {
      setCreatingRevision(false);
    }
  }

  const buttons: React.ReactNode[] = [];

  if (revision.status === "DRAFT" && canUpdate) {
    buttons.push(
      <div key="submit" className="flex flex-col items-start gap-1">
        <Button onClick={() => run(() => submitRevision(accessToken!, quotationId, revision.id))} disabled={submitting || lineItemCount === 0}>
          Submit for Approval
        </Button>
        {lineItemCount === 0 && <p className="text-xs text-muted-foreground">Add at least one line item first.</p>}
      </div>,
    );
  }

  if (revision.status === "PENDING_APPROVAL") {
    if (canApprove) {
      buttons.push(
        <Button key="approve" onClick={() => run(() => approveRevision(accessToken!, quotationId, revision.id))} disabled={submitting}>
          Approve
        </Button>,
      );
    }
    if (canReject) {
      buttons.push(
        <Button key="reject" variant="destructive" onClick={() => setDialog("reject")} disabled={submitting}>
          Reject
        </Button>,
      );
    }
  }

  if (revision.status === "APPROVED" && canUpdate) {
    buttons.push(
      <Button key="send" onClick={() => setDialog("send")} disabled={submitting}>
        Send to Customer
      </Button>,
    );
  }

  if (revision.status === "SENT" && canUpdate) {
    buttons.push(
      <Button key="accept" onClick={() => setDialog("accept")} disabled={submitting}>
        Record: Customer Accepted
      </Button>,
      <Button key="decline" variant="outline" onClick={() => setDialog("decline")} disabled={submitting}>
        Record: Customer Declined
      </Button>,
      <Button key="expire" variant="outline" onClick={() => setDialog("expire")} disabled={submitting}>
        Mark Expired
      </Button>,
    );
  }

  const canCreateNext = revision.status !== "ACCEPTED" && canCreate;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 pt-6">
        {buttons.length === 0 && !canCreateNext && (
          <p className="text-sm text-muted-foreground">
            {revision.status === "ACCEPTED"
              ? "This quotation has been accepted — it is commercially final."
              : "No actions are available for this revision with your current permissions."}
          </p>
        )}
        {buttons}
        {canCreateNext && (
          <Button variant="outline" onClick={handleCreateNextRevision} disabled={creatingRevision}>
            {creatingRevision ? "Creating…" : "Create New Revision"}
          </Button>
        )}
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </CardContent>

      <ActionConfirmDialog
        open={dialog === "reject"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Reject this revision"
        description="Internal rejection — the customer never saw this revision. A reason is required."
        reasonMode="required"
        confirmLabel="Reject"
        confirmVariant="destructive"
        submitting={submitting}
        error={error}
        onConfirm={(reason) => run(() => rejectRevision(accessToken!, quotationId, revision.id, reason))}
      />
      <ActionConfirmDialog
        open={dialog === "send"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Send this quotation to the customer"
        description="This marks the revision as SENT. Make sure the details and terms are final."
        reasonMode="none"
        confirmLabel="Send"
        submitting={submitting}
        error={error}
        onConfirm={() => run(() => sendRevision(accessToken!, quotationId, revision.id))}
      />
      <ActionConfirmDialog
        open={dialog === "accept"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Record customer acceptance"
        description="This is a terminal state — the revision becomes commercially final."
        reasonMode="none"
        confirmLabel="Confirm Accepted"
        submitting={submitting}
        error={error}
        onConfirm={() => run(() => recordRevisionDecision(accessToken!, quotationId, revision.id, "ACCEPTED"))}
      />
      <ActionConfirmDialog
        open={dialog === "decline"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Record customer decline"
        description="A reason is optional but helpful for follow-up."
        reasonMode="optional"
        confirmLabel="Confirm Declined"
        confirmVariant="destructive"
        submitting={submitting}
        error={error}
        onConfirm={(reason) => run(() => recordRevisionDecision(accessToken!, quotationId, revision.id, "DECLINED", reason || undefined))}
      />
      <ActionConfirmDialog
        open={dialog === "expire"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Mark this revision as expired"
        description="Can be used even before the stated valid-until date. A reason is required."
        reasonMode="required"
        confirmLabel="Mark Expired"
        confirmVariant="destructive"
        submitting={submitting}
        error={error}
        onConfirm={(reason) => run(() => expireRevision(accessToken!, quotationId, revision.id, reason))}
      />
    </Card>
  );
}
