import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { QuotationRevisionStatus, UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 3 Step 6, revision lifecycle layer. Covers Revision N+1
 * copy-forward (VAT-rate re-snapshot per C2, tax-treatment copy-forward per
 * C3, complete content copy), source-revision immutability, the SUPERSEDED
 * transition, DRAFT-only editing, the ACCEPTED block (C6), RBAC, and audit
 * actions. Calculation correctness is covered in quotation-pricing.e2e-spec.ts.
 */
describe("Quotations — Step 6 revision lifecycle (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  let sharedAuthHeader: string;

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
    sharedAuthHeader = await fullAccessHeader();
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
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("qt-rev-full", perms.map((p) => p.id));
    const user = await fixtures.createUser("qt-rev-full", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function createQuotation(suffix: string, overrides: Record<string, unknown> = {}) {
    const customer = await fixtures.createCustomer(suffix);
    const site = await fixtures.createSite(customer.id, suffix);
    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC", ...overrides });
    const quotationId = createRes.body.id;
    const revisionId = (
      await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", sharedAuthHeader)
    ).body[0].id;
    return { quotationId, revisionId, siteId: overrides.siteId ?? createRes.body.siteId };
  }

  const linesUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}/line-items`;
  const sectionsUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}/sections`;
  const revisionUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}`;
  const maintenanceUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}/maintenance-details`;
  const testingUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}/testing-commissioning-items`;

  it("re-snapshots the current system VAT rate on Revision N+1 — never copies the prior revision's frozen rate (C2)", async () => {
    const { quotationId, revisionId } = await createQuotation("vat-resnap");
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Line", quantity: 1, unit: "lot", unitPriceBeforeVat: 1000, taxTreatment: "VAT_INCLUSIVE" });

    const revision0Before = await request(app.getHttpServer()).get(revisionUrl(quotationId, revisionId)).set("Authorization", sharedAuthHeader);
    expect(Number(revision0Before.body.vatRatePercent)).toBe(12);

    await prisma.systemSetting.update({ where: { key: "vat_rate_percent" }, data: { value: "15" } });
    try {
      const nextRes = await request(app.getHttpServer())
        .post(`/quotations/${quotationId}/revisions`)
        .set("Authorization", sharedAuthHeader);
      expect(nextRes.status).toBe(201);
      expect(Number(nextRes.body.vatRatePercent)).toBe(15);
      expect(Number(nextRes.body.revisionNumber)).toBe(1);

      // The source revision's own snapshot must be untouched by the setting change.
      const revision0After = await request(app.getHttpServer()).get(revisionUrl(quotationId, revisionId)).set("Authorization", sharedAuthHeader);
      expect(Number(revision0After.body.vatRatePercent)).toBe(12);

      const nextLines = (
        await request(app.getHttpServer()).get(linesUrl(quotationId, nextRes.body.id)).set("Authorization", sharedAuthHeader)
      ).body;
      // 1000 * 1.15 = 1150 under the new rate, not 1120 under the old one.
      expect(Number(nextLines[0].unitPrice)).toBe(1150);
    } finally {
      await prisma.systemSetting.update({ where: { key: "vat_rate_percent" }, data: { value: "12" } });
    }
  });

  it("copies the prior revision's tax-treatment selection forward — never re-resolves the company default (C3)", async () => {
    const { quotationId, revisionId } = await createQuotation("tax-copy", { defaultTaxTreatment: "VAT_EXEMPT" });
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Line", quantity: 1, unit: "lot", unitPriceBeforeVat: 500, taxTreatment: "VAT_EXEMPT" });

    const nextRes = await request(app.getHttpServer())
      .post(`/quotations/${quotationId}/revisions`)
      .set("Authorization", sharedAuthHeader);
    expect(nextRes.status).toBe(201);
    // The company default (system_settings) is VAT_INCLUSIVE — if this
    // were VAT_INCLUSIVE, that would mean it was silently re-resolved.
    expect(nextRes.body.defaultTaxTreatment).toBe("VAT_EXEMPT");
  });

  it("Revision N+1 is a complete copy-forward: sections, line items, maintenance details, testing items, free-text fields, and T&C exactly as edited", async () => {
    const { quotationId, revisionId } = await createQuotation("full-copy", { quotationType: "PREVENTIVE_MAINTENANCE" });

    const sectionRes = await request(app.getHttpServer())
      .post(sectionsUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ name: "Airconditioning Works" });
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Sectioned line", quantity: 1, unit: "lot", unitPriceBeforeVat: 1000, taxTreatment: "VAT_EXEMPT", sectionId: sectionRes.body.id });
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Unsectioned line", quantity: 1, unit: "lot", unitPriceBeforeVat: 500, taxTreatment: "VAT_EXEMPT" });
    await request(app.getHttpServer())
      .patch(maintenanceUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ contractPeriodMonths: 12, frequency: "MONTHLY", scheduledVisits: 12, billingFrequency: "MONTHLY" });
    await request(app.getHttpServer())
      .post(testingUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Phase Sequence Test" });

    const HAND_EDITED_TERMS = "HAND-EDITED TERMS — not the placeholder, deliberately customized by staff.";
    await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({
        scopeOfWork: "Custom scope",
        paymentTerms: "50% down, 50% on completion",
        warranty: "1 year parts and labor",
        notes: "Some notes",
        exclusions: "Excludes ducting",
        termsAndConditions: HAND_EDITED_TERMS,
      });

    const nextRes = await request(app.getHttpServer())
      .post(`/quotations/${quotationId}/revisions`)
      .set("Authorization", sharedAuthHeader);
    expect(nextRes.status).toBe(201);
    const nextRevisionId = nextRes.body.id;

    expect(nextRes.body.scopeOfWork).toBe("Custom scope");
    expect(nextRes.body.paymentTerms).toBe("50% down, 50% on completion");
    expect(nextRes.body.warranty).toBe("1 year parts and labor");
    expect(nextRes.body.notes).toBe("Some notes");
    expect(nextRes.body.exclusions).toBe("Excludes ducting");
    // Exactly as edited — proves copy-forward does NOT re-run template
    // selection and silently discard the hand edit.
    expect(nextRes.body.termsAndConditions).toBe(HAND_EDITED_TERMS);

    const nextSections = (
      await request(app.getHttpServer()).get(sectionsUrl(quotationId, nextRevisionId)).set("Authorization", sharedAuthHeader)
    ).body;
    expect(nextSections).toHaveLength(1);
    expect(nextSections[0].name).toBe("Airconditioning Works");
    expect(nextSections[0].id).not.toBe(sectionRes.body.id); // new row, not the same one

    const nextLines = (
      await request(app.getHttpServer()).get(linesUrl(quotationId, nextRevisionId)).set("Authorization", sharedAuthHeader)
    ).body;
    expect(nextLines).toHaveLength(2);
    const sectionedCopy = nextLines.find((l: { description: string }) => l.description === "Sectioned line");
    expect(sectionedCopy.sectionId).toBe(nextSections[0].id); // remapped to the NEW section

    const nextMaintenance = (
      await request(app.getHttpServer()).get(maintenanceUrl(quotationId, nextRevisionId)).set("Authorization", sharedAuthHeader)
    ).body;
    expect(nextMaintenance.contractPeriodMonths).toBe(12);
    expect(nextMaintenance.frequency).toBe("MONTHLY");

    const nextTesting = (
      await request(app.getHttpServer()).get(testingUrl(quotationId, nextRevisionId)).set("Authorization", sharedAuthHeader)
    ).body;
    expect(nextTesting).toHaveLength(1);
    expect(nextTesting[0].description).toBe("Phase Sequence Test");
  });

  it("the source revision's content is never modified by copy-forward (immutability)", async () => {
    const { quotationId, revisionId } = await createQuotation("source-immutable");
    const lineRes = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Original line", quantity: 3, unit: "lot", unitPriceBeforeVat: 777, taxTreatment: "VAT_EXEMPT" });

    const before = await request(app.getHttpServer()).get(revisionUrl(quotationId, revisionId)).set("Authorization", sharedAuthHeader);

    await request(app.getHttpServer()).post(`/quotations/${quotationId}/revisions`).set("Authorization", sharedAuthHeader);

    const after = await request(app.getHttpServer()).get(revisionUrl(quotationId, revisionId)).set("Authorization", sharedAuthHeader);
    expect(after.body.subtotal).toBe(before.body.subtotal);
    expect(after.body.totalAmount).toBe(before.body.totalAmount);

    const linesAfter = (
      await request(app.getHttpServer()).get(linesUrl(quotationId, revisionId)).set("Authorization", sharedAuthHeader)
    ).body;
    expect(linesAfter).toHaveLength(1);
    expect(linesAfter[0].id).toBe(lineRes.body.id);
    expect(linesAfter[0].description).toBe("Original line");
    expect(Number(linesAfter[0].quantity)).toBe(3);
  });

  it("creating Revision N+1 flips the previous current revision to SUPERSEDED", async () => {
    const { quotationId, revisionId } = await createQuotation("supersede");
    await request(app.getHttpServer()).post(`/quotations/${quotationId}/revisions`).set("Authorization", sharedAuthHeader);

    const revision0 = await request(app.getHttpServer()).get(revisionUrl(quotationId, revisionId)).set("Authorization", sharedAuthHeader);
    expect(revision0.body.status).toBe("SUPERSEDED");
    expect(revision0.body.isCurrent).toBe(false);

    const revisions = (
      await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", sharedAuthHeader)
    ).body;
    const current = revisions.find((r: { isCurrent: boolean }) => r.isCurrent);
    expect(current.revisionNumber).toBe(1);
    expect(current.status).toBe("DRAFT");

    const audit = await prisma.auditLog.findFirst({ where: { action: "revision_superseded", entityId: revisionId } });
    expect(audit).not.toBeNull();
  });

  it("a non-DRAFT revision rejects every content mutation (DRAFT-only editing)", async () => {
    const { quotationId, revisionId } = await createQuotation("draft-lock");
    await request(app.getHttpServer()).post(`/quotations/${quotationId}/revisions`).set("Authorization", sharedAuthHeader);
    // revisionId is now SUPERSEDED, not DRAFT.

    const createLine = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Should be rejected", quantity: 1, unit: "lot", unitPriceBeforeVat: 100, taxTreatment: "VAT_EXEMPT" });
    expect(createLine.status).toBe(400);

    const createSection = await request(app.getHttpServer())
      .post(sectionsUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ name: "Should be rejected" });
    expect(createSection.status).toBe(400);

    const patchRevision = await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ notes: "Should be rejected" });
    expect(patchRevision.status).toBe(400);
  });

  it("rejects creating Revision N+1 from an ACCEPTED current revision (C6)", async () => {
    const { quotationId, revisionId } = await createQuotation("accepted-block");
    // No submit/approve/accept endpoint exists yet (Step 7) — simulate the
    // precondition directly, exactly as Step 7 will eventually set it.
    await prisma.quotationRevision.update({ where: { id: revisionId }, data: { status: QuotationRevisionStatus.ACCEPTED } });

    const res = await request(app.getHttpServer())
      .post(`/quotations/${quotationId}/revisions`)
      .set("Authorization", sharedAuthHeader);
    expect(res.status).toBe(400);
  });

  it("Office Staff has full section/line-item access via the existing quotations.update grant; Technician is denied", async () => {
    const officeCreate = await fixtures.ensurePermission("quotations", "create");
    const officeRead = await fixtures.ensurePermission("quotations", "read");
    const officeUpdate = await fixtures.ensurePermission("quotations", "update");
    const officeRole = await fixtures.createRole("qt-rev-office", [officeCreate.id, officeRead.id, officeUpdate.id]);
    const officeUser = await fixtures.createUser("qt-rev-office", UserStatus.ACTIVE, [officeRole.id]);
    const officeHeader = await loginHeader(officeUser.email, officeUser.password);

    const customer = await fixtures.createCustomer("rbac-office");
    const site = await fixtures.createSite(customer.id, "rbac-office");
    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    const revId = (
      await request(app.getHttpServer()).get(`/quotations/${createRes.body.id}/revisions`).set("Authorization", officeHeader)
    ).body[0].id;

    const lineRes = await request(app.getHttpServer())
      .post(linesUrl(createRes.body.id, revId))
      .set("Authorization", officeHeader)
      .send({ description: "Office Staff line", quantity: 1, unit: "lot", unitPriceBeforeVat: 100, taxTreatment: "VAT_EXEMPT" });
    expect(lineRes.status).toBe(201);

    const technicianRole = await fixtures.createRole("qt-rev-tech"); // no grants
    const technician = await fixtures.createUser("qt-rev-tech", UserStatus.ACTIVE, [technicianRole.id]);
    const techHeader = await loginHeader(technician.email, technician.password);
    const denied = await request(app.getHttpServer()).get(linesUrl(createRes.body.id, revId)).set("Authorization", techHeader);
    expect(denied.status).toBe(403);
  });

  it("audit actions are recorded for section, line-item, maintenance-details, and testing-item mutations", async () => {
    const { quotationId, revisionId } = await createQuotation("audit-check", { quotationType: "PREVENTIVE_MAINTENANCE" });

    const section = await request(app.getHttpServer())
      .post(sectionsUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ name: "Audit Section" });
    await request(app.getHttpServer())
      .patch(`${sectionsUrl(quotationId, revisionId)}/${section.body.id}`)
      .set("Authorization", sharedAuthHeader)
      .send({ name: "Renamed Section" });

    const line = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Audit line", quantity: 1, unit: "lot", unitPriceBeforeVat: 100, taxTreatment: "VAT_EXEMPT" });
    await request(app.getHttpServer())
      .patch(`${linesUrl(quotationId, revisionId)}/${line.body.id}`)
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Audit line, edited" });
    await request(app.getHttpServer())
      .delete(`${linesUrl(quotationId, revisionId)}/${line.body.id}`)
      .set("Authorization", sharedAuthHeader);

    await request(app.getHttpServer())
      .patch(maintenanceUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ contractPeriodMonths: 6, frequency: "QUARTERLY", scheduledVisits: 2, billingFrequency: "QUARTERLY" });

    const testingItem = await request(app.getHttpServer())
      .post(testingUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Insulation Resistance Test" });
    await request(app.getHttpServer())
      .patch(`${testingUrl(quotationId, revisionId)}/${testingItem.body.id}`)
      .set("Authorization", sharedAuthHeader)
      .send({ included: false });
    await request(app.getHttpServer())
      .delete(`${testingUrl(quotationId, revisionId)}/${testingItem.body.id}`)
      .set("Authorization", sharedAuthHeader);

    const expectedActions: Array<[string, string]> = [
      ["section_created", section.body.id],
      ["section_updated", section.body.id],
      ["line_item_created", line.body.id],
      ["line_item_updated", line.body.id],
      ["line_item_deleted", line.body.id],
      ["maintenance_details_updated", revisionId],
      ["testing_commissioning_item_created", testingItem.body.id],
      ["testing_commissioning_item_updated", testingItem.body.id],
      ["testing_commissioning_item_deleted", testingItem.body.id],
    ];
    for (const [action, entityId] of expectedActions) {
      const found = await prisma.auditLog.findFirst({ where: { action, entityId } });
      expect(found).not.toBeNull();
    }
  });
});
