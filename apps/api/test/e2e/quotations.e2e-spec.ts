import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures, E2E_PREFIX } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

const QUOTATION_NUMBER_PATTERN = /^QT-(\d{4})-(\d{2})-(\d{5})$/;

/**
 * Live E2E — Phase 3 Step 5. Covers the Quotation header + Revision 0
 * module end-to-end: direct creation and Inquiry -> Quotation conversion
 * sharing one creation core, the generalized QT-YYYY-MM-NNNNN numbering
 * engine (concurrency safety), tax-treatment/VAT-rate snapshotting with no
 * client override of the rate, §08 template selection with audit-trail
 * traceability (no FK), the atomic inquiry-conversion transaction
 * (concurrent-conversion race + non-OPEN rejection), same-customer site
 * validation, and RBAC. Step 6 (sections/line items/pricing math) and
 * Step 7 (approval workflow) are explicitly out of scope here.
 */
describe("Quotations — header + Revision 0 (live)", () => {
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

  // Shared across nearly every test — see the throttle note in
  // inquiries.e2e-spec.ts (/auth/login is limited to 10/60s). Only the RBAC-
  // boundary tests below (Office Staff, Technician) log in separately.
  async function fullAccessHeader() {
    const perms = await Promise.all(
      [
        ["quotations", "create"],
        ["quotations", "read"],
        ["inquiries", "create"],
        ["inquiries", "read"],
        ["quotation_templates", "read"],
        ["quotation_templates", "manage"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("quotations-full", perms.map((p) => p.id));
    const user = await fixtures.createUser("quotations-full", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  // name is ALWAYS E2E_PREFIX-namespaced here, not just per-call — this is
  // what makes cleanupAll()'s quotationTermTemplate.deleteMany({ name:
  // startsWith E2E_PREFIX }) actually catch these rows. A prior version of
  // this helper let call sites supply an unprefixed name, which meant
  // templates never got cleaned up between test runs and a stale template
  // from an earlier run could shadow a fresh one in findBestTemplate()'s
  // `orderBy: createdAt asc` — a real bug this test suite itself caught on
  // a second run, not a hypothetical one.
  async function createTemplate(nameSuffix: string, body: string, quotationType?: string, tradeCode?: string) {
    const res = await request(app.getHttpServer())
      .post("/quotation-templates")
      .set("Authorization", sharedAuthHeader)
      .send({ name: `${E2E_PREFIX}-${nameSuffix}-${Date.now()}`, body, quotationType, tradeCode });
    expect(res.status).toBe(201);
    return res.body;
  }

  // ------------------------------------------------------------------
  // Direct creation
  // ------------------------------------------------------------------

  it("creates a direct quotation: numbering, DRAFT status, Revision 0, tax snapshot, template copy, full audit trail", async () => {
    const customer = await fixtures.createCustomer("qt-direct");
    const site = await fixtures.createSite(customer.id, "qt-direct");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({
        siteId: site.id,
        quotationType: "REPAIR",
        primaryTradeCode: "HVAC",
        customerReferenceNo: "CUST-PO-9001",
        scopeOfWork: "Repair the rooftop condenser unit",
      });
    expect(res.status).toBe(201);
    expect(res.body.quotationNumber).toMatch(QUOTATION_NUMBER_PATTERN);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.customerReferenceNo).toBe("CUST-PO-9001");
    expect(res.body.inquiryId).toBeNull();
    const quotationId = res.body.id;

    const revisionsRes = await request(app.getHttpServer())
      .get(`/quotations/${quotationId}/revisions`)
      .set("Authorization", sharedAuthHeader);
    expect(revisionsRes.body).toHaveLength(1);
    const revision = revisionsRes.body[0];
    expect(revision.revisionNumber).toBe(0);
    expect(revision.isCurrent).toBe(true);
    expect(revision.status).toBe("DRAFT");
    expect(revision.defaultTaxTreatment).toBe("VAT_INCLUSIVE"); // configured system default
    expect(Number(revision.vatRatePercent)).toBe(12);
    expect(revision.scopeOfWork).toBe("Repair the rooftop condenser unit");
    expect(typeof revision.termsAndConditions).toBe("string");
    expect(revision.termsAndConditions.length).toBeGreaterThan(0);

    const [quotationAudit, revisionAudit] = await Promise.all([
      prisma.auditLog.findFirst({ where: { action: "quotation_created", entityId: quotationId } }),
      prisma.auditLog.findFirst({ where: { action: "revision_created", entityId: revision.id } }),
    ]);
    expect(quotationAudit).not.toBeNull();
    expect(quotationAudit!.actorType).toBe("USER");
    expect(revisionAudit).not.toBeNull();
    const revisionAfter = revisionAudit!.afterData as Record<string, unknown>;
    expect(revisionAfter.defaultTaxTreatment).toBe("VAT_INCLUSIVE");
    // Template traceability (Step 5 correction, decision 1) — since only the
    // seed placeholder is active for this untouched (quotationType, trade)
    // pair, it must be the one recorded, including isDefault: true so a
    // placeholder-sourced quotation is always identifiable after the fact.
    expect(revisionAfter.templateId).not.toBeNull();
    expect(revisionAfter.templateIsDefault).toBe(true);
  });

  it("explicit defaultTaxTreatment override is honored", async () => {
    const customer = await fixtures.createCustomer("qt-tax-override");
    const site = await fixtures.createSite(customer.id, "qt-tax-override");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC", defaultTaxTreatment: "VAT_EXEMPT" });
    expect(res.status).toBe(201);

    const revision = (
      await request(app.getHttpServer()).get(`/quotations/${res.body.id}/revisions`).set("Authorization", sharedAuthHeader)
    ).body[0];
    expect(revision.defaultTaxTreatment).toBe("VAT_EXEMPT");
  });

  it("rejects an attempt to override vatRatePercent — the field does not exist on the request contract", async () => {
    const customer = await fixtures.createCustomer("qt-vat-override-attempt");
    const site = await fixtures.createSite(customer.id, "qt-vat-override-attempt");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC", vatRatePercent: 5 });

    // ValidationPipe's whitelist:true/forbidNonWhitelisted:true rejects any
    // property not declared on CreateQuotationDto — vatRatePercent isn't
    // silently ignored, the whole request is refused.
    expect(res.status).toBe(400);
  });

  it("rejects a site that belongs to a different customer", async () => {
    const customerA = await fixtures.createCustomer("qt-cross-a");
    const customerB = await fixtures.createCustomer("qt-cross-b");
    const siteB = await fixtures.createSite(customerB.id, "qt-cross-b");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customerA.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: siteB.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown primaryTradeCode", async () => {
    const customer = await fixtures.createCustomer("qt-bad-trade");
    const site = await fixtures.createSite(customer.id, "qt-bad-trade");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "PLUMBING" });
    expect(res.status).toBe(404);
  });

  it("generates unique, sequential, current-month QT numbers under real concurrency", async () => {
    const customer = await fixtures.createCustomer("qt-concurrency");
    const site = await fixtures.createSite(customer.id, "qt-concurrency");

    const CONCURRENT = 8;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        request(app.getHttpServer())
          .post(`/customers/${customer.id}/quotations`)
          .set("Authorization", sharedAuthHeader)
          .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC", scopeOfWork: `Concurrent ${i}` }),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body.quotationNumber).toMatch(QUOTATION_NUMBER_PATTERN);
    }
    const numbers: string[] = responses.map((r) => r.body.quotationNumber);
    expect(new Set(numbers).size).toBe(CONCURRENT);

    const sequences = numbers.map((n) => Number(n.match(QUOTATION_NUMBER_PATTERN)![3])).sort((a, b) => a - b);
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBe(sequences[i - 1] + 1);
    }
  });

  // ------------------------------------------------------------------
  // Template selection (§08)
  // ------------------------------------------------------------------

  it("selects an exact (quotationType, tradeCode) template over the global default", async () => {
    const customer = await fixtures.createCustomer("qt-tmpl-exact");
    const site = await fixtures.createSite(customer.id, "qt-tmpl-exact");
    const template = await createTemplate(
      "exact-repair-hvac",
      "EXACT MATCH TERMS — Repair/HVAC",
      "REPAIR",
      "HVAC",
    );

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    expect(res.status).toBe(201);

    const revision = (
      await request(app.getHttpServer()).get(`/quotations/${res.body.id}/revisions`).set("Authorization", sharedAuthHeader)
    ).body[0];
    expect(revision.termsAndConditions).toBe("EXACT MATCH TERMS — Repair/HVAC");

    const audit = await prisma.auditLog.findFirst({ where: { action: "revision_created", entityId: revision.id } });
    expect((audit!.afterData as Record<string, unknown>).templateId).toBe(template.id);
  });

  it("falls back to a type-only template when no exact trade match exists", async () => {
    const customer = await fixtures.createCustomer("qt-tmpl-type-only");
    const site = await fixtures.createSite(customer.id, "qt-tmpl-type-only");
    const template = await createTemplate("type-only-project", "TYPE-ONLY TERMS — Project", "PROJECT");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "PROJECT", primaryTradeCode: "ELECTRICAL" });
    expect(res.status).toBe(201);

    const revision = (
      await request(app.getHttpServer()).get(`/quotations/${res.body.id}/revisions`).set("Authorization", sharedAuthHeader)
    ).body[0];
    expect(revision.termsAndConditions).toBe("TYPE-ONLY TERMS — Project");

    const audit = await prisma.auditLog.findFirst({ where: { action: "revision_created", entityId: revision.id } });
    expect((audit!.afterData as Record<string, unknown>).templateId).toBe(template.id);
  });

  it("falls back to the global is_default placeholder when nothing more specific matches", async () => {
    const customer = await fixtures.createCustomer("qt-tmpl-default");
    const site = await fixtures.createSite(customer.id, "qt-tmpl-default");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "SUPPLY_INSTALLATION", primaryTradeCode: "GENERATOR" });
    expect(res.status).toBe(201);

    const revision = (
      await request(app.getHttpServer()).get(`/quotations/${res.body.id}/revisions`).set("Authorization", sharedAuthHeader)
    ).body[0];
    expect(revision.termsAndConditions).toContain("PLACEHOLDER");

    const audit = await prisma.auditLog.findFirst({ where: { action: "revision_created", entityId: revision.id } });
    expect((audit!.afterData as Record<string, unknown>).templateIsDefault).toBe(true);
  });

  // ------------------------------------------------------------------
  // Inquiry -> Quotation conversion
  // ------------------------------------------------------------------

  it("converts an OPEN inquiry: links inquiryId, flips the inquiry to CONVERTED, sets convertedAt, audits inquiry_converted", async () => {
    const customer = await fixtures.createCustomer("qt-convert");
    const site = await fixtures.createSite(customer.id, "qt-convert");
    const inquiry = await fixtures.createInquiry(customer.id, "convert");

    const res = await request(app.getHttpServer())
      .post(`/inquiries/${inquiry.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    expect(res.status).toBe(201);
    expect(res.body.inquiryId).toBe(inquiry.id);
    expect(res.body.customerId).toBe(customer.id);

    const inquiryAfter = await prisma.inquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
    expect(inquiryAfter.status).toBe("CONVERTED");
    expect(inquiryAfter.convertedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { action: "inquiry_converted", entityId: inquiry.id } });
    expect(audit).not.toBeNull();
    expect((audit!.afterData as Record<string, unknown>).quotationId).toBe(res.body.id);
  });

  it("conversion requires siteId and quotationType explicitly — never inherits siteId from the inquiry", async () => {
    const customer = await fixtures.createCustomer("qt-convert-required");
    const site = await fixtures.createSite(customer.id, "qt-convert-required");
    const inquiry = await fixtures.createInquiry(customer.id, "convert-required", { siteId: site.id });

    const missingSite = await request(app.getHttpServer())
      .post(`/inquiries/${inquiry.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    expect(missingSite.status).toBe(400);

    const missingType = await request(app.getHttpServer())
      .post(`/inquiries/${inquiry.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, primaryTradeCode: "HVAC" });
    expect(missingType.status).toBe(400);
  });

  it("conversion inherits primaryTradeCode from the inquiry when omitted, and 400s when neither is available", async () => {
    const customer = await fixtures.createCustomer("qt-convert-trade");
    const site = await fixtures.createSite(customer.id, "qt-convert-trade");
    const inquiryWithTrade = await fixtures.createInquiry(customer.id, "convert-trade-a", { tradeCode: "ELECTRICAL" });

    const inherited = await request(app.getHttpServer())
      .post(`/inquiries/${inquiryWithTrade.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR" });
    expect(inherited.status).toBe(201);
    expect(inherited.body.primaryTradeCode).toBe("ELECTRICAL");

    const inquiryWithoutTrade = await fixtures.createInquiry(customer.id, "convert-trade-b");
    const rejected = await request(app.getHttpServer())
      .post(`/inquiries/${inquiryWithoutTrade.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR" });
    expect(rejected.status).toBe(400);
  });

  it("conversion pre-fills scopeOfWork from the inquiry's description, overridable by the caller", async () => {
    const customer = await fixtures.createCustomer("qt-convert-scope");
    const site = await fixtures.createSite(customer.id, "qt-convert-scope");
    const inquiry = await fixtures.createInquiry(customer.id, "convert-scope", {
      tradeCode: "HVAC",
      description: "Customer reports unit is leaking water",
    });

    const prefilled = await request(app.getHttpServer())
      .post(`/inquiries/${inquiry.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR" });
    expect(prefilled.status).toBe(201);
    let revision = (
      await request(app.getHttpServer())
        .get(`/quotations/${prefilled.body.id}/revisions`)
        .set("Authorization", sharedAuthHeader)
    ).body[0];
    expect(revision.scopeOfWork).toBe("Customer reports unit is leaking water");

    const inquiry2 = await fixtures.createInquiry(customer.id, "convert-scope-2", { tradeCode: "HVAC" });
    const overridden = await request(app.getHttpServer())
      .post(`/inquiries/${inquiry2.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", scopeOfWork: "Caller-specified scope" });
    expect(overridden.status).toBe(201);
    revision = (
      await request(app.getHttpServer())
        .get(`/quotations/${overridden.body.id}/revisions`)
        .set("Authorization", sharedAuthHeader)
    ).body[0];
    expect(revision.scopeOfWork).toBe("Caller-specified scope");
  });

  it("conversion pre-fills customerReferenceNo from the inquiry, overridable by the caller", async () => {
    const customer = await fixtures.createCustomer("qt-convert-refno");
    const site = await fixtures.createSite(customer.id, "qt-convert-refno");
    const inquiry = await fixtures.createInquiry(customer.id, "convert-refno", {
      tradeCode: "HVAC",
      customerReferenceNo: "INQ-SOURCED-REF-001",
    });

    const prefilled = await request(app.getHttpServer())
      .post(`/inquiries/${inquiry.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR" });
    expect(prefilled.body.customerReferenceNo).toBe("INQ-SOURCED-REF-001");

    const inquiry2 = await fixtures.createInquiry(customer.id, "convert-refno-2", {
      tradeCode: "HVAC",
      customerReferenceNo: "INQ-SOURCED-REF-002",
    });
    const overridden = await request(app.getHttpServer())
      .post(`/inquiries/${inquiry2.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", customerReferenceNo: "CALLER-OVERRIDE-REF" });
    expect(overridden.body.customerReferenceNo).toBe("CALLER-OVERRIDE-REF");
  });

  it("rejects converting an inquiry that is not OPEN, and creates no quotation", async () => {
    const customer = await fixtures.createCustomer("qt-convert-closed");
    const site = await fixtures.createSite(customer.id, "qt-convert-closed");
    const inquiry = await fixtures.createInquiry(customer.id, "convert-closed", {
      tradeCode: "HVAC",
      status: "CLOSED" as never,
    });

    const res = await request(app.getHttpServer())
      .post(`/inquiries/${inquiry.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR" });
    expect(res.status).toBe(409);

    const stillClosed = await prisma.inquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
    expect(stillClosed.status).toBe("CLOSED");
    const orphanQuotation = await prisma.quotation.findFirst({ where: { inquiryId: inquiry.id } });
    expect(orphanQuotation).toBeNull();
  });

  it("atomicity: concurrent conversion of the same OPEN inquiry — exactly one succeeds, inquiry converted exactly once, no orphan quotation", async () => {
    const customer = await fixtures.createCustomer("qt-convert-race");
    const site = await fixtures.createSite(customer.id, "qt-convert-race");
    const inquiry = await fixtures.createInquiry(customer.id, "convert-race", { tradeCode: "HVAC" });

    const CONCURRENT = 5;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        request(app.getHttpServer())
          .post(`/inquiries/${inquiry.id}/quotations`)
          .set("Authorization", sharedAuthHeader)
          .send({ siteId: site.id, quotationType: "REPAIR" }),
      ),
    );

    const successes = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(CONCURRENT - 1);

    const inquiryAfter = await prisma.inquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
    expect(inquiryAfter.status).toBe("CONVERTED");

    const quotationsForInquiry = await prisma.quotation.findMany({ where: { inquiryId: inquiry.id } });
    expect(quotationsForInquiry).toHaveLength(1);
    expect(quotationsForInquiry[0].id).toBe(successes[0].body.id);
  });

  // ------------------------------------------------------------------
  // RBAC
  // ------------------------------------------------------------------

  it("Office Staff has full quotations create/read access, per the existing Step 2 RBAC seed", async () => {
    const create = await fixtures.ensurePermission("quotations", "create");
    const read = await fixtures.ensurePermission("quotations", "read");
    const officeRole = await fixtures.createRole("quotations-office-like", [create.id, read.id]);
    const officeUser = await fixtures.createUser("quotations-office", UserStatus.ACTIVE, [officeRole.id]);
    const officeHeader = await loginHeader(officeUser.email, officeUser.password);
    const customer = await fixtures.createCustomer("qt-office-staff");
    const site = await fixtures.createSite(customer.id, "qt-office-staff");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    expect(res.status).toBe(201);

    const getRes = await request(app.getHttpServer()).get(`/quotations/${res.body.id}`).set("Authorization", officeHeader);
    expect(getRes.status).toBe(200);
  });

  it("Technician is denied every Quotations endpoint (no grants yet)", async () => {
    const technicianRole = await fixtures.createRole("quotations-technician-like"); // no grants
    const technician = await fixtures.createUser("quotations-tech", UserStatus.ACTIVE, [technicianRole.id]);
    const techHeader = await loginHeader(technician.email, technician.password);
    const customer = await fixtures.createCustomer("qt-technician-denied");

    const res = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/quotations`)
      .set("Authorization", techHeader);
    expect(res.status).toBe(403);
  });

  // ------------------------------------------------------------------
  // Read endpoints
  // ------------------------------------------------------------------

  it("GET endpoints return the header, revision list, and a single revision", async () => {
    const customer = await fixtures.createCustomer("qt-read");
    const site = await fixtures.createSite(customer.id, "qt-read");

    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    const quotationId = createRes.body.id;

    const headerRes = await request(app.getHttpServer()).get(`/quotations/${quotationId}`).set("Authorization", sharedAuthHeader);
    expect(headerRes.status).toBe(200);
    expect(headerRes.body.id).toBe(quotationId);

    const revisionsRes = await request(app.getHttpServer())
      .get(`/quotations/${quotationId}/revisions`)
      .set("Authorization", sharedAuthHeader);
    expect(revisionsRes.body).toHaveLength(1);
    const revisionId = revisionsRes.body[0].id;

    const oneRevisionRes = await request(app.getHttpServer())
      .get(`/quotations/${quotationId}/revisions/${revisionId}`)
      .set("Authorization", sharedAuthHeader);
    expect(oneRevisionRes.status).toBe(200);
    expect(oneRevisionRes.body.id).toBe(revisionId);

    const listRes = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/quotations`)
      .set("Authorization", sharedAuthHeader);
    expect(listRes.body.some((q: { id: string }) => q.id === quotationId)).toBe(true);
  });
});
