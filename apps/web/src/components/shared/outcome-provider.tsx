"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export interface OutcomeMessage {
  title: string;
  description: string;
  reference?: string;
}

const OutcomeContext = createContext<{ showOutcome: (message: OutcomeMessage) => void } | null>(null);

// Mounted above navigation so a saved result survives its source page refreshing
// or navigating to the newly created record.
export function OutcomeProvider({ children }: { children: ReactNode }) {
  const [outcome, setOutcome] = useState<OutcomeMessage | null>(null);
  const showOutcome = useCallback((message: OutcomeMessage) => setOutcome(message), []);
  return (
    <OutcomeContext.Provider value={{ showOutcome }}>
      {children}
      <Dialog open={outcome !== null} onOpenChange={(open) => { if (!open) setOutcome(null); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-xl text-center motion-reduce:animate-none motion-reduce:duration-0">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
            <CheckCircle2 className="h-10 w-10 motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-300" />
          </div>
          <DialogTitle className="text-xl">{outcome?.title}</DialogTitle>
          {outcome?.reference && <p className="break-words text-sm font-semibold text-primary">{outcome.reference}</p>}
          <DialogDescription className="leading-relaxed">{outcome?.description}</DialogDescription>
          <Button className="mt-2 min-h-11 w-full" onClick={() => setOutcome(null)}>Done</Button>
        </DialogContent>
      </Dialog>
    </OutcomeContext.Provider>
  );
}

export function useOutcome() {
  const context = useContext(OutcomeContext);
  if (!context) throw new Error("useOutcome requires OutcomeProvider");
  return context;
}
