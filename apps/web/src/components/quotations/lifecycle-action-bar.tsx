"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  approveRevision,
  createNextRevision,
  recordRevisionDecision,
  rejectRevision,
  markRevisionSent,
  submitRevision,
  type QuotationRevision,
  type QuotationType,
} from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";
import { useOutcome, type OutcomeMessage } from "@/components/shared/outcome-provider";

type DialogKind = "submit" | "approve" | "approveFinal" | "reject" | "send" | "accept" | "decline" | "newRevision" | null;

const transitionOutcomes: Partial<Record<QuotationRevision["status"], Omit<OutcomeMessage, "reference">>> = {
  PENDING_APPROVAL: { title: "Quotation submitted for approval", description: "This revision is locked for Manager review." },
  PENDING_OWNER_APPROVAL: { title: "Manager review recorded", description: "Manager review is complete. Owner approval is still required before this quotation can be sent." },
  APPROVED: { title: "Quotation internally approved", description: "The quotation's internal approval is complete. Download the approved PDF and send it to the customer outside the system, then mark it as sent." },
  SENT: { title: "Quotation marked as sent", description: "External delivery has been recorded. This action does not email the customer." },
  ACCEPTED: { title: "Customer acceptance recorded", description: "This revision is commercially final. Use Operations to create its Work Orders or maintenance visits." },
  REJECTED: { title: "Quotation internally rejected", description: "This revision was rejected during internal review. Create a new revision if changes are needed." },
  DECLINED: { title: "Customer decline recorded", description: "The customer declined this revision. Create a new revision if further changes are agreed." },
};

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
  quotationNumber,
  revision,
  lineItemCount,
  quotationType,
  sectionCount = 1,
  maintenanceReady = true,
  hasUnsavedDetails = false,
  onChanged,
  onConflict,
  onNextRevisionCreated,
}: {
  quotationId: string;
  quotationNumber?: string;
  revision: QuotationRevision;
  lineItemCount: number;
  quotationType?: QuotationType;
  sectionCount?: number;
  maintenanceReady?: boolean;
  hasUnsavedDetails?: boolean;
  onChanged: () => void;
  onConflict: () => void;
  onNextRevisionCreated: (newRevisionId: string) => void;
}) {
  const { accessToken, hasPermission } = useAuth();
  const { showOutcome } = useOutcome();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingRevision, setCreatingRevision] = useState(false);

  const canApprove = hasPermission("quotations", "approve");
  const canReject = hasPermission("quotations", "reject");
  // Two-level approval correction — the Owner-only Level 2 actions. Holding
  // the base approve/reject permission (which Owner also has, via
  // Admin/Owner's full grant) is NOT sufficient here — a Manager-only user
  // must not see these buttons at all, since the server itself would 403
  // them if they tried. This mirrors the server's own enforcement, it does
  // not replace it (D4 — the server remains the sole real enforcer).
  const canApproveFinal = hasPermission("quotations", "approve_final");
  const canRejectFinal = hasPermission("quotations", "reject_final");
  const canUpdate = hasPermission("quotations", "update");
  const canCreate = hasPermission("quotations", "create");
  const hasPlaceholderTerms = revision.termsAndConditions?.includes("[PLACEHOLDER") ?? false;

  function openDialog(kind: Exclude<DialogKind, null>) {
    setError(null);
    setDialog(kind);
  }

  async function run(action: () => Promise<QuotationRevision>) {
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await action();
      setDialog(null);
      const outcome = transitionOutcomes[result.status];
      if (outcome) showOutcome({ ...outcome, reference: quotationNumber });
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
      setDialog(null);
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
        <Button onClick={() => openDialog("submit")} disabled={submitting || lineItemCount === 0 || hasUnsavedDetails || !maintenanceReady || (quotationType === "PROJECT" && sectionCount === 0)}>
          Submit for Approval
        </Button>
        {lineItemCount === 0 && <p className="text-xs text-muted-foreground">Add at least one line item first.</p>}
        {!maintenanceReady && <p className="text-xs text-muted-foreground">Complete the maintenance contract details before submitting.</p>}
        {quotationType === "PROJECT" && sectionCount === 0 && <p className="text-xs text-muted-foreground">Add a project section before submitting.</p>}
        {hasUnsavedDetails && <p className="text-xs text-muted-foreground">Wait for details and commercial terms to save before submitting.</p>}
      </div>,
    );
  }

  if (revision.status === "PENDING_APPROVAL") {
    // Level 1 (Manager). The server decides, from totalAmount, whether this
    // approval finalizes the revision (<=50k) or only advances it to
    // PENDING_OWNER_APPROVAL (>50k) — the button and call are the same
    // either way, no client-side amount branching needed.
    if (canApprove) {
      buttons.push(
        <Button key="approve" onClick={() => openDialog("approve")} disabled={submitting}>
          Approve internal review
        </Button>,
      );
    }
    if (canReject) {
      buttons.push(
        <Button key="reject" variant="destructive" onClick={() => openDialog("reject")} disabled={submitting}>
          Reject
        </Button>,
      );
    }
  }

  if (revision.status === "PENDING_OWNER_APPROVAL") {
    // Level 2 (Owner) — gated on the separate _final permissions, never on
    // canApprove/canReject, so a Manager-only user (who holds the base
    // permission but not this one) sees no button here at all, matching
    // what the server would 403 if they tried anyway.
    if (canApproveFinal) {
      buttons.push(
        <Button key="approve-final" onClick={() => openDialog("approveFinal")} disabled={submitting}>
          Give final approval
        </Button>,
      );
    }
    if (canRejectFinal) {
      buttons.push(
        <Button key="reject-final" variant="destructive" onClick={() => openDialog("reject")} disabled={submitting}>
          Final Reject (Owner)
        </Button>,
      );
    }
  }

  if (revision.status === "APPROVED" && canUpdate) {
    buttons.push(
      <Button key="send" onClick={() => openDialog("send")} disabled={submitting || hasPlaceholderTerms}>
        Mark as sent
      </Button>,
    );
  }

  if (revision.status === "SENT" && canUpdate) {
    buttons.push(
      <Button key="accept" onClick={() => openDialog("accept")} disabled={submitting}>
        Customer Accepted
      </Button>,
      <Button key="decline" variant="destructive" onClick={() => openDialog("decline")} disabled={submitting}>
        Customer Declined
      </Button>,
    );
  }

  const canCreateNext = revision.status !== "ACCEPTED" && canCreate;
  const actionTitle = revision.status === "DRAFT" || revision.status === "PENDING_APPROVAL" || revision.status === "PENDING_OWNER_APPROVAL"
    ? "Internal approval"
    : revision.status === "APPROVED" ? "Send quotation" : revision.status === "SENT" ? "Customer decision" : "Revision actions";
  const actionDescription = revision.status === "APPROVED"
    ? hasPlaceholderTerms
      ? canCreate
        ? "This approved revision still contains placeholder Terms & Conditions. Create a new revision, replace the placeholder, then submit and approve it again before marking it as sent."
        : "This approved revision still contains placeholder Terms & Conditions. Ask an authorized colleague to create a new revision and replace the placeholder before sending."
      : "Download the approved PDF, send it to the customer outside the system, then mark this revision as sent."
    : revision.status === "SENT"
      ? "Record the customer's response to this sent revision."
      : revision.status === "PENDING_OWNER_APPROVAL"
        ? "Manager review is complete. Owner approval is required before this revision can be sent."
        : revision.status === "PENDING_APPROVAL"
          ? "A Manager must review this revision before it can be sent."
          : revision.status === "DRAFT"
            ? "Submit this draft when its details and line items are ready for review."
            : undefined;

  return (
    <Card className="shadow-none">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base">{actionTitle}</CardTitle>
        {actionDescription && <p className="text-sm text-muted-foreground">{actionDescription}</p>}
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-0">
        {buttons.length === 0 && !canCreateNext && (
          <p className="text-sm text-muted-foreground">
            {revision.status === "ACCEPTED"
              ? "This quotation has been accepted — it is commercially final."
              : "No actions are available for this revision with your current permissions."}
          </p>
        )}
        {buttons}
        {canCreateNext && (
          <Button variant="outline" onClick={() => openDialog("newRevision")} disabled={creatingRevision || hasUnsavedDetails}>
            {creatingRevision ? "Creating…" : "Create New Revision"}
          </Button>
        )}
        {error && <p className="w-full text-sm text-destructive">{error}</p>}
      </CardContent>

      <ActionConfirmDialog
        open={dialog === "submit"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Submit quotation for approval?"
        description="This locks the current revision and sends it for internal review."
        reasonMode="none"
        confirmLabel="Submit for approval"
        submitting={submitting}
        error={error}
        onConfirm={() => run(() => submitRevision(accessToken!, quotationId, revision.id))}
      />
      <ActionConfirmDialog
        open={dialog === "approve" || dialog === "approveFinal"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog === "approveFinal" ? "Give final approval?" : "Approve internal review?"}
        description={dialog === "approveFinal" ? "This completes the internal approval required before the quotation can be sent." : "The approval threshold determines whether Owner approval is also required."}
        reasonMode="none"
        confirmLabel={dialog === "approveFinal" ? "Give final approval" : "Approve review"}
        submitting={submitting}
        error={error}
        onConfirm={() => run(() => approveRevision(accessToken!, quotationId, revision.id))}
      />
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
        title="Mark quotation as sent?"
        description="Download the approved PDF and send it outside this system first. This action records that you have sent this exact revision; it does not email the customer."
        reasonMode="none"
        confirmLabel="Mark as sent"
        submitting={submitting}
        error={error}
        onConfirm={() => run(() => markRevisionSent(accessToken!, quotationId, revision.id))}
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
        title="Are you sure you want to decline this quotation?"
        description="A reason is optional but helpful for follow-up."
        reasonMode="optional"
        confirmLabel="Confirm Declined"
        confirmVariant="destructive"
        submitting={submitting}
        error={error}
        onConfirm={(reason) => run(() => recordRevisionDecision(accessToken!, quotationId, revision.id, "DECLINED", reason || undefined))}
      />
      <ActionConfirmDialog
        open={dialog === "newRevision"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Create a new revision?"
        description="This starts a new draft revision for further changes and approval."
        reasonMode="none"
        confirmLabel="Create new revision"
        submitting={creatingRevision}
        error={error}
        onConfirm={handleCreateNextRevision}
      />
    </Card>
  );
}
