import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 4 Step 3, Work Order creation (both paths) and enough
 * read to verify what was created. Covers: standalone (Path B) creation and
 * its required-field validation, quotation-conversion (Path A) for the
 * REPAIR/SUPPLY_INSTALLATION 1:1 case and the PROJECT one-per-section case
 * (D1), the ACCEPTED-only guard, the PREVENTIVE_MAINTENANCE route to the
 * separate Step 6 generator, RBAC per §07 (Office Staff+ can create,
 * Technician cannot), the WO-YYYY-MM-NNNNN numbering format (D9, 5-digit),
 * testing/commissioning-item copy-to-checklist, the estimated-cost snapshot,
 * and audit log entries. Assignment (Step 4), lifecycle transitions beyond
 * the DRAFT default (Step 5), and maintenance-visit generation (Step 6) are
 * out of scope here by design — nothing below exercises them.
 */
describe("Work Orders — Step 3 creation (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  let officeHeader: string; // work_orders.create + read
  let managerHeader: string; // quotations.approve only — two-level approval correction requires an explicit Manager approval
  let techHeader: string; // no work_orders grants at all in Step 3

  const WORK_ORDER_NUMBER_PATTERN = /^WO-(\d{4})-(\d{2})-(\d{5})$/;
  const NON_PLACEHOLDER_TERMS = "HAND-EDITED TERMS — real content, deliberately not the placeholder.";

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
    officeHeader = await officeAccessHeader();
    managerHeader = await managerAccessHeader();
    techHeader = await technicianHeader();
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  // work_orders.create/read plus everything Step 7 needs to drive a
  // revision to ACCEPTED (quotations.create/update). Two-level approval
  // correction: submit no longer auto-approves under any circumstance, so
  // acceptRevision() below also needs an explicit Manager approval — see
  // managerAccessHeader.
  async function officeAccessHeader() {
    const perms = await Promise.all(
      [
        ["work_orders", "create"],
        ["work_orders", "read"],
        ["quotations", "create"],
        ["quotations", "read"],
        ["quotations", "update"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("wo-step3-office", perms.map((p) => p.id));
    const user = await fixtures.createUser("wo-step3-office", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function managerAccessHeader() {
    const perm = await fixtures.ensurePermission("quotations", "approve");
    const role = await fixtures.createRole("wo-step3-mgr", [perm.id]);
    const user = await fixtures.createUser("wo-step3-mgr", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function technicianHeader() {
    const role = await fixtures.createRole("wo-step3-tech"); // no grants, matching §07 Step 3 scope
    const user = await fixtures.createUser("wo-step3-tech", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function createCustomerAndSite(suffix: string) {
    const customer = await fixtures.createCustomer(suffix);
    const site = await fixtures.createSite(customer.id, suffix);
    return { customer, site };
  }

  const linesUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}/line-items`;
  const sectionsUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}/sections`;
  const testingItemsUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}/testing-commissioning-items`;
  const revisionUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}`;
  const convertUrl = (q: string, r: string) => `${revisionUrl(q, r)}/convert-to-work-orders`;

  /** Drives a fresh Revision 0 through submit -> Manager-approve -> send -> ACCEPTED (fixture amounts always stay under the Owner-approval threshold, so Manager's approval alone finalizes it). */
  async function acceptRevision(quotationId: string, revisionId: string) {
    await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ termsAndConditions: NON_PLACEHOLDER_TERMS });
    await request(app.getHttpServer()).patch(`${revisionUrl(quotationId, revisionId)}/submit`).set("Authorization", officeHeader);
    await request(app.getHttpServer()).patch(`${revisionUrl(quotationId, revisionId)}/approve`).set("Authorization", managerHeader);
    await request(app.getHttpServer()).patch(`${revisionUrl(quotationId, revisionId)}/send`).set("Authorization", officeHeader);
    const res = await request(app.getHttpServer())
      .patch(`${revisionUrl(quotationId, revisionId)}/decision`)
      .set("Authorization", officeHeader)
      .send({ decision: "ACCEPTED" });
    expect(res.body.status).toBe("ACCEPTED");
  }

  async function createQuotation(customerId: string, siteId: string, quotationType: string) {
    const res = await request(app.getHttpServer())
      .post(`/customers/${customerId}/quotations`)
      .set("Authorization", officeHeader)
      .send({ siteId, quotationType, primaryTradeCode: "HVAC" });
    const quotationId = res.body.id;
    const revisionId = (
      await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", officeHeader)
    ).body[0].id;
    return { quotationId, revisionId };
  }

  // --- Path B: standalone creation ----------------------------------------

  it("creates a STANDALONE Work Order with a WO-YYYY-MM-NNNNN number, DRAFT status, no quotation link", async () => {
    const { customer, site } = await createCustomerAndSite("standalone-happy");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/work-orders`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, standaloneReason: "AC unit not cooling, urgent callout", standaloneReasonType: "EMERGENCY" });

    expect(res.status).toBe(201);
    expect(res.body.workOrderNumber).toMatch(WORK_ORDER_NUMBER_PATTERN);
    expect(res.body.workOrderType).toBe("STANDALONE");
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.quotationId).toBeNull();
    expect(res.body.quotationRevisionId).toBeNull();
    expect(res.body.standaloneReasonType).toBe("EMERGENCY");

    const audit = await prisma.auditLog.findFirst({ where: { action: "work_order_created", entityId: res.body.id } });
    expect(audit).not.toBeNull();
    expect((audit!.afterData as Record<string, unknown>).workOrderType).toBe("STANDALONE");

    const getRes = await request(app.getHttpServer()).get(`/work-orders/${res.body.id}`).set("Authorization", officeHeader);
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(res.body.id);
  });

  it("rejects standalone creation missing standaloneReason or standaloneReasonType", async () => {
    const { customer, site } = await createCustomerAndSite("standalone-validation");

    const missingReason = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/work-orders`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, standaloneReasonType: "WARRANTY" });
    expect(missingReason.status).toBe(400);

    const missingType = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/work-orders`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, standaloneReason: "Warranty callback" });
    expect(missingType.status).toBe(400);
  });

  it("rejects a site that does not belong to the customer", async () => {
    const { customer } = await createCustomerAndSite("standalone-site-mismatch-a");
    const other = await createCustomerAndSite("standalone-site-mismatch-b");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/work-orders`)
      .set("Authorization", officeHeader)
      .send({ siteId: other.site.id, standaloneReason: "x", standaloneReasonType: "OTHER" });
    expect(res.status).toBe(400);
  });

  it("RBAC: Office Staff can create standalone Work Orders; Technician (no grants, §07) is denied", async () => {
    const { customer, site } = await createCustomerAndSite("standalone-rbac");
    const denied = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/work-orders`)
      .set("Authorization", techHeader)
      .send({ siteId: site.id, standaloneReason: "x", standaloneReasonType: "OTHER" });
    expect(denied.status).toBe(403);
  });

  // --- Path A: quotation conversion ---------------------------------------

  it("converts an ACCEPTED REPAIR revision into exactly one Work Order, with a costing snapshot and copied checklist", async () => {
    const { customer, site } = await createCustomerAndSite("convert-repair");
    const { quotationId, revisionId } = await createQuotation(customer.id, site.id, "REPAIR");

    // Costed line: cost 600 x markup 50% -> unitPriceBeforeVat 900, qty 2 -> selling 1800, cost 1200, profit 600.
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ description: "Compressor replacement", quantity: 2, unit: "unit", unitCostExpense: 600, markupPercent: 50, taxTreatment: "VAT_EXEMPT" });
    await request(app.getHttpServer())
      .post(testingItemsUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ description: "Verify refrigerant pressure post-repair", sortOrder: 0 });
    await request(app.getHttpServer())
      .post(testingItemsUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ description: "Excluded item — should not be copied", included: false, sortOrder: 1 });

    await acceptRevision(quotationId, revisionId);

    const convertRes = await request(app.getHttpServer())
      .post(convertUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({});
    expect(convertRes.status).toBe(201);
    expect(convertRes.body).toHaveLength(1);

    const wo = convertRes.body[0];
    expect(wo.workOrderType).toBe("FROM_QUOTATION");
    expect(wo.workOrderNumber).toMatch(WORK_ORDER_NUMBER_PATTERN);
    expect(wo.quotationId).toBe(quotationId);
    expect(wo.quotationRevisionId).toBe(revisionId);
    expect(wo.customerId).toBe(customer.id);
    expect(wo.siteId).toBe(site.id);
    expect(Number(wo.estimatedTotalCost)).toBe(1200);
    expect(Number(wo.estimatedGrossProfitAmount)).toBe(600);
    expect(Number(wo.estimatedGrossMarginPercent)).toBe(33.33);

    const getRes = await request(app.getHttpServer()).get(`/work-orders/${wo.id}`).set("Authorization", officeHeader);
    expect(getRes.body.tasks).toHaveLength(1); // only the included=true item was copied
    expect(getRes.body.tasks[0].description).toBe("Verify refrigerant pressure post-repair");
    expect(getRes.body.tasks[0].sourceTestingItemId).not.toBeNull();
  });

  it("blocks conversion of a revision that is not ACCEPTED", async () => {
    const { customer, site } = await createCustomerAndSite("convert-not-accepted");
    const { quotationId, revisionId } = await createQuotation(customer.id, site.id, "REPAIR");
    // Still DRAFT — never submitted.
    const res = await request(app.getHttpServer()).post(convertUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({});
    expect(res.status).toBe(400);
  });

  it("D1: converts a PROJECT revision into one Work Order per section, each carrying quotationId + quotationRevisionId", async () => {
    const { customer, site } = await createCustomerAndSite("convert-project");
    const { quotationId, revisionId } = await createQuotation(customer.id, site.id, "PROJECT");

    const sectionA = await request(app.getHttpServer())
      .post(sectionsUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ name: "Ductwork — Floor 1", sortOrder: 0 });
    const sectionB = await request(app.getHttpServer())
      .post(sectionsUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ name: "Chiller Plant — Rooftop", sortOrder: 10 });

    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ description: "Duct run", quantity: 1, unit: "lot", unitPriceBeforeVat: 5000, taxTreatment: "VAT_EXEMPT", sectionId: sectionA.body.id });
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ description: "Chiller unit", quantity: 1, unit: "lot", unitPriceBeforeVat: 20000, taxTreatment: "VAT_EXEMPT", sectionId: sectionB.body.id });

    await acceptRevision(quotationId, revisionId);

    const convertRes = await request(app.getHttpServer())
      .post(convertUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({});
    expect(convertRes.status).toBe(201);
    expect(convertRes.body).toHaveLength(2);
    const descriptions = convertRes.body.map((wo: { description: string }) => wo.description).sort();
    expect(descriptions).toEqual(["Chiller Plant — Rooftop", "Ductwork — Floor 1"]);
    for (const wo of convertRes.body) {
      expect(wo.quotationId).toBe(quotationId);
      expect(wo.quotationRevisionId).toBe(revisionId);
    }
  });

  it("blocks conversion of a PROJECT revision with zero sections", async () => {
    const { customer, site } = await createCustomerAndSite("convert-project-no-sections");
    const { quotationId, revisionId } = await createQuotation(customer.id, site.id, "PROJECT");
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ description: "Orphan line, no section", quantity: 1, unit: "lot", unitPriceBeforeVat: 1000, taxTreatment: "VAT_EXEMPT" });
    await acceptRevision(quotationId, revisionId);

    const res = await request(app.getHttpServer()).post(convertUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({});
    expect(res.status).toBe(400);
  });

  it("refuses PREVENTIVE_MAINTENANCE conversion through this endpoint and directs callers to maintenance visit generation", async () => {
    const { customer, site } = await createCustomerAndSite("convert-pm");
    const { quotationId, revisionId } = await createQuotation(customer.id, site.id, "PREVENTIVE_MAINTENANCE");
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ description: "PM visit line", quantity: 1, unit: "lot", unitPriceBeforeVat: 1000, taxTreatment: "VAT_EXEMPT" });
    await acceptRevision(quotationId, revisionId);

    const res = await request(app.getHttpServer()).post(convertUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Use Generate Maintenance Visits/i);
  });

  it("RBAC: Office Staff can convert; Technician (no grants) is denied", async () => {
    const { customer, site } = await createCustomerAndSite("convert-rbac");
    const { quotationId, revisionId } = await createQuotation(customer.id, site.id, "REPAIR");
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ description: "Line", quantity: 1, unit: "lot", unitPriceBeforeVat: 1000, taxTreatment: "VAT_EXEMPT" });
    await acceptRevision(quotationId, revisionId);

    const denied = await request(app.getHttpServer()).post(convertUrl(quotationId, revisionId)).set("Authorization", techHeader).send({});
    expect(denied.status).toBe(403);
  });
});
