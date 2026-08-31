"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// One shared confirmation dialog for every Step 7 lifecycle action that
// needs user confirmation before firing — reject/expire (reason mandatory,
// D5), customer decline (reason optional, D5), and any other action that
// just needs a "are you sure" without a reason field at all. Centralizing
// this means the required/optional reason contract can't drift between
// screens.
export interface ActionConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  reasonMode: "none" | "optional" | "required";
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  submitting: boolean;
  error: string | null;
  onConfirm: (reason: string) => void | Promise<void>;
}

export function ActionConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  reasonMode,
  confirmLabel,
  confirmVariant = "default",
  submitting,
  error,
  onConfirm,
}: ActionConfirmDialogProps) {
  const [reason, setReason] = useState("");

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setReason("");
  }

  const canSubmit = reasonMode !== "required" || reason.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {reasonMode !== "none" && (
          <div className="space-y-1.5">
            <Label htmlFor="action-confirm-reason">Reason {reasonMode === "optional" ? "(optional)" : ""}</Label>
            <Textarea
              id="action-confirm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={reasonMode === "required" ? "Required — explain why" : "Optional"}
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant={confirmVariant} disabled={submitting || !canSubmit} onClick={() => onConfirm(reason.trim())}>
            {submitting ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
