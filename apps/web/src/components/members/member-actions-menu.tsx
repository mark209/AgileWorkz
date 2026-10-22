"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import type { Member } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function MemberActionsMenu({ member, disabled, onManageAccess, onStatus }: {
  member: Member;
  disabled: boolean;
  onManageAccess: () => void;
  onStatus: (status: Member["status"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    firstActionRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    const closeOnScroll = () => setOpen(false);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnScroll);
    };
  }, [open]);

  function toggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: window.innerHeight - rect.bottom < 140 ? Math.max(8, rect.top - 140) : rect.bottom + 4,
        left: Math.max(8, rect.right - 176),
      });
    }
    setOpen((current) => !current);
  }

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <>
      <Button ref={buttonRef} variant="ghost" size="icon" aria-label={`Actions for ${member.fullName}`} aria-haspopup="true" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={disabled} onClick={toggle}>
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </Button>
      {open && createPortal(
        <div ref={menuRef} id={menuId} role="group" aria-label={`Actions for ${member.fullName}`} className="fixed z-[60] w-44 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md" style={position}>
          <button ref={firstActionRef} type="button" className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => choose(onManageAccess)}>Manage access</button>
          {member.status !== "ACTIVE" && <button type="button" className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => choose(() => onStatus("ACTIVE"))}>Activate account</button>}
          {member.status !== "INACTIVE" && <button type="button" className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => choose(() => onStatus("INACTIVE"))}>Deactivate account</button>}
          {member.status !== "SUSPENDED" && <button type="button" className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => choose(() => onStatus("SUSPENDED"))}>Suspend account</button>}
        </div>, document.body,
      )}
    </>
  );
}
