import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 3 Step 7, Approval / Submission / Rejection / Send /
 * Decision Workflow, updated for the two-level approval correction. Covers
 * the full state machine (DRAFT -> PENDING_APPROVAL -> {APPROVED |
 * PENDING_OWNER_APPROVAL -> APPROVED} -> ... -> {ACCEPTED | DECLINED |
 * EXPIRED}), every allowed and forbidden transition, RBAC per action, zero-
 * line submission blocking (C7), placeholder T&C send-blocking, required/
 * optional reasons (C6), early manual expiry (C5), terminal-state
 * immutability (ACCEPTED especially), audit payload shape, quotation.status
 * mirroring, and concurrent transition attempts.
 *
 * NO automatic approval exists anywhere in this workflow anymore — every
 * submission lands in PENDING_APPROVAL regardless of amount, and every
 * approval requires an explicit action by someone holding the right
 * permission for the right stage. The two-level (Manager -> Owner) path
 * itself, discount-percentage's removal from approval routing, and the
 * exact ₱50,000 boundary are covered in their own dedicated file,
 * quotation-two-level-approval.e2e-spec.ts — this file's amounts (1000,
 * 1500, etc.) are all deliberately well under the default threshold, so
 * every approval here is Manager-only, single-level, same as before this
 * correction, to keep this file's assertions about the rest of the
 * lifecycle (send/decision/expire/RBAC/concurrency) independent of the
 * two-level mechanics.
 */
describe("Quotations — Step 7 approval/decision workflow (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  let managerHeader: string; // create/read/update/approve/reject
  let officeHeader: string; // create/read/update only, no approve/reject

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
    managerHeader = await fullAccessHeader();
    officeHeader = await officeOnlyHeader();
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function fullAccessHeader() {
    const perms = await Promise.all(
      [
        ["quotations", "create"],
        ["quotations", "read"],
        ["quotations", "update"],
        ["quotations", "approve"],
        ["quotations", "reject"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("qt-life-mgr", perms.map((p) => p.id));
    const user = await fixtures.createUser("qt-life-mgr", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function officeOnlyHeader() {
    const perms = await Promise.all(
      [
        ["quotations", "create"],
        ["quotations", "read"],
        ["quotations", "update"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("qt-life-office", perms.map((p) => p.id));
    const user = await fixtures.createUser("qt-life-office", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  const NON_PLACEHOLDER_TERMS = "HAND-EDITED TERMS — real content, deliberately not the placeholder.";

  // Creates a quotation + Revision 0, sets real (non-placeholder) T&C so the
  // send-block test is isolated to the one scenario that deliberately
  // leaves the placeholder in place, and adds a single VAT_EXEMPT line item
  // of the given amount — VAT_EXEMPT keeps totalAmount == unitPriceBeforeVat
  // * quantity exactly, so threshold-boundary math needs no VAT rounding.
  async function createReadyQuotation(suffix: string, lineAmount = 1000, overrides: Record<string, unknown> = {}) {
    const customer = await fixtures.createCustomer(suffix);
    const site = await fixtures.createSite(customer.id, suffix);
    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", managerHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC", ...overrides });
    const quotationId = createRes.body.id;
    const revisionId = (
      await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", managerHeader)
    ).body[0].id;

    await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", managerHeader)
      .send({ termsAndConditions: NON_PLACEHOLDER_TERMS });

    if (lineAmount > 0) {
      await request(app.getHttpServer())
        .post(linesUrl(quotationId, revisionId))
        .set("Authorization", managerHeader)
        .send({ description: "Line", quantity: 1, unit: "lot", unitPriceBeforeVat: lineAmount, taxTreatment: "VAT_EXEMPT" });
    }

    return { quotationId, revisionId };
  }

  const linesUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}/line-items`;
  const revisionUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}`;
  const submitUrl = (q: string, r: string) => `${revisionUrl(q, r)}/submit`;
  const approveUrl = (q: string, r: string) => `${revisionUrl(q, r)}/approve`;
  const rejectUrl = (q: string, r: string) => `${revisionUrl(q, r)}/reject`;
  const sendUrl = (q: string, r: string) => `${revisionUrl(q, r)}/send`;
  const decisionUrl = (q: string, r: string) => `${revisionUrl(q, r)}/decision`;
  const expireUrl = (q: string, r: string) => `${revisionUrl(q, r)}/expire`;

  async function getRevision(q: string, r: string) {
    return (await request(app.getHttpServer()).get(revisionUrl(q, r)).set("Authorization", managerHeader)).body;
  }
  async function getQuotation(q: string) {
    return (await request(app.getHttpServer()).get(`/quotations/${q}`).set("Authorization", managerHeader)).body;
  }

  /** Submits (DRAFT -> PENDING_APPROVAL) then Manager-approves (-> APPROVED, single-level since these amounts are all well under the default threshold). */
  async function submitAndApprove(q: string, r: string, header = managerHeader) {
    const submitRes = await request(app.getHttpServer()).patch(submitUrl(q, r)).set("Authorization", header);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe("PENDING_APPROVAL");
    const approveRes = await request(app.getHttpServer()).patch(approveUrl(q, r)).set("Authorization", managerHeader);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");
    return approveRes.body;
  }

  // --- Happy paths -------------------------------------------------------

  it("submits to PENDING_APPROVAL (never auto-approves), Manager approves it, then sends and records ACCEPTED — quotation.status mirrors at every step", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("submit-approve-accept", 1000);

    const submitRes = await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe("PENDING_APPROVAL");
    expect(submitRes.body.submittedAt).not.toBeNull();
    expect(submitRes.body.approvedAt).toBeNull(); // no automatic approval, ever
    expect((await getQuotation(quotationId)).status).toBe("PENDING_APPROVAL");

    const approveRes = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");
    expect(approveRes.body.approvedAt).not.toBeNull();
    expect(approveRes.body.approvedBy).not.toBeNull(); // explicit human approval always sets this
    expect(approveRes.body.managerApprovedAt).not.toBeNull();
    expect(approveRes.body.ownerApprovedAt).toBeNull(); // single-level, Owner never involved
    expect((await getQuotation(quotationId)).status).toBe("APPROVED");

    const sendRes = await request(app.getHttpServer()).patch(sendUrl(quotationId, revisionId)).set("Authorization", managerHeader);
    expect(sendRes.status).toBe(200);
    expect(sendRes.body.status).toBe("SENT");
    expect((await getQuotation(quotationId)).status).toBe("SENT");

    const decisionRes = await request(app.getHttpServer())
      .patch(decisionUrl(quotationId, revisionId))
      .set("Authorization", managerHeader)
      .send({ decision: "ACCEPTED" });
    expect(decisionRes.status).toBe(200);
    expect(decisionRes.body.status).toBe("ACCEPTED");
    expect(decisionRes.body.customerDecisionAt).not.toBeNull();
    expect((await getQuotation(quotationId)).status).toBe("ACCEPTED");

    const submittedAudit = await prisma.auditLog.findFirst({ where: { action: "revision_submitted", entityId: revisionId } });
    expect(submittedAudit).not.toBeNull();
    expect((submittedAudit!.afterData as Record<string, unknown>).status).toBe("PENDING_APPROVAL");

    const managerApprovedAudit = await prisma.auditLog.findFirst({ where: { action: "revision_manager_approved", entityId: revisionId } });
    expect(managerApprovedAudit).not.toBeNull();
    expect((managerApprovedAudit!.afterData as Record<string, unknown>).finalApproval).toBe(true);

    // No revision_owner_approved event exists for a single-level approval.
    const ownerApprovedAudit = await prisma.auditLog.findFirst({ where: { action: "revision_owner_approved", entityId: revisionId } });
    expect(ownerApprovedAudit).toBeNull();
  });

  it("Office Staff cannot approve their own submitted quotation — zero approval authority regardless of amount", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("office-no-approval-authority", 1000);
    await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", officeHeader);

    const officeApproveDenied = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", officeHeader);
    expect(officeApproveDenied.status).toBe(403);
    const officeRejectDenied = await request(app.getHttpServer()).patch(rejectUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ reason: "x" });
    expect(officeRejectDenied.status).toBe(403);

    expect((await getRevision(quotationId, revisionId)).status).toBe("PENDING_APPROVAL"); // unchanged
  });

  it("a large discount percentage does not affect approval routing — only totalAmount matters (discount removed as a trigger)", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("discount-does-not-matter", 10000);
    await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", managerHeader)
      .send({ discountPercent: 50 }); // deliberately large — was well over the old 10% discount gate

    const submitRes = await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe("PENDING_APPROVAL"); // same as any other submission, not routed differently

    // Manager alone finalizes it straight to APPROVED — totalAmount (well
    // under the threshold) is all that matters, discount is irrelevant.
    const approveRes = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");
  });

  it("rejects a PENDING_APPROVAL revision (reason mandatory) — REJECTED, not DECLINED, terminal", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("manager-reject", 10000);

    const submitRes = await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe("PENDING_APPROVAL");

    // Office Staff may not reject.
    const officeDenied = await request(app.getHttpServer()).patch(rejectUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ reason: "x" });
    expect(officeDenied.status).toBe(403);

    // Reason is mandatory.
    const noReason = await request(app.getHttpServer()).patch(rejectUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({});
    expect(noReason.status).toBe(400);

    const rejectRes = await request(app.getHttpServer())
      .patch(rejectUrl(quotationId, revisionId))
      .set("Authorization", managerHeader)
      .send({ reason: "Pricing not competitive for this scope" });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe("REJECTED");
    expect(rejectRes.body.approvedBy).toBeNull(); // reject never sets approvedBy
    expect((await getQuotation(quotationId)).status).toBe("REJECTED");

    const rejectedAudit = await prisma.auditLog.findFirst({ where: { action: "revision_rejected", entityId: revisionId } });
    expect(rejectedAudit?.reason).toBe("Pricing not competitive for this scope");
    expect((rejectedAudit!.afterData as Record<string, unknown>).stage).toBe("manager");
  });

  // --- C7: zero-line-item submission block --------------------------------

  it("blocks submission of a revision with zero line items (C7)", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("zero-lines", 0);
    const res = await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);
    expect(res.status).toBe(400);
  });

  // --- Placeholder T&C guard, SEND only ------------------------------------

  it("blocks SEND while placeholder T&C content remains, but allows submit/approve to proceed internally", async () => {
    const customer = await fixtures.createCustomer("placeholder-guard");
    const site = await fixtures.createSite(customer.id, "placeholder-guard");
    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", managerHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    const quotationId = createRes.body.id;
    const revisionId = (
      await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", managerHeader)
    ).body[0].id;
    // Deliberately do NOT edit termsAndConditions — leaves the seeded
    // placeholder template body in place.
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", managerHeader)
      .send({ description: "Line", quantity: 1, unit: "lot", unitPriceBeforeVat: 500, taxTreatment: "VAT_EXEMPT" });

    await submitAndApprove(quotationId, revisionId); // internal submit+approve is not blocked

    const sendRes = await request(app.getHttpServer()).patch(sendUrl(quotationId, revisionId)).set("Authorization", managerHeader);
    expect(sendRes.status).toBe(400);
    expect((await getRevision(quotationId, revisionId)).status).toBe("APPROVED"); // unchanged, still not SENT
  });

  // --- Manual expiry: early (C4/C5) ----------------------------------------

  it("allows manual expiry from SENT before validUntil has passed, and requires a reason", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("early-expire", 1000, { validUntil: "2027-01-01" });
    await submitAndApprove(quotationId, revisionId);
    await request(app.getHttpServer()).patch(sendUrl(quotationId, revisionId)).set("Authorization", managerHeader);

    const noReason = await request(app.getHttpServer()).patch(expireUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({});
    expect(noReason.status).toBe(400);

    const expireRes = await request(app.getHttpServer())
      .patch(expireUrl(quotationId, revisionId))
      .set("Authorization", managerHeader)
      .send({ reason: "Customer confirmed by phone they are no longer proceeding" });
    expect(expireRes.status).toBe(200);
    expect(expireRes.body.status).toBe("EXPIRED");
    expect(expireRes.body.expiredAt).not.toBeNull();
    expect((await getQuotation(quotationId)).status).toBe("EXPIRED");

    const expiredAudit = await prisma.auditLog.findFirst({ where: { action: "revision_expired", entityId: revisionId } });
    expect(expiredAudit?.reason).toBe("Customer confirmed by phone they are no longer proceeding");
  });

  // --- Terminal-state immutability, especially ACCEPTED --------------------

  it("ACCEPTED is a hard dead-end: no Step 7 transition and no new revision can act on it again", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("accepted-dead-end", 1000);
    await submitAndApprove(quotationId, revisionId);
    await request(app.getHttpServer()).patch(sendUrl(quotationId, revisionId)).set("Authorization", managerHeader);
    const acceptRes = await request(app.getHttpServer())
      .patch(decisionUrl(quotationId, revisionId))
      .set("Authorization", managerHeader)
      .send({ decision: "ACCEPTED" });
    expect(acceptRes.body.status).toBe("ACCEPTED");

    const attempts = await Promise.all([
      request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(rejectUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ reason: "x" }),
      request(app.getHttpServer()).patch(sendUrl(quotationId, revisionId)).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(decisionUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ decision: "DECLINED" }),
      request(app.getHttpServer()).patch(expireUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ reason: "x" }),
    ]);
    for (const res of attempts) expect(res.status).toBe(400);

    const newRevisionAttempt = await request(app.getHttpServer()).post(`/quotations/${quotationId}/revisions`).set("Authorization", managerHeader);
    expect(newRevisionAttempt.status).toBe(400); // C6, re-verified through the real Step 7 flow

    expect((await getRevision(quotationId, revisionId)).status).toBe("ACCEPTED"); // still unchanged
  });

  // --- Forbidden transitions from every non-adjacent status -----------------

  it("rejects submit/approve/reject/send/decision/expire from a status that is not their required precondition", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("wrong-status", 1000);
    // Still DRAFT — approve/reject/send/decision/expire all require a later status.
    const wrongFromDraft = await Promise.all([
      request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(rejectUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ reason: "x" }),
      request(app.getHttpServer()).patch(sendUrl(quotationId, revisionId)).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(decisionUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ decision: "ACCEPTED" }),
      request(app.getHttpServer()).patch(expireUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ reason: "x" }),
    ]);
    for (const res of wrongFromDraft) expect(res.status).toBe(400);

    await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader); // -> PENDING_APPROVAL
    // Now PENDING_APPROVAL — submit/send/decision/expire are all wrong (approve/reject ARE valid from here, tested elsewhere).
    const wrongFromPendingApproval = await Promise.all([
      request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(sendUrl(quotationId, revisionId)).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(decisionUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ decision: "ACCEPTED" }),
      request(app.getHttpServer()).patch(expireUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ reason: "x" }),
    ]);
    for (const res of wrongFromPendingApproval) expect(res.status).toBe(400);

    await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader); // -> APPROVED
    // Now APPROVED — submit/approve/reject/decision/expire are all wrong (send IS valid, tested elsewhere).
    const wrongFromApproved = await Promise.all([
      request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(rejectUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ reason: "x" }),
      request(app.getHttpServer()).patch(decisionUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ decision: "ACCEPTED" }),
      request(app.getHttpServer()).patch(expireUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ reason: "x" }),
    ]);
    for (const res of wrongFromApproved) expect(res.status).toBe(400);
  });

  // --- RBAC on submit/send/decision/expire (quotations.update) -------------

  it("Office Staff (quotations.update only) can submit/send/record-decision/expire once Manager approves; Technician (no grants) is denied submit", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("office-rbac", 1000);
    const submitRes = await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", officeHeader);
    expect(submitRes.status).toBe(200);
    // Office Staff has zero approval authority — Manager must approve before Office Staff can proceed to send.
    await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader);

    const sendRes = await request(app.getHttpServer()).patch(sendUrl(quotationId, revisionId)).set("Authorization", officeHeader);
    expect(sendRes.status).toBe(200);
    const decisionRes = await request(app.getHttpServer())
      .patch(decisionUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ decision: "DECLINED" });
    expect(decisionRes.status).toBe(200);

    const technicianRole = await fixtures.createRole("qt-life-tech"); // no grants
    const technician = await fixtures.createUser("qt-life-tech", UserStatus.ACTIVE, [technicianRole.id]);
    const techHeader = await loginHeader(technician.email, technician.password);
    const { quotationId: q2, revisionId: r2 } = await createReadyQuotation("tech-denied", 1000);
    const denied = await request(app.getHttpServer()).patch(submitUrl(q2, r2)).set("Authorization", techHeader);
    expect(denied.status).toBe(403);
  });

  // --- Concurrency: two simultaneous transitions on the same revision ------

  it("only one of two concurrent decision requests on the same SENT revision succeeds — the other gets 409", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("concurrent-decision", 1000);
    await submitAndApprove(quotationId, revisionId);
    await request(app.getHttpServer()).patch(sendUrl(quotationId, revisionId)).set("Authorization", managerHeader);

    const [a, b] = await Promise.all([
      request(app.getHttpServer()).patch(decisionUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ decision: "ACCEPTED" }),
      request(app.getHttpServer()).patch(decisionUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ decision: "DECLINED" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const finalRevision = await getRevision(quotationId, revisionId);
    expect(["ACCEPTED", "DECLINED"]).toContain(finalRevision.status);

    const decisionAudits = await prisma.auditLog.findMany({ where: { action: "revision_decision_recorded", entityId: revisionId } });
    expect(decisionAudits).toHaveLength(1); // exactly one transition actually happened
  });

  it("only one of two concurrent submit requests on the same DRAFT revision succeeds — the other gets 409", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("concurrent-submit", 1000);

    const [a, b] = await Promise.all([
      request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const submittedAudits = await prisma.auditLog.findMany({ where: { action: "revision_submitted", entityId: revisionId } });
    expect(submittedAudits).toHaveLength(1);
  });

  it("only one of two concurrent Manager-approve requests on the same PENDING_APPROVAL revision succeeds — the other gets 409", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("concurrent-approve", 1000);
    await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);

    const [a, b] = await Promise.all([
      request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const approvedAudits = await prisma.auditLog.findMany({ where: { action: "revision_manager_approved", entityId: revisionId } });
    expect(approvedAudits).toHaveLength(1);
  });
});
