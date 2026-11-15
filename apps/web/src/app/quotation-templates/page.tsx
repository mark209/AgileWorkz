"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { createQuotationTemplate, listQuotationTemplates, setQuotationTemplateStatus, type QuotationTermTemplate } from "@/lib/api";
import { ApiError } from "@/lib/api-client";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SAMPLE_TERMS = `1. Scope of work. The work and materials are those listed in this quotation. Any exclusions shown in the quotation remain applicable.
2. Price and tax. The quoted total and tax treatment are as shown in the quotation summary.
3. Payment. The payment schedule follows the Payment Terms shown in this quotation.
4. Schedule. The proposed lead time is shown in this quotation; the actual work date will be confirmed with the customer.
5. Changes. Additional work or materials require a revised quotation or other written customer approval before proceeding.
6. Warranty. The warranty details, if applicable, are shown in the Warranty field of this quotation.
7. Acceptance. Customer acceptance confirms the quoted scope, price, and commercial terms.`;

export default function QuotationTemplatesPage() {
  const { user, accessToken, hasPermission, isLoading } = useAuth();
  const router = useRouter();
  const canManage = hasPermission("quotation_templates", "manage");
  const [templates, setTemplates] = useState<QuotationTermTemplate[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => { if (!isLoading && !user) router.replace("/login"); }, [isLoading, user, router]);
  const load = useCallback(async () => {
    if (!accessToken || !canManage) return;
    try { setTemplates(await listQuotationTemplates(accessToken)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not load templates."); }
  }, [accessToken, canManage]);
  useEffect(() => { void load(); }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!accessToken || !name.trim() || !body.trim()) return;
    setBusy(true); setError(null); setSuccess(null);
    try {
      await createQuotationTemplate(accessToken, { name: name.trim(), body: body.trim(), isDefault: true });
      setName(""); setBody("");
      setSuccess("Official Terms & Conditions saved. New quotations will use this default when no more specific template applies.");
      await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not save the template."); }
    finally { setBusy(false); }
  }

  async function deactivate(template: QuotationTermTemplate) {
    if (!accessToken || !window.confirm(`Deactivate ${template.name}? Existing quotations will not change.`)) return;
    setBusy(true); setError(null);
    try { await setQuotationTemplateStatus(accessToken, template.id, "INACTIVE"); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Could not deactivate the template."); }
    finally { setBusy(false); }
  }

  if (isLoading || !user) return null;
  if (!canManage) return <main className="p-6"><h1 className="text-xl font-semibold">Access denied</h1><p>You cannot manage quotation templates.</p></main>;
  return <main className="space-y-6 p-4 sm:p-6">
    <PageHeader title="Official Terms & Conditions" description="Manage the default text for new quotations. Existing quotations keep their own copy." />
    {!templates.some((template) => template.status === "ACTIVE" && template.isDefault && !template.quotationType && !template.tradeCode && !template.body.includes("[PLACEHOLDER")) && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">No official default has been saved yet. The existing placeholder is not suitable for customer quotations.</p>}
    <form onSubmit={save} className="max-w-2xl space-y-3 rounded-md border p-4">
      <div className="space-y-2 rounded-md bg-muted p-3 text-sm"><p>Need a starting point? Load sample terms, review and edit them for AgileWorks, then save the approved version as the official default.</p><Button type="button" variant="outline" onClick={() => { setName("AgileWorks standard terms"); setBody(SAMPLE_TERMS); }}>Load sample terms</Button></div>
      <div className="space-y-1"><Label htmlFor="template-name">Template name</Label><Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
      <div className="space-y-1"><Label htmlFor="template-body">Terms & Conditions</Label><Textarea id="template-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} required /></div>
      <Button type="submit" disabled={busy || !name.trim() || !body.trim()}>{busy ? "Saving…" : "Save as official default"}</Button>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">Saved templates</h2>
      {templates.length === 0 && <p className="text-sm text-muted-foreground">No templates available.</p>}
      {templates.map((template) => <div key={template.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <div><p className="font-medium">{template.name}</p><p className="text-muted-foreground">{template.status}{template.isDefault ? " · Default" : ""}</p></div>
        {template.status === "ACTIVE" && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void deactivate(template)}>Deactivate</Button>}
      </div>)}
    </div>
  </main>;
}
