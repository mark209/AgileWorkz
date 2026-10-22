"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { assignMemberRole, createMember, revokeMemberRole, type Member, type MemberRole } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function AddMemberDialog({ onCreated }: { onCreated: () => Promise<void> }) {
  const { accessToken } = useAuth();
  const nameRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFullName(""); setEmail(""); setPhone(""); setPassword(""); setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!accessToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createMember(accessToken, { fullName, email, phone: phone || undefined, password });
      await onCreated();
      setOpen(false);
      reset();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (busy && !next) return; setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4" aria-hidden="true" /> Add Member</Button></DialogTrigger>
      <DialogContent onOpenAutoFocus={(event) => { event.preventDefault(); nameRef.current?.focus(); }}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add member</DialogTitle>
            <DialogDescription>Create an employee account. Roles can be assigned after creation.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="member-name">Full Name</Label><Input ref={nameRef} id="member-name" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="member-email">Email</Label><Input id="member-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <div className="space-y-1.5"><Label htmlFor="member-phone">Phone (optional)</Label><Input id="member-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="member-password">Temporary Password</Label><Input id="member-password" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} required /><p className="text-xs text-muted-foreground">At least 12 characters.</p></div>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create member"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ManageAccessDialog({ member, roles, onClose, onChanged }: {
  member: Member | null;
  roles: MemberRole[];
  onClose: () => void;
  onChanged: () => Promise<boolean>;
}) {
  const { accessToken } = useAuth();
  const selectRef = useRef<HTMLSelectElement>(null);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [confirmAssignRole, setConfirmAssignRole] = useState<MemberRole | null>(null);
  const [removeRole, setRemoveRole] = useState<MemberRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSelectedRoleId(""); setConfirmAssignRole(null); setRemoveRole(null); setError(null); setMessage(null);
  }, [member?.id]);

  if (!member) return null;
  const assigned = new Set(member.userRoles.map(({ role }) => role.id));
  const availableRoles = roles.filter((role) => !assigned.has(role.id));

  async function change(action: () => Promise<unknown>, successMessage: string) {
    if (!accessToken || busy) return false;
    setBusy(true); setError(null); setMessage(null);
    try {
      await action();
      const refreshed = await onChanged();
      setMessage(refreshed ? successMessage : `${successMessage} Refresh the list to see the latest roles.`);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The role change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(next) => { if (!next && !busy && !removeRole && !confirmAssignRole) onClose(); }}>
        <DialogContent onOpenAutoFocus={(event) => { if (availableRoles.length > 0) { event.preventDefault(); selectRef.current?.focus(); } }}>
          <DialogHeader>
            <DialogTitle>Manage access</DialogTitle>
            <DialogDescription>{member.fullName} · {member.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Assigned roles</h3>
              {member.userRoles.length === 0 ? <p className="text-sm text-muted-foreground">No roles assigned.</p> : (
                <ul className="space-y-2">
                  {member.userRoles.map(({ role }) => <li key={role.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"><Badge variant="secondary">{role.name}</Badge><Button variant="outline" size="sm" disabled={busy} onClick={() => setRemoveRole(role)}>Remove</Button></li>)}
                </ul>
              )}
            </div>
            <div className="space-y-1.5 border-t pt-4">
              <Label htmlFor="member-add-role">Assign another role</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="min-w-0 flex-1"><Select ref={selectRef} id="member-add-role" value={selectedRoleId} disabled={busy || availableRoles.length === 0} onChange={(event) => setSelectedRoleId(event.target.value)}><option value="">Select role…</option>{availableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</Select></div>
                <Button type="button" disabled={busy || !selectedRoleId} onClick={() => setConfirmAssignRole(availableRoles.find((role) => role.id === selectedRoleId) ?? null)}>Assign role</Button>
              </div>
              {availableRoles.length === 0 && <p className="text-xs text-muted-foreground">All available roles are already assigned.</p>}
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
          </div>
          <DialogFooter><Button variant="outline" disabled={busy} onClick={onClose}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <ActionConfirmDialog open={confirmAssignRole !== null} onOpenChange={(next) => { if (!next) setConfirmAssignRole(null); }} title={`Assign ${confirmAssignRole?.name ?? "role"} to ${member.fullName}?`} description="This grants the permissions associated with this role immediately." reasonMode="none" confirmLabel="Assign role" submitting={busy} error={error} onConfirm={async () => {
        if (!confirmAssignRole) return;
        if (await change(() => assignMemberRole(accessToken!, member.id, confirmAssignRole.id), "Role assigned.")) {
          setSelectedRoleId("");
          setConfirmAssignRole(null);
        }
      }} />
      <ActionConfirmDialog open={removeRole !== null} onOpenChange={(next) => { if (!next) setRemoveRole(null); }} title={`Remove ${removeRole?.name ?? "role"} from ${member.fullName}?`} description="This changes the member's access immediately." reasonMode="none" confirmLabel="Remove role" confirmVariant="destructive" submitting={busy} error={error} onConfirm={async () => {
        if (!removeRole) return;
        if (await change(() => revokeMemberRole(accessToken!, member.id, removeRole.id), "Role removed.")) setRemoveRole(null);
      }} />
    </>
  );
}
