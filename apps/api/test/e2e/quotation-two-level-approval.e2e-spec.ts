import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — two-level quotation approval correction. Covers exactly what
 * quotation-lifecycle.e2e-spec.ts deliberately does not: the Manager
 * (Level 1) -> Owner (Level 2) sequential mechanics itself, server-side
 * enforcement of the stage boundary (not just UI button visibility),
 * revision non-inheritance of approval across both directions, and the
 * real production default ₱50,000 boundary at exact-centavo precision.
 *
 * Fixture roles below are deliberately narrow and synthetic (matching this
 * suite's established convention elsewhere), not the real seeded Manager/
 * Admin-Owner roles — in particular `ownerFinalOnlyHeader` holds ONLY
 * approve_final/reject_final, never the base approve/reject, specifically
 * to prove the Level-1/Level-2 order is enforced by the revision's actual
 * status (the state machine), not merely by which permission a guard
 * happens to check — a real Admin/Owner account holds both permissions,
 * so testing with a real Owner alone would leave that distinction unproven.
 */
describe("Quotations — two-level approval correction (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  let managerHeader: string; // create/read/update/approve/reject — Level 1 only, mirrors the real seeded Manager
  let manager: string; // manager's own userId
  let ownerHeader: string; // everything Manager has, PLUS approve_final/reject_final — mirrors the real seeded Admin/Owner
  let owner: string; // owner's own userId
  let ownerFinalOnlyHeader: string; // approve_final/reject_final ONLY — isolates state-machine ordering from permission-holding
  let officeHeader: string; // create/read/update only — zero approval authority at either level

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
    ({ header: managerHeader, userId: manager } = await managerActor());
    ({ header: ownerHeader, userId: owner } = await ownerActor());
    ownerFinalOnlyHeader = await ownerFinalOnlyActor();
    officeHeader = await officeActor();
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function managerActor() {
    const perms = await Promise.all(
      [
        ["quotations", "create"],
        ["quotations", "read"],
        ["quotations", "update"],
        ["quotations", "approve"],
        ["quotations", "reject"],
      ].map(([m, a]) => fixtures.ensurePermission(m, a)),
    );
    const role = await fixtures.createRole("qt2-mgr", perms.map((p) => p.id));
    const user = await fixtures.createUser("qt2-mgr", UserStatus.ACTIVE, [role.id]);
    return { header: await loginHeader(user.email, user.password), userId: user.id };
  }

  async function ownerActor() {
    const perms = await Promise.all(
      [
        ["quotations", "create"],
        ["quotations", "read"],
        ["quotations", "update"],
        ["quotations", "approve"],
        ["quotations", "reject"],
        ["quotations", "approve_final"],
        ["quotations", "reject_final"],
      ].map(([m, a]) => fixtures.ensurePermission(m, a)),
    );
    const role = await fixtures.createRole("qt2-owner", perms.map((p) => p.id));
    const user = await fixtures.createUser("qt2-owner", UserStatus.ACTIVE, [role.id]);
    return { header: await loginHeader(user.email, user.password), userId: user.id };
  }

  async function ownerFinalOnlyActor() {
    const perms = await Promise.all(
      [
        ["quotations", "read"],
        ["quotations", "approve_final"],
        ["quotations", "reject_final"],
      ].map(([m, a]) => fixtures.ensurePermission(m, a)),
    );
    const role = await fixtures.createRole("qt2-owner-final-only", perms.map((p) => p.id));
    const user = await fixtures.createUser("qt2-owner-final-only", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function officeActor() {
    const perms = await Promise.all(
      [
        ["quotations", "create"],
        ["quotations", "read"],
        ["quotations", "update"],
      ].map(([m, a]) => fixtures.ensurePermission(m, a)),
    );
    const role = await fixtures.createRole("qt2-office", perms.map((p) => p.id));
    const user = await fixtures.createUser("qt2-office", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  const NON_PLACEHOLDER_TERMS = "HAND-EDITED TERMS — real content, deliberately not the placeholder.";

  // VAT_EXEMPT keeps totalAmount == unitPriceBeforeVat * quantity exactly —
  // needed for exact-centavo boundary tests against the real threshold.
  async function createReadyQuotation(suffix: string, lineAmount: number) {
    const customer = await fixtures.createCustomer(suffix);
    const site = await fixtures.createSite(customer.id, suffix);
    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", managerHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    const quotationId = createRes.body.id;
    const revisionId = (
      await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", managerHeader)
    ).body[0].id;

    await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", managerHeader)
      .send({ termsAndConditions: NON_PLACEHOLDER_TERMS });

    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", managerHeader)
      .send({ description: "Line", quantity: 1, unit: "lot", unitPriceBeforeVat: lineAmount, taxTreatment: "VAT_EXEMPT" });

    return { quotationId, revisionId };
  }

  const linesUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}/line-items`;
  const revisionUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}`;
  const submitUrl = (q: string, r: string) => `${revisionUrl(q, r)}/submit`;
  const approveUrl = (q: string, r: string) => `${revisionUrl(q, r)}/approve`;
  const rejectUrl = (q: string, r: string) => `${revisionUrl(q, r)}/reject`;
  const pdfUrl = (q: string, r: string) => `${revisionUrl(q, r)}/pdf`;

  async function getRevision(q: string, r: string) {
    return (await request(app.getHttpServer()).get(revisionUrl(q, r)).set("Authorization", managerHeader)).body;
  }

  async function withLoweredThreshold<T>(value: string, fn: () => Promise<T>): Promise<T> {
    await prisma.systemSetting.update({ where: { key: "quotation_approval_threshold_php" }, data: { value } });
    try {
      return await fn();
    } finally {
      await prisma.systemSetting.update({ where: { key: "quotation_approval_threshold_php" }, data: { value: "50000" } });
    }
  }

  function fetchPdf(url: string, header: string) {
    return new Promise<{ status: number; contentType: string; body: Buffer }>((resolve, reject) => {
      request(app.getHttpServer())
        .get(url)
        .set("Authorization", header)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => cb(null, Buffer.concat(chunks)));
        })
        .end((err, res) => {
          if (err && !res) return reject(err);
          resolve({ status: res!.status, contentType: res!.headers["content-type"] ?? "", body: res!.body as Buffer });
        });
    });
  }

  // --- Manager Level 1 advances, does not finalize, above the threshold ----

  it("Manager approving an over-threshold revision advances it to PENDING_OWNER_APPROVAL, not APPROVED", async () => {
    await withLoweredThreshold("1000", async () => {
      const { quotationId, revisionId } = await createReadyQuotation("mgr-advances", 1500);
      await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);

      const approveRes = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe("PENDING_OWNER_APPROVAL");
      expect(approveRes.body.managerApprovedAt).not.toBeNull();
      expect(approveRes.body.managerApprovedBy).toBe(manager);
      expect(approveRes.body.approvedAt).toBeNull(); // NOT finalized — Manager alone never finalizes a >threshold revision
      expect(approveRes.body.approvedBy).toBeNull();
      expect(approveRes.body.ownerApprovedAt).toBeNull();

      const audit = await prisma.auditLog.findFirst({ where: { action: "revision_manager_approved", entityId: revisionId } });
      expect((audit!.afterData as Record<string, unknown>).finalApproval).toBe(false);
      expect((audit!.afterData as Record<string, unknown>).status).toBe("PENDING_OWNER_APPROVAL");
    });
  });

  // --- Server-side enforcement, not just UI hiding --------------------------

  it("SECURITY: Manager (Level 1 only) is denied — 403 — attempting to approve or reject at PENDING_OWNER_APPROVAL", async () => {
    await withLoweredThreshold("1000", async () => {
      const { quotationId, revisionId } = await createReadyQuotation("mgr-denied-level2", 1500);
      await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader); // -> PENDING_OWNER_APPROVAL

      const approveDenied = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      expect(approveDenied.status).toBe(403);
      const rejectDenied = await request(app.getHttpServer()).patch(rejectUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ reason: "x" });
      expect(rejectDenied.status).toBe(403);

      expect((await getRevision(quotationId, revisionId)).status).toBe("PENDING_OWNER_APPROVAL"); // unchanged by the denied attempts
    });
  });

  it("SECURITY: Owner cannot approve before Manager — holding ONLY approve_final/reject_final is denied — 403 — on a PENDING_APPROVAL revision", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("owner-cannot-skip-level1", 1000);
    await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader); // -> PENDING_APPROVAL

    const approveDenied = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", ownerFinalOnlyHeader);
    expect(approveDenied.status).toBe(403);
    const rejectDenied = await request(app.getHttpServer()).patch(rejectUrl(quotationId, revisionId)).set("Authorization", ownerFinalOnlyHeader).send({ reason: "x" });
    expect(rejectDenied.status).toBe(403);

    expect((await getRevision(quotationId, revisionId)).status).toBe("PENDING_APPROVAL"); // Level 1 gate never bypassed
  });

  it("Office Staff has zero approval authority at either level", async () => {
    await withLoweredThreshold("1000", async () => {
      const { quotationId, revisionId } = await createReadyQuotation("office-zero-authority", 1500);
      await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);

      const level1Denied = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", officeHeader);
      expect(level1Denied.status).toBe(403);

      await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader); // -> PENDING_OWNER_APPROVAL

      const level2Denied = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", officeHeader);
      expect(level2Denied.status).toBe(403);
    });
  });

  // --- Full sequential happy path -------------------------------------------

  it("full sequential path: Manager Level 1 then Owner Level 2 — both recorded, approvedBy/approvedAt = Owner's", async () => {
    await withLoweredThreshold("1000", async () => {
      const { quotationId, revisionId } = await createReadyQuotation("full-two-level", 1500);
      await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      const level1 = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      expect(level1.body.status).toBe("PENDING_OWNER_APPROVAL");

      const level2 = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", ownerHeader);
      expect(level2.status).toBe(200);
      expect(level2.body.status).toBe("APPROVED");
      expect(level2.body.managerApprovedBy).toBe(manager);
      expect(level2.body.ownerApprovedBy).toBe(owner);
      expect(level2.body.approvedBy).toBe(owner); // final identity is the Owner's, per the approved compatibility decision
      expect(level2.body.approvedAt).toBe(level2.body.ownerApprovedAt);

      const managerAudit = await prisma.auditLog.findFirst({ where: { action: "revision_manager_approved", entityId: revisionId } });
      expect((managerAudit!.afterData as Record<string, unknown>).finalApproval).toBe(false);
      const ownerAudit = await prisma.auditLog.findFirst({ where: { action: "revision_owner_approved", entityId: revisionId } });
      expect((ownerAudit!.afterData as Record<string, unknown>).finalApproval).toBe(true);
    });
  });

  // --- Rejection at each stage is terminal -----------------------------------

  it("Manager rejects at Level 1 — terminal, Owner stage never reached", async () => {
    await withLoweredThreshold("1000", async () => {
      const { quotationId, revisionId } = await createReadyQuotation("mgr-reject-level1", 1500);
      await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);

      const rejectRes = await request(app.getHttpServer()).patch(rejectUrl(quotationId, revisionId)).set("Authorization", managerHeader).send({ reason: "Not viable" });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe("REJECTED");

      const audit = await prisma.auditLog.findFirst({ where: { action: "revision_rejected", entityId: revisionId } });
      expect((audit!.afterData as Record<string, unknown>).stage).toBe("manager");

      // Terminal — Owner cannot act on it either.
      const ownerAttempt = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", ownerHeader);
      expect(ownerAttempt.status).toBe(400);
    });
  });

  it("Owner rejects at Level 2 — terminal", async () => {
    await withLoweredThreshold("1000", async () => {
      const { quotationId, revisionId } = await createReadyQuotation("owner-reject-level2", 1500);
      await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader); // -> PENDING_OWNER_APPROVAL

      const rejectRes = await request(app.getHttpServer()).patch(rejectUrl(quotationId, revisionId)).set("Authorization", ownerHeader).send({ reason: "Too risky" });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe("REJECTED");
      expect(rejectRes.body.approvedBy).toBeNull();

      const audit = await prisma.auditLog.findFirst({ where: { action: "revision_rejected", entityId: revisionId } });
      expect((audit!.afterData as Record<string, unknown>).stage).toBe("owner");
    });
  });

  // --- Real production-default boundary, exact centavo precision -----------

  it("boundary at the real default threshold (₱50,000): ₱49,999.99 and ₱50,000.00 are Manager-only; ₱50,000.01 requires Owner", async () => {
    const underBoundary = await createReadyQuotation("boundary-under", 49999.99);
    await request(app.getHttpServer()).patch(submitUrl(underBoundary.quotationId, underBoundary.revisionId)).set("Authorization", managerHeader);
    const underRes = await request(app.getHttpServer()).patch(approveUrl(underBoundary.quotationId, underBoundary.revisionId)).set("Authorization", managerHeader);
    expect(underRes.body.status).toBe("APPROVED"); // Manager alone finalizes

    const atBoundary = await createReadyQuotation("boundary-at", 50000);
    await request(app.getHttpServer()).patch(submitUrl(atBoundary.quotationId, atBoundary.revisionId)).set("Authorization", managerHeader);
    const atRes = await request(app.getHttpServer()).patch(approveUrl(atBoundary.quotationId, atBoundary.revisionId)).set("Authorization", managerHeader);
    expect(atRes.body.status).toBe("APPROVED"); // inclusive boundary — still Manager alone

    const overBoundary = await createReadyQuotation("boundary-over", 50000.01);
    await request(app.getHttpServer()).patch(submitUrl(overBoundary.quotationId, overBoundary.revisionId)).set("Authorization", managerHeader);
    const overRes = await request(app.getHttpServer()).patch(approveUrl(overBoundary.quotationId, overBoundary.revisionId)).set("Authorization", managerHeader);
    expect(overRes.body.status).toBe("PENDING_OWNER_APPROVAL"); // one centavo over — Owner now required

    const finalRes = await request(app.getHttpServer()).patch(approveUrl(overBoundary.quotationId, overBoundary.revisionId)).set("Authorization", ownerHeader);
    expect(finalRes.body.status).toBe("APPROVED");
  });

  // --- Revision non-inheritance, both directions ----------------------------

  it("a new revision never inherits the prior revision's approval — ≤threshold approved, superseded by an >threshold revision needing Owner", async () => {
    await withLoweredThreshold("1000", async () => {
      const { quotationId, revisionId } = await createReadyQuotation("carry-forward-up", 500);
      await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      const approved = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      expect(approved.body.status).toBe("APPROVED");

      const nextRes = await request(app.getHttpServer()).post(`/quotations/${quotationId}/revisions`).set("Authorization", managerHeader);
      expect(nextRes.status).toBe(201);
      const nextRevisionId = nextRes.body.id;
      const next = await getRevision(quotationId, nextRevisionId);
      expect(next.status).toBe("DRAFT");
      expect(next.managerApprovedBy).toBeNull();
      expect(next.managerApprovedAt).toBeNull();
      expect(next.ownerApprovedBy).toBeNull();
      expect(next.ownerApprovedAt).toBeNull();
      expect(next.approvedBy).toBeNull();
      expect(next.approvedAt).toBeNull();

      // Bump it over the (lowered) threshold and confirm it independently needs Owner this time.
      await request(app.getHttpServer())
        .post(linesUrl(quotationId, nextRevisionId))
        .set("Authorization", managerHeader)
        .send({ description: "Extra scope", quantity: 1, unit: "lot", unitPriceBeforeVat: 1200, taxTreatment: "VAT_EXEMPT" });
      await request(app.getHttpServer()).patch(submitUrl(quotationId, nextRevisionId)).set("Authorization", managerHeader);
      const level1 = await request(app.getHttpServer()).patch(approveUrl(quotationId, nextRevisionId)).set("Authorization", managerHeader);
      expect(level1.body.status).toBe("PENDING_OWNER_APPROVAL"); // requires Owner independently — nothing inherited
    });
  });

  it("a new revision never inherits the prior revision's approval — >threshold Owner-approved, superseded by a <=threshold revision needing Manager only", async () => {
    await withLoweredThreshold("1000", async () => {
      const { quotationId, revisionId } = await createReadyQuotation("carry-forward-down", 1500);
      await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      const finalApproval = await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", ownerHeader);
      expect(finalApproval.body.status).toBe("APPROVED");

      const nextRes = await request(app.getHttpServer()).post(`/quotations/${quotationId}/revisions`).set("Authorization", managerHeader);
      const nextRevisionId = nextRes.body.id;
      const next = await getRevision(quotationId, nextRevisionId);
      expect(next.status).toBe("DRAFT");
      expect(next.ownerApprovedBy).toBeNull(); // does not inherit the prior revision's Owner approval

      // The copied-forward line items still sum to 1500 (over the lowered
      // threshold) by default via createNextRevision's copy — replace with
      // a lower amount to prove THIS revision only needs Manager this time.
      const lineItems = (await request(app.getHttpServer()).get(linesUrl(quotationId, nextRevisionId)).set("Authorization", managerHeader)).body;
      for (const li of lineItems) {
        await request(app.getHttpServer())
          .delete(`${linesUrl(quotationId, nextRevisionId)}/${li.id}`)
          .set("Authorization", managerHeader);
      }
      await request(app.getHttpServer())
        .post(linesUrl(quotationId, nextRevisionId))
        .set("Authorization", managerHeader)
        .send({ description: "Reduced scope", quantity: 1, unit: "lot", unitPriceBeforeVat: 500, taxTreatment: "VAT_EXEMPT" });

      await request(app.getHttpServer()).patch(submitUrl(quotationId, nextRevisionId)).set("Authorization", managerHeader);
      const approveRes = await request(app.getHttpServer()).patch(approveUrl(quotationId, nextRevisionId)).set("Authorization", managerHeader);
      expect(approveRes.body.status).toBe("APPROVED"); // Manager alone finalizes — no Owner involvement needed or inherited
    });
  });

  // --- PDF: DRAFT watermark vs. final approval section ----------------------

  it("PDF: a non-final revision is retrievable but must be treated as DRAFT by the caller (no approval section server-side)", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("pdf-draft", 1000);
    await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader); // PENDING_APPROVAL, not final

    const pdf = await fetchPdf(pdfUrl(quotationId, revisionId), managerHeader);
    expect(pdf.status).toBe(200);
    expect(pdf.contentType).toContain("application/pdf");
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.body.length).toBeGreaterThan(500);
  });

  it("PDF: Office Staff (quotations.read) can view the PDF even before approval — export-while-draft is allowed", async () => {
    const { quotationId, revisionId } = await createReadyQuotation("pdf-office-draft", 1000);
    await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);

    const pdf = await fetchPdf(pdfUrl(quotationId, revisionId), officeHeader);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("PDF: a fully two-level-approved revision renders successfully with both approval levels available to the document", async () => {
    await withLoweredThreshold("1000", async () => {
      const { quotationId, revisionId } = await createReadyQuotation("pdf-two-level-final", 1500);
      await request(app.getHttpServer()).patch(submitUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", managerHeader);
      await request(app.getHttpServer()).patch(approveUrl(quotationId, revisionId)).set("Authorization", ownerHeader);

      const pdf = await fetchPdf(pdfUrl(quotationId, revisionId), managerHeader);
      expect(pdf.status).toBe(200);
      expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.body.length).toBeGreaterThan(500);
    });
  });
});
