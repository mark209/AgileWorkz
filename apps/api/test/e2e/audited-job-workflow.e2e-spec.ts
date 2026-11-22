import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures, TestUser } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageProvider } from "../../src/common/storage/storage-provider.interface";
import { QuotationPdfService } from "../../src/modules/quotations/pdf/quotation-pdf.service";

describe("Audited quotation, job and report journey", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  const actors: Record<string, { user: TestUser; header: string }> = {};

  beforeAll(async () => {
    let storage: StorageProvider;
    ({ app, prisma, storage } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma, storage);
    for (const [key, name] of [["office", "Office Staff"], ["manager", "Manager"], ["supervisor", "Technical Supervisor"], ["technician", "Technician"]]) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name } });
      const user = await fixtures.createUser(`journey-${key}`, UserStatus.ACTIVE, [role.id]);
      const login = await request(app.getHttpServer()).post("/auth/login").send({ email: user.email, password: user.password });
      expect(login.status).toBe(200);
      actors[key] = { user, header: `Bearer ${login.body.accessToken}` };
    }
  });

  afterAll(async () => { await fixtures.cleanupAll(); await app.close(); });

  it("preserves sample fields, scope instructions, job links and real role gates through final approval", async () => {
    const customer = await fixtures.createCustomer("audited-journey");
    const site = await fixtures.createSite(customer.id, "audited-journey");
    const source = await prisma.workOrder.create({ data: {
      workOrderNumber: `AUDIT-SOURCE-${Date.now()}`, customerId: customer.id, siteId: site.id,
      workOrderType: "STANDALONE", responsibleManagerId: actors.manager.user.id,
    } });
    const created = await request(app.getHttpServer()).post(`/customers/${customer.id}/quotations`).set("Authorization", actors.office.header)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC", sourceWorkOrderId: source.id });
    expect(created.status).toBe(201);
    expect(created.body.sourceWorkOrderId).toBe(source.id);
    const revisions = await request(app.getHttpServer()).get(`/quotations/${created.body.id}/revisions`).set("Authorization", actors.office.header);
    const revision = revisions.body[0];
    expect(revision.createdBy).toBe(actors.office.user.id);
    const url = `/quotations/${created.body.id}/revisions/${revision.id}`;

    const line = await request(app.getHttpServer()).post(`${url}/line-items`).set("Authorization", actors.office.header)
      .send({ description: "Additional service", quantity: 2, unit: "hours", unitPriceBeforeVat: 100 });
    expect(line.status).toBe(201);
    const update = await request(app.getHttpServer()).patch(url).set("Authorization", actors.office.header).send({
      recipientName: "Current Customer Contact", preparedByName: "Current Engineer", pdfLayout: "STANDARD",
      paymentInstructions: "BANK TRANSFER\nACCOUNT NAME: CURRENT QUOTATION", warranty: "2 weeks from completion",
      scopeOfWork: "Additional work for the original job", termsAndConditions: "Audit quotation terms", discountAmount: 24,
      validUntil: "2026-12-31",
    });
    expect(update.status).toBe(200);
    expect(Number(update.body.totalAmount)).toBe(200);
    expect(Number(update.body.netAmount) + Number(update.body.vatAmount)).toBeCloseTo(200, 2);
    const clearDate = await request(app.getHttpServer()).patch(url).set("Authorization", actors.office.header).send({ validUntil: null });
    expect(clearDate.status).toBe(200);
    expect(clearDate.body.validUntil).toBeNull();

    const scope = await request(app.getHttpServer()).post(`${url}/testing-commissioning-items/cleaning-scope`).set("Authorization", actors.office.header);
    expect(scope.status).toBe(201);
    expect(scope.body).toHaveLength(11);
    expect(scope.body[2].method).toBe("Ensure the unit is not energized.");
    expect((await request(app.getHttpServer()).post(`${url}/testing-commissioning-items/cleaning-scope`).set("Authorization", actors.office.header)).status).toBe(409);

    expect((await request(app.getHttpServer()).patch(`${url}/submit`).set("Authorization", actors.office.header)).status).toBe(200);
    expect((await request(app.getHttpServer()).patch(`${url}/approve`).set("Authorization", actors.manager.header)).status).toBe(200);
    const pdf = await new QuotationPdfService(prisma).generate(created.body.id, revision.id);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await request(app.getHttpServer()).patch(`${url}/send`).set("Authorization", actors.office.header)).status).toBe(200);
    expect((await request(app.getHttpServer()).patch(`${url}/decision`).set("Authorization", actors.office.header).send({ decision: "ACCEPTED" })).status).toBe(200);
    const converted = await request(app.getHttpServer()).post(`${url}/convert-to-work-orders`).set("Authorization", actors.office.header)
      .send({ responsibleManagerId: actors.manager.user.id });
    expect(converted.status).toBe(201);
    const workOrderId = converted.body[0].id;
    expect((await request(app.getHttpServer()).get(`/work-orders/${workOrderId}`).set("Authorization", actors.technician.header)).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`/work-orders/${workOrderId}/assignments`).set("Authorization", actors.office.header).send({ technicianId: actors.technician.user.id })).status).toBe(201);
    expect((await request(app.getHttpServer()).patch(`/work-orders/${workOrderId}/schedule`).set("Authorization", actors.office.header).send({ scheduledDate: "2026-12-01" })).status).toBe(200);
    const technicianView = await request(app.getHttpServer()).get(`/work-orders/${workOrderId}`).set("Authorization", actors.technician.header);
    expect(technicianView.status).toBe(200);
    expect(technicianView.body.tasks).toHaveLength(11);
    expect(technicianView.body.tasks[2]).toEqual(expect.objectContaining({ method: "Ensure the unit is not energized.", indications: "Electrocution" }));
    expect((await request(app.getHttpServer()).patch(`/work-orders/${workOrderId}/start`).set("Authorization", actors.technician.header)).status).toBe(200);

    const uploaded = await request(app.getHttpServer()).post(`/customers/${customer.id}/service-reports`).set("Authorization", actors.technician.header)
      .field("siteId", site.id).field("workOrderId", workOrderId).field("reportTypeCode", "MAINTENANCE_CLEANING")
      .attach("file", Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), { filename: "audit-report.png", contentType: "image/png" });
    expect(uploaded.status).toBe(201);
    const reportId = uploaded.body.id;
    expect(uploaded.body.status).toBe("PENDING_VERIFICATION");
    expect((await request(app.getHttpServer()).post(`/service-reports/${reportId}/confirm`).set("Authorization", actors.manager.header)).status).toBe(400);
    expect((await request(app.getHttpServer()).post(`/service-reports/${reportId}/verification/document-approve`).set("Authorization", actors.office.header).send({ documentReviewed: true })).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`/service-reports/${reportId}/verification/document-approve`).set("Authorization", actors.supervisor.header).send({ documentReviewed: true })).status).toBe(201);
    expect((await request(app.getHttpServer()).post(`/service-reports/${reportId}/confirm`).set("Authorization", actors.supervisor.header)).status).toBe(403);
    expect((await request(app.getHttpServer()).post(`/service-reports/${reportId}/confirm`).set("Authorization", actors.manager.header)).status).toBe(201);
    expect((await request(app.getHttpServer()).post(`/service-reports/${reportId}/lock`).set("Authorization", actors.manager.header)).status).toBe(201);

    const allReports = await request(app.getHttpServer()).get("/service-reports").set("Authorization", actors.manager.header);
    expect(allReports.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: reportId, status: "LOCKED" })]));
    const related = await request(app.getHttpServer()).get(`/work-orders/${source.id}/quotations`).set("Authorization", actors.manager.header);
    expect(related.status).toBe(200);
    expect(related.body[0].workOrders[0].id).toBe(workOrderId);
    const linkedReports = await request(app.getHttpServer()).get(`/work-orders/${workOrderId}/service-reports`).set("Authorization", actors.manager.header);
    expect(linkedReports.body[0].id).toBe(reportId);
    const stored = await prisma.serviceReport.findUniqueOrThrow({ where: { id: reportId } });
    expect(stored.verifiedBy).toBe(actors.supervisor.user.id);
    expect(stored.confirmedBy).toBe(actors.manager.user.id);
    expect(await prisma.serviceReportEquipmentUnit.count({ where: { serviceReportId: reportId } })).toBe(0);
    const canonical = await request(app.getHttpServer()).get(`/service-reports/${reportId}/canonical`).set("Authorization", actors.manager.header);
    expect(canonical.status).toBe(200);
    expect(canonical.body.report.verifiedByName).toBe("E2E journey-supervisor");
    expect(canonical.body.report.confirmedByName).toBe("E2E journey-manager");
  });

  it("copies the sample-specific fields and scope details when a draft is revised", async () => {
    const customer = await fixtures.createCustomer("sample-copy");
    const site = await fixtures.createSite(customer.id, "sample-copy");
    const quotation = await request(app.getHttpServer()).post(`/customers/${customer.id}/quotations`).set("Authorization", actors.office.header).send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    const revisions = await request(app.getHttpServer()).get(`/quotations/${quotation.body.id}/revisions`).set("Authorization", actors.office.header);
    const revisionId = revisions.body[0].id;
    const url = `/quotations/${quotation.body.id}/revisions/${revisionId}`;
    await request(app.getHttpServer()).patch(url).set("Authorization", actors.office.header).send({ recipientName: "Copied contact", preparedByName: "Copied preparer", paymentInstructions: "Copied instructions", pdfLayout: "STANDARD", scopeChecklistTitle: "Copied scope" });
    await request(app.getHttpServer()).post(`${url}/testing-commissioning-items`).set("Authorization", actors.office.header).send({ description: "Copied task", method: "Copied method", indications: "Copied indication" });
    const next = await request(app.getHttpServer()).post(`/quotations/${quotation.body.id}/revisions`).set("Authorization", actors.office.header);
    expect(next.status).toBe(201);
    expect(next.body).toEqual(expect.objectContaining({ recipientName: "Copied contact", preparedByName: "Copied preparer", paymentInstructions: "Copied instructions", pdfLayout: "STANDARD", scopeChecklistTitle: "Copied scope" }));
    const copied = await request(app.getHttpServer()).get(`/quotations/${quotation.body.id}/revisions/${next.body.id}/testing-commissioning-items`).set("Authorization", actors.office.header);
    expect(copied.body[0]).toEqual(expect.objectContaining({ description: "Copied task", method: "Copied method", indications: "Copied indication" }));
  });
});
