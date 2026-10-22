"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { approveRegistration, declineRegistration, listMemberRoles, listMembers, listPendingRegistrations, setMemberStatus, type Member, type MemberRole, type PendingRegistration } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { ActionConfirmDialog } from "@/components/shared/action-confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, LoadingState } from "@/components/shared/states";
import { AddMemberDialog, ManageAccessDialog } from "@/components/members/member-dialogs";
import { MemberActionsMenu } from "@/components/members/member-actions-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const statusLabels: Record<Member["status"], string> = { ACTIVE: "Active", INACTIVE: "Inactive", SUSPENDED: "Suspended" };
const statusVariants: Record<Member["status"], "success" | "neutral" | "warning"> = { ACTIVE: "success", INACTIVE: "neutral", SUSPENDED: "warning" };
const statusActions: Record<Member["status"], string> = { ACTIVE: "Activate", INACTIVE: "Deactivate", SUSPENDED: "Suspend" };

export default function MembersPage() {
  const { user, accessToken, hasPermission, isLoading } = useAuth();
  const router = useRouter();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [pending, setPending] = useState<PendingRegistration[] | null>(null);
  const [roles, setRoles] = useState<MemberRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("members");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [accessMemberId, setAccessMemberId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ member: Member; status: Member["status"] } | null>(null);
  const canManage = !!user?.roles.includes("Admin/Owner") && hasPermission("users", "manage");

  useEffect(() => { if (!isLoading && !user) router.replace("/login"); }, [isLoading, user, router]);

  const load = useCallback(async () => {
    if (!accessToken || !canManage) return false;
    setError(null);
    try {
      const [nextMembers, nextRoles, nextPending] = await Promise.all([
        listMembers(accessToken), listMemberRoles(accessToken), listPendingRegistrations(accessToken),
      ]);
      setMembers(nextMembers);
      setRoles(nextRoles);
      setPending(nextPending);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load members.");
      return false;
    }
  }, [accessToken, canManage]);
  useEffect(() => { load(); }, [load]);

  async function act(action: () => Promise<unknown>, message: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(null); setSuccess(null);
    try {
      await action();
      const refreshed = await load();
      setSuccess(refreshed ? message : `${message} Refresh the list to see the latest data.`);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const filteredMembers = members?.filter((member) => {
    const query = search.trim().toLocaleLowerCase();
    return (!query || member.fullName.toLocaleLowerCase().includes(query) || member.email.toLocaleLowerCase().includes(query))
      && (!roleFilter || member.userRoles.some(({ role }) => role.id === roleFilter))
      && (!statusFilter || member.status === statusFilter);
  });
  const selectedMember = members?.find((member) => member.id === accessMemberId) ?? null;

  if (isLoading || !user) return <LoadingState />;
  if (!canManage) return <div className="mx-auto max-w-4xl p-6"><ErrorState message="You do not have permission to manage members." /></div>;

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Members" description="Manage employees, roles, and access." actions={<AddMemberDialog onCreated={async () => { const refreshed = await load(); setSuccess(refreshed ? "Member created." : "Member created. Refresh the list to see the latest data."); }} />} />
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><span>{error}</span><Button variant="outline" size="sm" onClick={load}>Try again</Button></div>}
      {success && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{success}</p>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Member views" className="h-auto max-w-full justify-start overflow-x-auto bg-transparent p-0">
          <TabsTrigger value="members" className="rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-primary data-[state=active]:shadow-none">All Members ({members?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="requests" className="rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-primary data-[state=active]:shadow-none">Registration Requests ({pending?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Search members by name or email" placeholder="Search name or email…" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" />
            </div>
            <Select aria-label="Filter by role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="sm:w-44">
              <option value="">All roles</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </Select>
            <Select aria-label="Filter by account status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="sm:w-44">
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="SUSPENDED">Suspended</option>
            </Select>
          </div>
          <div className="overflow-hidden rounded-lg border bg-card">
            {members === null && !error ? <LoadingState label="Loading members…" /> : members?.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No members found. Add a member to get started.</p>
            ) : filteredMembers?.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No members match your search or filters.</p>
            ) : (
              <Table className="min-w-[620px]">
                <TableHeader><TableRow><TableHead className="w-[38%] px-4">Member</TableHead><TableHead className="w-[32%]">Assigned Roles</TableHead><TableHead>Account Status</TableHead><TableHead className="w-16 text-right">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{filteredMembers?.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="px-4 py-3"><div className="min-w-0"><p className="font-medium">{member.fullName}</p><p className="break-all text-xs text-muted-foreground">{member.email}</p></div></TableCell>
                    <TableCell><div className="flex flex-wrap gap-1">{member.userRoles.length === 0 ? <span className="text-xs text-muted-foreground">No roles</span> : member.userRoles.map(({ role }) => <Badge key={role.id} variant="secondary" className="font-medium">{role.name}</Badge>)}</div></TableCell>
                    <TableCell><Badge variant={statusVariants[member.status]}>{statusLabels[member.status]}</Badge></TableCell>
                    <TableCell className="text-right"><MemberActionsMenu member={member} disabled={busy} onManageAccess={() => setAccessMemberId(member.id)} onStatus={(status) => setStatusTarget({ member, status })} /></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="requests">
          <div className="overflow-hidden rounded-lg border bg-card">
            {pending === null && !error ? <LoadingState label="Loading registration requests…" /> : pending?.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No requests are awaiting review.</p>
            ) : (
              <Table className="min-w-[680px]">
                <TableHeader><TableRow><TableHead className="px-4">Applicant</TableHead><TableHead>Requested Designation</TableHead><TableHead>Final Role</TableHead><TableHead className="text-right">Review</TableHead></TableRow></TableHeader>
                <TableBody>{pending?.map((request) => <PendingRegistrationRow key={request.id} request={request} roles={roles} busy={busy}
                  onApprove={(roleId) => accessToken ? act(() => approveRegistration(accessToken, request.id, roleId), "Registration approved. The member can now sign in.") : Promise.resolve(false)}
                  onDecline={() => accessToken ? act(() => declineRegistration(accessToken, request.id), "Registration declined and removed.") : Promise.resolve(false)} />)}</TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <ManageAccessDialog member={selectedMember} roles={roles} onClose={() => setAccessMemberId(null)} onChanged={load} />
      <ActionConfirmDialog open={statusTarget !== null} onOpenChange={(next) => { if (!next) setStatusTarget(null); }}
        title={`${statusTarget ? statusActions[statusTarget.status] : "Change"} ${statusTarget?.member.fullName ?? "member"}'s account?`}
        description="This changes the member's ability to sign in immediately."
        reasonMode="none" confirmLabel={statusTarget ? `${statusActions[statusTarget.status]} account` : "Confirm"}
        confirmVariant={statusTarget?.status === "ACTIVE" ? "default" : "destructive"} submitting={busy} error={error}
        onConfirm={async () => { if (statusTarget && accessToken && await act(() => setMemberStatus(accessToken, statusTarget.member.id, statusTarget.status), "Member status updated.")) setStatusTarget(null); }} />
    </main>
  );
}

function PendingRegistrationRow({ request, roles, busy, onApprove, onDecline }: {
  request: PendingRegistration; roles: MemberRole[]; busy: boolean;
  onApprove: (roleId: string) => Promise<boolean>; onDecline: () => Promise<boolean>;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [declineOpen, setDeclineOpen] = useState(false);
  return <TableRow>
    <TableCell className="px-4 py-3"><p className="font-medium">{request.fullName}</p><p className="break-all text-xs text-muted-foreground">{request.email}{request.phone ? ` · ${request.phone}` : ""}</p></TableCell>
    <TableCell><Badge variant="secondary">{request.requestedRole.name}</Badge></TableCell>
    <TableCell><div className="min-w-[150px]"><Label className="sr-only" htmlFor={`final-role-${request.id}`}>Final role</Label><Select id={`final-role-${request.id}`} value={selectedRoleId} disabled={busy} onChange={(event) => setSelectedRoleId(event.target.value)}><option value="">Select final role…</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</Select></div></TableCell>
    <TableCell><div className="flex justify-end gap-2"><Button size="sm" disabled={busy || !selectedRoleId} onClick={() => onApprove(selectedRoleId)}>Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setDeclineOpen(true)}>Decline</Button></div>
      <ActionConfirmDialog open={declineOpen} onOpenChange={setDeclineOpen} title={`Decline ${request.fullName}'s request?`} description="This removes the pending request. No member account will be created." reasonMode="none" confirmLabel="Decline request" confirmVariant="destructive" submitting={busy} error={null} onConfirm={async () => { if (await onDecline()) setDeclineOpen(false); }} />
    </TableCell>
  </TableRow>;
}
