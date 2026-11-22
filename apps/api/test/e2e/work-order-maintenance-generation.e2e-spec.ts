import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 4 Step 6, recurring maintenance -> Work Order generation
 * (§08, D7, D8). Covers: generating all N scheduledVisits Work Orders
 * upfront (D7) from an ACCEPTED PREVENTIVE_MAINTENANCE revision, correct
 * visit dating per frequency, every generated visit sharing quotationId
 * (D8) and this exact quotationRevisionId, each visit starting DRAFT with
 * no technician assigned, the costing snapshot and testing-checklist copy
 * applied per visit, the idempotency guard (one generation per revision,
 * ever), every validation guard (wrong quotation type, non-ACCEPTED
 * revision, missing maintenance details, CUSTOM frequency), RBAC per §07,
 * and that Step 3's existing PM-conversion deferral on the regular convert
 * endpoint is unaffected. Nothing below touches lifecycle transitions
 * beyond the implicit DRAFT default, actual-cost capture, or any other
 * later-phase concern.
 */
describe("Work Order Maintenance Visit Generation — Step 6 (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  let officeHeader: string; // work_orders.create/read/generate_maintenance_visits + quotations.create/read/update
  let managerHeader: string; // quotations.approve only — two-level approval correction requires an explicit Manager approval; Office Staff has zero approval authority
  let techHeader: string; // no work_orders grants relevant to this suite

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

  async function officeAccessHeader() {
    const perms = await Promise.all(
      [
        ["work_orders", "create"],
        ["work_orders", "read"],
        ["work_orders", "generate_maintenance_visits"],
        ["quotations", "create"],
        ["quotations", "read"],
        ["quotations", "update"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("wo6-office", perms.map((p) => p.id));
    const user = await fixtures.createUser("wo6-office", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function managerAccessHeader() {
    const perm = await fixtures.ensurePermission("quotations", "approve");
    const role = await fixtures.createRole("wo6-mgr", [perm.id]);
    const user = await fixtures.createUser("wo6-mgr", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function technicianHeader() {
    const perm = await fixtures.ensurePermission("work_orders", "read_own");
    const role = await fixtures.createRole("wo6-tech", [perm.id]);
    const user = await fixtures.createUser("wo6-tech", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  const revisionUrl = (q: string, r: string) => `/quotations/${q}/revisions/${r}`;
  const generateUrl = (q: string, r: string) => `${revisionUrl(q, r)}/generate-maintenance-visits`;
  const maintenanceDetailsUrl = (q: string, r: string) => `${revisionUrl(q, r)}/maintenance-details`;
  const linesUrl = (q: string, r: string) => `${revisionUrl(q, r)}/line-items`;

  it("reports persisted generation status and accessible Work Order links after reload", async () => {
    const { quotationId, revisionId } = await createAcceptedPmRevision("generation-status");
    const url = `${revisionUrl(quotationId, revisionId)}/work-orders`;
    const before = await request(app.getHttpServer()).get(url).set("Authorization", officeHeader);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ generated: false, totalCount: 0, workOrders: [] });
    const generated = await request(app.getHttpServer()).post(generateUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ startDate: "2026-12-01" });
    expect(generated.status).toBe(201);
    const after = await request(app.getHttpServer()).get(url).set("Authorization", officeHeader);
    expect(after.status).toBe(200);
    expect(after.body.generated).toBe(true);
    expect(after.body.totalCount).toBe(4);
    expect(after.body.workOrders.map((order: { id: string }) => order.id).sort()).toEqual(generated.body.map((order: { id: string }) => order.id).sort());
    expect(after.body.workOrders[0]).toEqual(expect.objectContaining({ workOrderNumber: expect.any(String), scheduledDate: expect.any(String), status: "DRAFT" }));
    const permission = await fixtures.ensurePermission("quotations", "read");
    const role = await fixtures.createRole("generation-status-only", [permission.id]);
    const user = await fixtures.createUser("generation-status-only", UserStatus.ACTIVE, [role.id]);
    const limitedHeader = await loginHeader(user.email, user.password);
    const limited = await request(app.getHttpServer()).get(url).set("Authorization", limitedHeader);
    expect(limited.status).toBe(200);
    expect(limited.body).toEqual({ generated: true, totalCount: 4, workOrders: [] });
    expect((await request(app.getHttpServer()).get(url).set("Authorization", techHeader)).status).toBe(403);
    await prisma.workOrder.updateMany({ where: { quotationRevisionId: revisionId }, data: { status: "CANCELLED" } });
    expect((await request(app.getHttpServer()).get(url).set("Authorization", officeHeader)).body.generated).toBe(true);
  });

  /** Creates a PM quotation + Revision 0, sets maintenance details, adds a costed line, and drives it to ACCEPTED. */
  async function createAcceptedPmRevision(
    suffix: string,
    overrides: { frequency?: string; scheduledVisits?: number; billingFrequency?: string } = {},
  ) {
    const customer = await fixtures.createCustomer(suffix);
    const site = await fixtures.createSite(customer.id, suffix);
    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, quotationType: "PREVENTIVE_MAINTENANCE", primaryTradeCode: "HVAC" });
    const quotationId = createRes.body.id;
    const revisionId = (
      await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", officeHeader)
    ).body[0].id;

    await request(app.getHttpServer())
      .patch(maintenanceDetailsUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({
        contractPeriodMonths: 12,
        frequency: overrides.frequency ?? "QUARTERLY",
        scheduledVisits: overrides.scheduledVisits ?? 4,
        billingFrequency: overrides.billingFrequency ?? "QUARTERLY",
      });

    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ description: "PM visit service", quantity: 1, unit: "visit", unitCostExpense: 2000, markupPercent: 25, taxTreatment: "VAT_EXEMPT" });

    await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ termsAndConditions: NON_PLACEHOLDER_TERMS });
    await request(app.getHttpServer()).patch(`${revisionUrl(quotationId, revisionId)}/submit`).set("Authorization", officeHeader);
    // Two-level approval correction: submit no longer auto-approves under
    // any circumstance — an explicit Manager approval is required before
    // SEND is reachable. This fixture's amount is always well under the
    // Owner-approval threshold, so Manager's approval alone finalizes it.
    await request(app.getHttpServer()).patch(`${revisionUrl(quotationId, revisionId)}/approve`).set("Authorization", managerHeader);
    await request(app.getHttpServer()).patch(`${revisionUrl(quotationId, revisionId)}/send`).set("Authorization", officeHeader);
    const decisionRes = await request(app.getHttpServer())
      .patch(`${revisionUrl(quotationId, revisionId)}/decision`)
      .set("Authorization", officeHeader)
      .send({ decision: "ACCEPTED" });
    expect(decisionRes.body.status).toBe("ACCEPTED");

    return { quotationId, revisionId };
  }

  // --- Happy path: D7 (all N upfront), D8 (shared quotationId) -------------

  it("generates all scheduledVisits Work Orders upfront, DRAFT, dated per frequency, sharing quotationId and this revision", async () => {
    const { quotationId, revisionId } = await createAcceptedPmRevision("generate-happy", { frequency: "QUARTERLY", scheduledVisits: 4 });

    const res = await request(app.getHttpServer())
      .post(generateUrl(quotationId, revisionId))
      .set("Authorization", officeHeader)
      .send({ startDate: "2027-01-15" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(4);

    const expectedDates = ["2027-01-15", "2027-04-15", "2027-07-15", "2027-10-15"];
    const actualDates = res.body.map((wo: { scheduledDate: string }) => wo.scheduledDate.slice(0, 10)).sort();
    expect(actualDates).toEqual(expectedDates);

    for (const wo of res.body) {
      expect(wo.status).toBe("DRAFT");
      expect(wo.workOrderType).toBe("FROM_QUOTATION");
      expect(wo.quotationId).toBe(quotationId);
      expect(wo.quotationRevisionId).toBe(revisionId);
      expect(wo.workOrderNumber).toMatch(/^WO-\d{4}-\d{2}-\d{5}$/);
      // Costing snapshot: cost 2000 x markup 25% -> unitPriceBeforeVat 2500, qty 1 -> profit 500.
      expect(Number(wo.estimatedTotalCost)).toBe(2000);
      expect(Number(wo.estimatedGrossProfitAmount)).toBe(500);

      const getRes = await request(app.getHttpServer()).get(`/work-orders/${wo.id}`).set("Authorization", officeHeader);
      expect(getRes.body.assignments).toHaveLength(0); // no technician assigned yet (D7)
    }

    // Every generated WO produced its own creation audit entry.
    const audits = await prisma.auditLog.findMany({ where: { action: "work_order_created", entityId: { in: res.body.map((w: { id: string }) => w.id) } } });
    expect(audits).toHaveLength(4);
  });

  it("copies the ACCEPTED revision's included testing/commissioning checklist onto every generated visit", async () => {
    const { quotationId, revisionId } = await createAcceptedPmRevision("generate-checklist", { scheduledVisits: 2 });
    // Checklist items must be added before ACCEPTED — DRAFT-only editing (§05 mirrors C6) — so create a
    // fresh revision-in-progress instead of reusing the already-ACCEPTED fixture above.
    const customer = await fixtures.createCustomer("generate-checklist-2");
    const site = await fixtures.createSite(customer.id, "generate-checklist-2");
    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, quotationType: "PREVENTIVE_MAINTENANCE", primaryTradeCode: "HVAC" });
    const qId = createRes.body.id;
    const rId = (await request(app.getHttpServer()).get(`/quotations/${qId}/revisions`).set("Authorization", officeHeader)).body[0].id;
    await request(app.getHttpServer()).patch(maintenanceDetailsUrl(qId, rId)).set("Authorization", officeHeader).send({ contractPeriodMonths: 6, frequency: "MONTHLY", scheduledVisits: 2, billingFrequency: "MONTHLY" });
    await request(app.getHttpServer()).post(linesUrl(qId, rId)).set("Authorization", officeHeader).send({ description: "Line", quantity: 1, unit: "visit", unitPriceBeforeVat: 1000, taxTreatment: "VAT_EXEMPT" });
    await request(app.getHttpServer()).post(`${revisionUrl(qId, rId)}/testing-commissioning-items`).set("Authorization", officeHeader).send({ description: "Check filters", sortOrder: 0 });
    await request(app.getHttpServer()).post(`${revisionUrl(qId, rId)}/testing-commissioning-items`).set("Authorization", officeHeader).send({ description: "Excluded item", included: false, sortOrder: 1 });
    await request(app.getHttpServer()).patch(revisionUrl(qId, rId)).set("Authorization", officeHeader).send({ termsAndConditions: NON_PLACEHOLDER_TERMS });
    await request(app.getHttpServer()).patch(`${revisionUrl(qId, rId)}/submit`).set("Authorization", officeHeader);
    await request(app.getHttpServer()).patch(`${revisionUrl(qId, rId)}/approve`).set("Authorization", managerHeader);
    await request(app.getHttpServer()).patch(`${revisionUrl(qId, rId)}/send`).set("Authorization", officeHeader);
    await request(app.getHttpServer()).patch(`${revisionUrl(qId, rId)}/decision`).set("Authorization", officeHeader).send({ decision: "ACCEPTED" });

    const genRes = await request(app.getHttpServer()).post(generateUrl(qId, rId)).set("Authorization", officeHeader).send({ startDate: "2027-02-01" });
    expect(genRes.status).toBe(201);
    for (const wo of genRes.body) {
      const getRes = await request(app.getHttpServer()).get(`/work-orders/${wo.id}`).set("Authorization", officeHeader);
      expect(getRes.body.tasks).toHaveLength(1); // only the included=true item
      expect(getRes.body.tasks[0].description).toBe("Check filters");
    }
  });

  // --- Idempotency -----------------------------------------------------------

  it("rejects a second generation attempt on the same revision (409) — one generation per revision, ever", async () => {
    const { quotationId, revisionId } = await createAcceptedPmRevision("generate-idempotent", { scheduledVisits: 2 });
    const first = await request(app.getHttpServer()).post(generateUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ startDate: "2027-01-01" });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer()).post(generateUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ startDate: "2027-06-01" });
    expect(second.status).toBe(409);

    const total = await prisma.workOrder.count({ where: { quotationRevisionId: revisionId } });
    expect(total).toBe(2); // still exactly the first generation's worth, not 4
  });

  // --- Validation guards -------------------------------------------------------

  it("rejects generation for a non-PREVENTIVE_MAINTENANCE quotation (400)", async () => {
    const customer = await fixtures.createCustomer("generate-wrong-type");
    const site = await fixtures.createSite(customer.id, "generate-wrong-type");
    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    const quotationId = createRes.body.id;
    const revisionId = (await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", officeHeader)).body[0].id;

    const res = await request(app.getHttpServer()).post(generateUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ startDate: "2027-01-01" });
    expect(res.status).toBe(400);
  });

  it("rejects generation for a revision that is not ACCEPTED (400)", async () => {
    const customer = await fixtures.createCustomer("generate-not-accepted");
    const site = await fixtures.createSite(customer.id, "generate-not-accepted");
    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, quotationType: "PREVENTIVE_MAINTENANCE", primaryTradeCode: "HVAC" });
    const quotationId = createRes.body.id;
    const revisionId = (await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", officeHeader)).body[0].id;
    await request(app.getHttpServer()).patch(maintenanceDetailsUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ contractPeriodMonths: 12, frequency: "QUARTERLY", scheduledVisits: 4, billingFrequency: "QUARTERLY" });
    // Still DRAFT — never submitted.

    const res = await request(app.getHttpServer()).post(generateUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ startDate: "2027-01-01" });
    expect(res.status).toBe(400);
  });

  it("rejects generation when no maintenance details are configured (400)", async () => {
    const customer = await fixtures.createCustomer("generate-no-details");
    const site = await fixtures.createSite(customer.id, "generate-no-details");
    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, quotationType: "PREVENTIVE_MAINTENANCE", primaryTradeCode: "HVAC" });
    const quotationId = createRes.body.id;
    const revisionId = (await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", officeHeader)).body[0].id;
    // Deliberately never PATCH maintenance-details.
    await request(app.getHttpServer()).post(linesUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ description: "Line", quantity: 1, unit: "visit", unitPriceBeforeVat: 1000, taxTreatment: "VAT_EXEMPT" });
    await request(app.getHttpServer()).patch(revisionUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ termsAndConditions: NON_PLACEHOLDER_TERMS });
    await request(app.getHttpServer()).patch(`${revisionUrl(quotationId, revisionId)}/submit`).set("Authorization", officeHeader);
    // Two-level approval correction: submit no longer auto-approves under
    // any circumstance — an explicit Manager approval is required before
    // SEND is reachable. This fixture's amount is always well under the
    // Owner-approval threshold, so Manager's approval alone finalizes it.
    await request(app.getHttpServer()).patch(`${revisionUrl(quotationId, revisionId)}/approve`).set("Authorization", managerHeader);
    await request(app.getHttpServer()).patch(`${revisionUrl(quotationId, revisionId)}/send`).set("Authorization", officeHeader);
    await request(app.getHttpServer()).patch(`${revisionUrl(quotationId, revisionId)}/decision`).set("Authorization", officeHeader).send({ decision: "ACCEPTED" });

    const res = await request(app.getHttpServer()).post(generateUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ startDate: "2027-01-01" });
    expect(res.status).toBe(400);
  });

  it("rejects generation for CUSTOM frequency — no defined interval to compute a schedule from (400)", async () => {
    const { quotationId, revisionId } = await createAcceptedPmRevision("generate-custom-freq", { frequency: "CUSTOM", scheduledVisits: 3 });
    const res = await request(app.getHttpServer()).post(generateUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ startDate: "2027-01-01" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no defined interval/i);
  });

  // --- RBAC --------------------------------------------------------------------

  it("RBAC: Office Staff can generate maintenance visits; Technician (no grants) is denied", async () => {
    const { quotationId, revisionId } = await createAcceptedPmRevision("generate-rbac", { scheduledVisits: 2 });
    const denied = await request(app.getHttpServer()).post(generateUrl(quotationId, revisionId)).set("Authorization", techHeader).send({ startDate: "2027-01-01" });
    expect(denied.status).toBe(403);
  });

  // --- Step 3 regression: regular conversion still defers PM quotations -----

  it("converts accepted maintenance through the existing recurring generator", async () => {
    const { quotationId, revisionId } = await createAcceptedPmRevision("convert-recurring", { scheduledVisits: 2 });
    const res = await request(app.getHttpServer())
      .post(`${revisionUrl(quotationId, revisionId)}/convert-to-work-orders`)
      .set("Authorization", officeHeader)
      .send({ scheduledDate: "2026-12-01" });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    for (const order of res.body) {
      expect(order.quotationId).toBe(quotationId);
      expect(order.quotationRevisionId).toBe(revisionId);
      expect(order.workOrderType).toBe("FROM_QUOTATION");
    }
  });

  it("generates a custom schedule from explicit dates without inventing an interval", async () => {
    const { quotationId, revisionId } = await createAcceptedPmRevision("custom-explicit", { frequency: "CUSTOM", scheduledVisits: 2 });
    const res = await request(app.getHttpServer()).post(generateUrl(quotationId, revisionId)).set("Authorization", officeHeader)
      .send({ startDate: "2026-12-01", visitDates: ["2026-12-15", "2026-12-01"] });
    expect(res.status).toBe(201);
    expect(res.body.map((row: { scheduledDate: string }) => row.scheduledDate.slice(0, 10))).toEqual(["2026-12-01", "2026-12-15"]);
  });

  it("creates only one visit set under concurrent generation requests", async () => {
    const { quotationId, revisionId } = await createAcceptedPmRevision("concurrent-visits", { scheduledVisits: 2 });
    const responses = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post(generateUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ startDate: "2026-12-01" })));
    expect(responses.map((row) => row.status).sort()).toEqual([201, 409]);
    expect(await prisma.workOrder.count({ where: { quotationRevisionId: revisionId } })).toBe(2);
  });

  it("allows an audited completion of missing legacy accepted details but never replaces existing details", async () => {
    const { quotationId, revisionId } = await createAcceptedPmRevision("missing-legacy-details", { scheduledVisits: 2 });
    await prisma.quotationMaintenanceDetails.delete({ where: { quotationRevisionId: revisionId } });
    const body = { contractPeriodMonths: 6, frequency: "MONTHLY", scheduledVisits: 2, billingFrequency: "MONTHLY" };
    const correctionUrl = `${maintenanceDetailsUrl(quotationId, revisionId)}/accepted-correction`;
    expect((await request(app.getHttpServer()).post(correctionUrl).set("Authorization", officeHeader).send(body)).status).toBe(201);
    expect((await request(app.getHttpServer()).post(correctionUrl).set("Authorization", officeHeader).send(body)).status).toBe(409);
    expect((await request(app.getHttpServer()).post(generateUrl(quotationId, revisionId)).set("Authorization", officeHeader).send({ startDate: "2026-12-01" })).status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: "maintenance_missing_details_completed", entityId: revisionId } })).toBe(1);
  });

  it("requires a first visit date when converting a PREVENTIVE_MAINTENANCE revision", async () => {
    const { quotationId, revisionId } = await createAcceptedPmRevision("regression-convert-defer", { scheduledVisits: 2 });
    const res = await request(app.getHttpServer())
      .post(`${revisionUrl(quotationId, revisionId)}/convert-to-work-orders`)
      .set("Authorization", officeHeader)
      .send({});
    expect(res.status).toBe(400);
  });
});
