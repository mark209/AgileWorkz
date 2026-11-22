"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { colors, primaryButton } from "../lib/styles";

export interface OutcomeMessage {
  title: string;
  description: string;
  reference?: string;
}

const OutcomeContext = createContext<{ showOutcome: (message: OutcomeMessage) => void } | null>(null);

function OutcomeDialog({ outcome, dismiss }: { outcome: OutcomeMessage; dismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} className="outcome-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); dismiss(); }}>
      <style>{`
        .outcome-dialog { width: calc(100% - 32px); max-width: 416px; max-height: calc(100dvh - 32px); overflow: auto; border: 1px solid ${colors.border}; border-radius: 16px; padding: 28px 24px 24px; color: #183c33; background: white; text-align: center; box-shadow: 0 24px 70px #0003; }
        .outcome-dialog::backdrop { background: #142f2a88; }
        @keyframes outcome-enter { from { opacity: 0; transform: translateY(8px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes outcome-check { from { stroke-dashoffset: 30; } to { stroke-dashoffset: 0; } }
        @media (prefers-reduced-motion: no-preference) { .outcome-dialog[open] { animation: outcome-enter 220ms ease-out; } .outcome-check { stroke-dasharray: 30; animation: outcome-check 380ms ease-out; } }
      `}</style>
      <div aria-hidden="true" style={{ margin: "0 auto 16px", width: 64, height: 64, color: colors.green, borderRadius: "50%", background: "#e9f5f1", display: "grid", placeItems: "center" }}>
        <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="24" cy="24" r="19" /><path className="outcome-check" d="m15 24 6 6 12-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <h2 id={titleId} style={{ fontSize: 22, margin: "0 0 12px" }}>{outcome.title}</h2>
      {outcome.reference && <p style={{ fontWeight: 600, color: colors.green, overflowWrap: "anywhere" }}>{outcome.reference}</p>}
      <p id={descriptionId} style={{ color: colors.textMuted, fontSize: 15, lineHeight: 1.6, margin: "0 0 24px" }}>{outcome.description}</p>
      <button type="button" autoFocus style={{ ...primaryButton, width: "100%" }} onClick={dismiss}>Done</button>
    </dialog>
  );
}

export function OutcomeProvider({ children }: { children: ReactNode }) {
  const [outcome, setOutcome] = useState<OutcomeMessage | null>(null);
  const showOutcome = useCallback((message: OutcomeMessage) => setOutcome(message), []);
  const dismiss = useCallback(() => setOutcome(null), []);
  return <OutcomeContext.Provider value={{ showOutcome }}>{children}{outcome && <OutcomeDialog outcome={outcome} dismiss={dismiss} />}</OutcomeContext.Provider>;
}

export function useOutcome() {
  const context = useContext(OutcomeContext);
  if (!context) throw new Error("useOutcome requires OutcomeProvider");
  return context;
}
