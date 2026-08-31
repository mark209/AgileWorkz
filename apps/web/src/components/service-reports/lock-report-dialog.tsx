"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export interface LockReportDialogProps {
  onLock: () => Promise<void>;
}

/**
 * Phase 5 Step 7 (Lock) — approved design: confirmation dialog only, no
 * reason/note field, no preview endpoint. Locking is forward-only and
 * permanent — the dialog copy says so explicitly, since there is no undo
 * anywhere in the application once this action completes.
 */
export function LockReportDialog({ onLock }: LockReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLock() {
    setLocking(true);
    setError(null);
    try {
      await onLock();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to lock this report.");
    } finally {
      setLocking(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive">Lock Report</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lock this Service Report?</DialogTitle>
          <DialogDescription>
            This is permanent. Once locked, canonical data can no longer be corrected through the application. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={locking}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleLock} disabled={locking}>
            {locking ? "Locking…" : "Lock Report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
