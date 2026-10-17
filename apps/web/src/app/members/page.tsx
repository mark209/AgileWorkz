"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { approveRegistration, assignMemberRole, createMember, declineRegistration, listMemberRoles, listMembers, listPendingRegistrations, revokeMemberRole, setMemberStatus, type Member, type MemberRole, type PendingRegistration } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";

export default function MembersPage() {
  const { user, accessToken, hasPermission, isLoading } = useAuth();
  const router = useRouter();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [pending, setPending] = useState<PendingRegistration[] | null>(null);
  const [roles, setRoles] = useState<MemberRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const canManage = !!user?.roles.includes("Admin/Owner") && hasPermission("users", "manage");

  useEffect(() => { if (!isLoading && !user) router.replace("/login"); }, [isLoading, user, router]);

  const load = useCallback(async () => {
    if (!accessToken || !canManage) return;
    setError(null);
    try {
      const [nextMembers, nextRoles, nextPending] = await Promise.all([listMembers(accessToken), listMemberRoles(accessToken), listPendingRegistrations(accessToken)]);
      setMembers(nextMembers);
      setRoles(nextRoles);
      setPending(nextPending);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Failed to load members."); }
  }, [accessToken, canManage]);
  useEffect(() => { load(); }, [load]);

  async function act(action: () => Promise<unknown>, message: string): Promise<boolean> {
    setBusy(true); setError(null); setSuccess(null);
    try { await action(); await load(); setSuccess(message); return true; }
    catch (e) { setError(e instanceof ApiError ? e.message : "The change could not be saved."); return false; }
    finally { setBusy(false); }
  }

  function create(event: FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    act(async () => {
      await createMember(accessToken, { fullName, email, phone: phone || undefined, password });
      setFullName(""); setEmail(""); setPhone(""); setPassword("");
    }, "Member created.");
  }

  if (isLoading || !user) return <LoadingState />;
  if (!canManage) return <div className="mx-auto max-w-4xl p-6"><ErrorState message="You do not have permission to manage members." /></div>;

  return <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
    <PageHeader title="Members" description="Manage company members and their existing role assignments." />
    {error && <div role="alert"><ErrorState message={error} onRetry={load} /></div>}
    {success && <p role="status" className="text-sm text-primary">{success}</p>}
    <Card><CardHeader><CardTitle>Registration requests</CardTitle></CardHeader><CardContent className="space-y-3">
      {pending === null && !error && <LoadingState label="Loading registration requests…" />}
      {pending?.length === 0 && <p className="text-sm text-muted-foreground">No requests are awaiting review.</p>}
      {pending?.map((request) => <PendingRegistrationRow key={request.id} request={request} roles={roles} busy={busy}
        onApprove={(roleId) => accessToken ? act(() => approveRegistration(accessToken, request.id, roleId), "Registration approved. The member can now sign in.") : Promise.resolve(false)}
        onDecline={() => accessToken ? act(() => declineRegistration(accessToken, request.id), "Registration declined and removed.") : Promise.resolve(false)} />)}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Add member</CardTitle></CardHeader><CardContent>
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="member-name">Name</Label><Input id="member-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required /></div>
        <div><Label htmlFor="member-email">Email</Label><Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><Label htmlFor="member-phone">Phone (optional)</Label><Input id="member-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><Label htmlFor="member-password">Temporary password</Label><Input id="member-password" type="password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <Button disabled={busy} type="submit" className="sm:col-span-2">Create member</Button>
      </form>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Existing members</CardTitle></CardHeader><CardContent className="space-y-4">
      {members === null && !error && <LoadingState label="Loading members…" />}
      {members?.length === 0 && <p className="text-sm text-muted-foreground">No members found.</p>}
      {members?.map((member) => <MemberRow key={member.id} member={member} roles={roles} busy={busy}
        onStatus={(status) => accessToken && act(() => setMemberStatus(accessToken, member.id, status), "Member status updated.")}
        onAssign={(roleId) => accessToken && act(() => assignMemberRole(accessToken, member.id, roleId), "Role assigned.")}
        onRevoke={(roleId) => accessToken && act(() => revokeMemberRole(accessToken, member.id, roleId), "Role removed.")} />)}
    </CardContent></Card>
  </div>;
}

function PendingRegistrationRow({ request, roles, busy, onApprove, onDecline }: {
  request: PendingRegistration; roles: MemberRole[]; busy: boolean;
  onApprove: (roleId: string) => Promise<boolean>; onDecline: () => Promise<boolean>;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [declineOpen, setDeclineOpen] = useState(false);
  return <div className="space-y-3 rounded-md border p-4 text-sm">
    <div><strong>{request.fullName}</strong><p className="text-muted-foreground">{request.email}{request.phone ? ` · ${request.phone}` : ""}</p></div>
    <p>Requested designation: <strong>{request.requestedRole.name}</strong></p>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1 space-y-1"><Label htmlFor={`final-role-${request.id}`}>Final role</Label>
        <Select id={`final-role-${request.id}`} value={selectedRoleId} disabled={busy} onChange={(event) => setSelectedRoleId(event.target.value)}>
          <option value="">Select final role…</option>
          {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </Select>
      </div>
      <Button disabled={busy || !selectedRoleId} onClick={() => onApprove(selectedRoleId)}>Approve</Button>
      <Button variant="outline" disabled={busy} onClick={() => setDeclineOpen(true)}>Decline</Button>
    </div>
    <ActionConfirmDialog open={declineOpen} onOpenChange={setDeclineOpen} title={`Decline ${request.fullName}'s request?`}
      description="This removes the pending request. No member account will be created."
      reasonMode="none" confirmLabel="Decline request" confirmVariant="destructive" submitting={busy} error={null}
      onConfirm={async () => { if (await onDecline()) setDeclineOpen(false); }} />
  </div>;
}

function MemberRow({ member, roles, busy, onStatus, onAssign, onRevoke }: {
  member: Member; roles: MemberRole[]; busy: boolean;
  onStatus: (status: Member["status"]) => void;
  onAssign: (roleId: string) => void; onRevoke: (roleId: string) => void;
}) {
  const [selectedRole, setSelectedRole] = useState("");
  const assigned = new Set(member.userRoles.map((entry) => entry.role.id));
  return <div className="space-y-3 rounded-md border p-4 text-sm">
    <div><strong>{member.fullName}</strong><p className="text-muted-foreground">{member.email}</p></div>
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={`status-${member.id}`}>Status</Label>
      <Select id={`status-${member.id}`} value={member.status} disabled={busy} onChange={(event) => onStatus(event.target.value as Member["status"])}>
        <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="SUSPENDED">Suspended</option>
      </Select>
    </div>
    <div className="flex flex-wrap gap-2">
      {member.userRoles.map(({ role }) => <span key={role.id} className="inline-flex items-center gap-2 rounded border px-2 py-1">
        {role.name}<Button size="sm" variant="outline" disabled={busy} onClick={() => onRevoke(role.id)}>Remove</Button>
      </span>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={`Assign role to ${member.fullName}`} value={selectedRole} disabled={busy} onChange={(event) => setSelectedRole(event.target.value)}>
        <option value="">Select role…</option>
        {roles.filter((role) => !assigned.has(role.id)).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
      </Select>
      <Button size="sm" disabled={busy || !selectedRole} onClick={() => { onAssign(selectedRole); setSelectedRole(""); }}>Assign role</Button>
    </div>
  </div>;
}
