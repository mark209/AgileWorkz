import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 3 Step 6, calculation layer. Covers the full Step 6
 * review's worked-example chain end-to-end through the real HTTP/DB stack:
 * markup vs. gross margin distinctness, VAT_INCLUSIVE/VAT_EXEMPT, percentage
 * and fixed-amount discounts, the either/or discount contract (C4), centavo
 * reconciliation (largest-remainder), internal costing surviving a discount
 * untouched, and quantity validation (C8). Section/line-item CRUD, revision
 * lifecycle/copy-forward, RBAC, and audit are covered in
 * quotation-revisions.e2e-spec.ts.
 */
describe("Quotations — Step 6 calculation layer (live)", () => {
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
    const role = await fixtures.createRole("qt-pricing-full", perms.map((p) => p.id));
    const user = await fixtures.createUser("qt-pricing-full", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function createQuotation(suffix: string) {
    const customer = await fixtures.createCustomer(suffix);
    const site = await fixtures.createSite(customer.id, suffix);
    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", sharedAuthHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    const quotationId = createRes.body.id;
    const revisionId = (
      await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", sharedAuthHeader)
    ).body[0].id;
    return { quotationId, revisionId };
  }

  function linesUrl(quotationId: string, revisionId: string) {
    return `/quotations/${quotationId}/revisions/${revisionId}/line-items`;
  }
  function revisionUrl(quotationId: string, revisionId: string) {
    return `/quotations/${quotationId}/revisions/${revisionId}`;
  }

  async function getRevision(quotationId: string, revisionId: string) {
    return (await request(app.getHttpServer()).get(revisionUrl(quotationId, revisionId)).set("Authorization", sharedAuthHeader)).body;
  }

  it("markup vs. gross margin: distinct fields, distinct formulas, never conflated (Example 1)", async () => {
    const { quotationId, revisionId } = await createQuotation("markup-margin");

    const res = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({
        description: "Aircon repair labor + parts",
        quantity: 2,
        unit: "lot",
        unitCostExpense: 6000,
        markupPercent: 50,
        taxTreatment: "VAT_INCLUSIVE",
      });
    expect(res.status).toBe(201);
    expect(Number(res.body.totalInternalCost)).toBe(12000);
    expect(Number(res.body.unitPriceBeforeVat)).toBe(9000);
    expect(Number(res.body.grossProfitAmount)).toBe(6000);
    expect(Number(res.body.grossMarginPercent)).toBe(33.33);
    expect(Number(res.body.markupPercent)).toBe(50); // input, unaffected by margin
    expect(Number(res.body.unitPrice)).toBe(10080);
    expect(Number(res.body.lineAmount)).toBe(20160);

    const revision = await getRevision(quotationId, revisionId);
    expect(Number(revision.subtotal)).toBe(20160);
    expect(Number(revision.netAmount)).toBe(18000);
    expect(Number(revision.vatAmount)).toBe(2160);
    expect(Number(revision.totalAmount)).toBe(20160);
  });

  it("VAT_INCLUSIVE: unit price already includes VAT, net/VAT correctly extracted", async () => {
    const { quotationId, revisionId } = await createQuotation("vat-inclusive");
    const res = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Direct-priced line", quantity: 1, unit: "lot", unitPriceBeforeVat: 8928.57, taxTreatment: "VAT_INCLUSIVE" });
    expect(res.status).toBe(201);
    expect(Number(res.body.unitPrice)).toBe(10000);
    expect(Number(res.body.lineVatAmount)).toBe(1071.43);
    expect(Number(res.body.lineNetAmount)).toBe(8928.57);
  });

  it("VAT_EXEMPT: no VAT added, no VAT extracted — final price equals the entered price exactly", async () => {
    const { quotationId, revisionId } = await createQuotation("vat-exempt");
    const res = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Exempt line", quantity: 1, unit: "lot", unitPriceBeforeVat: 8928.57, taxTreatment: "VAT_EXEMPT" });
    expect(res.status).toBe(201);
    expect(Number(res.body.unitPrice)).toBe(8928.57);
    expect(Number(res.body.lineVatAmount)).toBe(0);
    expect(Number(res.body.lineNetAmount)).toBe(8928.57);
  });

  it("percentage discount is allocated proportionally and reflected in revision totals (Example 2)", async () => {
    const { quotationId, revisionId } = await createQuotation("discount-pct");
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Costed line", quantity: 2, unit: "lot", unitCostExpense: 6000, markupPercent: 50, taxTreatment: "VAT_INCLUSIVE" });
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Exempt line", quantity: 1, unit: "lot", unitPriceBeforeVat: 4840, taxTreatment: "VAT_EXEMPT" });

    const discountRes = await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ discountPercent: 10 });
    expect(discountRes.status).toBe(200);
    expect(Number(discountRes.body.discountAmount)).toBe(2500);
    expect(Number(discountRes.body.totalAmount)).toBe(22500);
    expect(Number(discountRes.body.netAmount)).toBe(20556);
    expect(Number(discountRes.body.vatAmount)).toBe(1944);

    const lines = (
      await request(app.getHttpServer()).get(linesUrl(quotationId, revisionId)).set("Authorization", sharedAuthHeader)
    ).body;
    const costed = lines.find((l: { description: string }) => l.description === "Costed line");
    const exempt = lines.find((l: { description: string }) => l.description === "Exempt line");
    expect(Number(costed.lineDiscountAmount)).toBe(2016);
    expect(Number(costed.lineFinalAmount)).toBe(18144);
    expect(Number(costed.lineNetAmount)).toBe(16200);
    expect(Number(costed.lineVatAmount)).toBe(1944);
    expect(Number(exempt.lineDiscountAmount)).toBe(484);
    expect(Number(exempt.lineFinalAmount)).toBe(4356);
  });

  it("fixed-amount discount produces the same result as its percentage equivalent", async () => {
    const { quotationId, revisionId } = await createQuotation("discount-fixed");
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Single line", quantity: 1, unit: "lot", unitPriceBeforeVat: 10000, taxTreatment: "VAT_EXEMPT" });

    const res = await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ discountAmount: 1000 });
    expect(res.status).toBe(200);
    expect(Number(res.body.discountPercent)).toBe(10);
    expect(Number(res.body.totalAmount)).toBe(9000);
  });

  it("rejects a revision update that supplies both discountPercent and discountAmount", async () => {
    const { quotationId, revisionId } = await createQuotation("discount-both");
    const res = await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ discountPercent: 10, discountAmount: 500 });
    expect(res.status).toBe(400);
  });

  it("centavo allocation reconciles exactly across unevenly-priced lines (largest-remainder method)", async () => {
    const { quotationId, revisionId } = await createQuotation("centavo-recon");
    const amounts = ["3333.33", "3333.33", "3333.34"];
    for (const amount of amounts) {
      await request(app.getHttpServer())
        .post(linesUrl(quotationId, revisionId))
        .set("Authorization", sharedAuthHeader)
        .send({ description: `Line ${amount}`, quantity: 1, unit: "lot", unitPriceBeforeVat: Number(amount), taxTreatment: "VAT_EXEMPT" });
    }

    const discountRes = await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ discountAmount: 1000 });
    expect(Number(discountRes.body.totalAmount)).toBe(9000);

    const lines = (
      await request(app.getHttpServer()).get(linesUrl(quotationId, revisionId)).set("Authorization", sharedAuthHeader)
    ).body;
    const totalDiscount = lines.reduce((sum: number, l: { lineDiscountAmount: string }) => sum + Number(l.lineDiscountAmount), 0);
    expect(Math.round(totalDiscount * 100) / 100).toBe(1000);
    // Exactly one line absorbs the 1-centavo largest-remainder bump.
    const discounts = lines.map((l: { lineDiscountAmount: string }) => Number(l.lineDiscountAmount)).sort();
    expect(discounts).toEqual([333.33, 333.33, 333.34]);
  });

  it("internal costing remains unchanged after a discount is applied", async () => {
    const { quotationId, revisionId } = await createQuotation("costing-unchanged");
    const created = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Costed line", quantity: 2, unit: "lot", unitCostExpense: 6000, markupPercent: 50, taxTreatment: "VAT_INCLUSIVE" });
    expect(Number(created.body.grossProfitAmount)).toBe(6000);
    expect(Number(created.body.grossMarginPercent)).toBe(33.33);

    await request(app.getHttpServer())
      .patch(revisionUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ discountPercent: 15 });

    const lines = (
      await request(app.getHttpServer()).get(linesUrl(quotationId, revisionId)).set("Authorization", sharedAuthHeader)
    ).body;
    const line = lines[0];
    expect(Number(line.totalInternalCost)).toBe(12000);
    expect(Number(line.grossProfitAmount)).toBe(6000);
    expect(Number(line.grossMarginPercent)).toBe(33.33);
    expect(Number(line.unitCostExpense)).toBe(6000);
    // But the customer-facing selling side did change.
    expect(Number(line.lineDiscountAmount)).toBeGreaterThan(0);
  });

  it("C8: rejects zero or negative quantity", async () => {
    const { quotationId, revisionId } = await createQuotation("qty-guard");
    const zero = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Zero qty", quantity: 0, unit: "lot", unitPriceBeforeVat: 100, taxTreatment: "VAT_EXEMPT" });
    expect(zero.status).toBe(400);

    const negative = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Negative qty", quantity: -1, unit: "lot", unitPriceBeforeVat: 100, taxTreatment: "VAT_EXEMPT" });
    expect(negative.status).toBe(400);
  });

  it("material_amount + labor_amount must sum to unit_price_before_vat", async () => {
    const { quotationId, revisionId } = await createQuotation("material-labor");
    const bad = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({
        description: "Mismatched split",
        quantity: 1,
        unit: "lot",
        unitPriceBeforeVat: 1000,
        materialAmount: 400,
        laborAmount: 400, // sums to 800, not 1000
        taxTreatment: "VAT_EXEMPT",
      });
    expect(bad.status).toBe(400);

    const good = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({
        description: "Matching split",
        quantity: 1,
        unit: "lot",
        unitPriceBeforeVat: 1000,
        materialAmount: 600,
        laborAmount: 400,
        taxTreatment: "VAT_EXEMPT",
      });
    expect(good.status).toBe(201);
  });

  it("rejects supplying unitCostExpense without markupPercent (or vice versa)", async () => {
    const { quotationId, revisionId } = await createQuotation("cost-pair");
    const res = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Half a costing pair", quantity: 1, unit: "lot", unitCostExpense: 1000, taxTreatment: "VAT_EXEMPT" });
    expect(res.status).toBe(400);
  });

  it("deleting a line item recalculates section/revision aggregates", async () => {
    const { quotationId, revisionId } = await createQuotation("delete-recalc");
    const first = await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Line 1", quantity: 1, unit: "lot", unitPriceBeforeVat: 1000, taxTreatment: "VAT_EXEMPT" });
    await request(app.getHttpServer())
      .post(linesUrl(quotationId, revisionId))
      .set("Authorization", sharedAuthHeader)
      .send({ description: "Line 2", quantity: 1, unit: "lot", unitPriceBeforeVat: 500, taxTreatment: "VAT_EXEMPT" });

    let revision = await getRevision(quotationId, revisionId);
    expect(Number(revision.subtotal)).toBe(1500);

    const deleteRes = await request(app.getHttpServer())
      .delete(`${linesUrl(quotationId, revisionId)}/${first.body.id}`)
      .set("Authorization", sharedAuthHeader);
    expect(deleteRes.status).toBe(200);

    revision = await getRevision(quotationId, revisionId);
    expect(Number(revision.subtotal)).toBe(500);
  });
});
