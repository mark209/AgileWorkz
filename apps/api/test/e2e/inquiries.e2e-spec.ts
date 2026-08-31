import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { NumberSeries, UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";
import { NumberingService } from "../../src/common/numbering/numbering.service";

const INQUIRY_NUMBER_PATTERN = /^INQ-(\d{4})-(\d{2})-(\d{5})$/;

/**
 * Live E2E — Phase 3 Step 3 (as corrected). Covers the Inquiries module
 * end-to-end: full-permission CRUD + close, the OPEN-only edit/close guard,
 * the Office Staff / Technician RBAC boundary, audit coverage, the
 * generalized INQ-YYYY-MM-NNNNN numbering engine (concurrency safety,
 * month-scoping, cross-series independence from QUOTATION), the separate
 * inquiries.close permission, source/trade/inquiryType FK validation, and
 * the reused Documents relationship for relatedType=INQUIRY (covered in
 * documents.e2e-spec.ts).
 */
describe("Inquiries (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  let numbering: NumberingService;
  // Shared across every test that just needs "a" full-access user, rather
  // than logging in fresh each time — /auth/login has its own stricter
  // throttle (10/60s, see auth.controller.ts) and this file's expanded Step
  // 3 correction coverage would otherwise trip it. Tests that specifically
  // exercise an RBAC boundary (Office Staff, Technician, the close-vs-update
  // permission split) still create and log in their own distinct user.
  let sharedAuthHeader: string;

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
    numbering = app.get(NumberingService);
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
        ["inquiries", "create"],
        ["inquiries", "read"],
        ["inquiries", "update"],
        ["inquiries", "close"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("inquiries-full-access", perms.map((p) => p.id));
    const user = await fixtures.createUser("inquiries-full", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  it("creates, reads, updates, and closes an inquiry via live HTTP and audits every step", async () => {
    const authHeader = sharedAuthHeader;
    const customer = await fixtures.createCustomer("inquiry-chain");
    const site = await fixtures.createSite(customer.id, "inquiry-chain");
    const contact = await fixtures.createContact(customer.id, "inquiry-chain");

    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/inquiries`)
      .set("Authorization", authHeader)
      .send({
        subject: "AC not cooling",
        description: "Living room unit",
        siteId: site.id,
        contactId: contact.id,
        sourceCode: "PHONE",
        tradeCode: "HVAC",
        customerReferenceNo: "CUST-PO-0042",
        preferredServiceDate: "2026-09-15",
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("OPEN");
    expect(createRes.body.sourceCode).toBe("PHONE");
    expect(createRes.body.tradeCode).toBe("HVAC");
    expect(createRes.body.customerReferenceNo).toBe("CUST-PO-0042");
    expect(createRes.body.inquiryNumber).toMatch(INQUIRY_NUMBER_PATTERN);
    const inquiryId = createRes.body.id;

    const getRes = await request(app.getHttpServer())
      .get(`/inquiries/${inquiryId}`)
      .set("Authorization", authHeader);
    expect(getRes.status).toBe(200);
    expect(getRes.body.subject).toBe("AC not cooling");

    const updateRes = await request(app.getHttpServer())
      .patch(`/inquiries/${inquiryId}`)
      .set("Authorization", authHeader)
      .send({ subject: "AC not cooling — urgent" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.subject).toBe("AC not cooling — urgent");
    // Number is immutable — updating other fields never touches it.
    expect(updateRes.body.inquiryNumber).toBe(createRes.body.inquiryNumber);

    const closeRes = await request(app.getHttpServer())
      .patch(`/inquiries/${inquiryId}/close`)
      .set("Authorization", authHeader);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe("CLOSED");
    expect(closeRes.body.closedAt).not.toBeNull();

    const [createdAudit, updatedAudit, closedAudit] = await Promise.all([
      prisma.auditLog.findFirst({ where: { action: "inquiry_created", entityId: inquiryId } }),
      prisma.auditLog.findFirst({ where: { action: "inquiry_updated", entityId: inquiryId } }),
      prisma.auditLog.findFirst({ where: { action: "inquiry_closed", entityId: inquiryId } }),
    ]);
    expect(createdAudit).not.toBeNull();
    expect(updatedAudit).not.toBeNull();
    expect(closedAudit).not.toBeNull();
    expect(createdAudit!.actorType).toBe("USER");
  });

  it("rejects editing or re-closing an inquiry that is already CLOSED", async () => {
    const authHeader = sharedAuthHeader;
    const customer = await fixtures.createCustomer("inquiry-closed-guard");
    const inquiry = await fixtures.createInquiry(customer.id, "closed-guard", { status: "CLOSED" as never });

    const updateRes = await request(app.getHttpServer())
      .patch(`/inquiries/${inquiry.id}`)
      .set("Authorization", authHeader)
      .send({ subject: "Should not apply" });
    expect(updateRes.status).toBe(400);

    const closeRes = await request(app.getHttpServer())
      .patch(`/inquiries/${inquiry.id}/close`)
      .set("Authorization", authHeader);
    expect(closeRes.status).toBe(400);
  });

  it("rejects an inquiry's site/contact that belongs to a different customer", async () => {
    const authHeader = sharedAuthHeader;
    const customerA = await fixtures.createCustomer("inquiry-cross-a");
    const customerB = await fixtures.createCustomer("inquiry-cross-b");
    const siteB = await fixtures.createSite(customerB.id, "inquiry-cross-b");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customerA.id}/inquiries`)
      .set("Authorization", authHeader)
      .send({ subject: "Cross-customer site", siteId: siteB.id });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown sourceCode, tradeCode, or inquiryTypeCode", async () => {
    const authHeader = sharedAuthHeader;
    const customer = await fixtures.createCustomer("inquiry-bad-refs");

    const badSource = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/inquiries`)
      .set("Authorization", authHeader)
      .send({ subject: "Bad source", sourceCode: "CARRIER_PIGEON" });
    expect(badSource.status).toBe(404);

    const badTrade = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/inquiries`)
      .set("Authorization", authHeader)
      .send({ subject: "Bad trade", tradeCode: "PLUMBING" });
    expect(badTrade.status).toBe(404);

    const badType = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/inquiries`)
      .set("Authorization", authHeader)
      .send({ subject: "Bad type", inquiryTypeCode: "NOT_A_REAL_TYPE" });
    expect(badType.status).toBe(404);
  });

  it("generates unique, sequential, current-month INQ numbers under real concurrency", async () => {
    const authHeader = sharedAuthHeader;
    const customer = await fixtures.createCustomer("inquiry-concurrency");

    const CONCURRENT = 8;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        request(app.getHttpServer())
          .post(`/customers/${customer.id}/inquiries`)
          .set("Authorization", authHeader)
          .send({ subject: `Concurrent inquiry ${i}` }),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body.inquiryNumber).toMatch(INQUIRY_NUMBER_PATTERN);
    }

    const numbers: string[] = responses.map((r) => r.body.inquiryNumber);
    expect(new Set(numbers).size).toBe(CONCURRENT); // no duplicates, ever

    const sequences = numbers
      .map((n) => Number(n.match(INQUIRY_NUMBER_PATTERN)![3]))
      .sort((a, b) => a - b);
    // Contiguous — no gaps, no double-issued sequence value.
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]).toBe(sequences[i - 1] + 1);
    }
  });

  it("scopes the counter by (series, year, month) — an unrelated month's counter never leaks into the current month's sequence", async () => {
    const authHeader = sharedAuthHeader;
    const customer = await fixtures.createCustomer("inquiry-month-isolation");

    // A deliberately unrelated, far-future month for the same INQUIRY series,
    // seeded with a very high sequence.
    await prisma.$executeRaw`
      INSERT INTO "document_number_counters" ("series", "year", "month", "last_sequence", "updated_at")
      VALUES ('INQUIRY'::"NumberSeries", 2099, 1, 99999, now())
      ON CONFLICT ("series", "year", "month") DO UPDATE SET "last_sequence" = 99999
    `;

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/inquiries`)
      .set("Authorization", authHeader)
      .send({ subject: "Should not inherit the 2099 sequence" });
    expect(res.status).toBe(201);

    const match = res.body.inquiryNumber.match(INQUIRY_NUMBER_PATTERN)!;
    expect(Number(match[3])).toBeLessThan(99999);

    // And the real current Asia/Manila year/month was used, not 2099-01.
    const nowManila = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    const expectedYear = nowManila.find((p) => p.type === "year")!.value;
    const expectedMonth = nowManila.find((p) => p.type === "month")!.value;
    expect(match[1]).toBe(expectedYear);
    expect(match[2]).toBe(expectedMonth);
  });

  it("keeps the INQUIRY and QUOTATION series' counters fully independent (shared engine, Step 3 correction)", async () => {
    const before = await prisma.$transaction((tx) => numbering.generateNumber(tx, NumberSeries.INQUIRY));
    const beforeSeq = Number(before.match(INQUIRY_NUMBER_PATTERN)![3]);

    // Generating several QUOTATION numbers must not advance INQUIRY's counter.
    const qtNumbers = await Promise.all(
      Array.from({ length: 3 }, () => prisma.$transaction((tx) => numbering.generateNumber(tx, NumberSeries.QUOTATION))),
    );
    for (const qt of qtNumbers) {
      expect(qt).toMatch(/^QT-\d{4}-\d{2}-\d{5}$/);
    }
    expect(new Set(qtNumbers).size).toBe(3);

    const after = await prisma.$transaction((tx) => numbering.generateNumber(tx, NumberSeries.INQUIRY));
    const afterSeq = Number(after.match(INQUIRY_NUMBER_PATTERN)![3]);
    expect(afterSeq).toBe(beforeSeq + 1); // advanced by exactly 1, unaffected by the 3 QT calls in between
  });

  it("Office Staff has full create/read/update/close access, per the approved RBAC table", async () => {
    const create = await fixtures.ensurePermission("inquiries", "create");
    const read = await fixtures.ensurePermission("inquiries", "read");
    const update = await fixtures.ensurePermission("inquiries", "update");
    const close = await fixtures.ensurePermission("inquiries", "close");
    const officeRole = await fixtures.createRole("inquiries-office-like", [create.id, read.id, update.id, close.id]);
    const officeUser = await fixtures.createUser("inquiries-office", UserStatus.ACTIVE, [officeRole.id]);
    const officeHeader = await loginHeader(officeUser.email, officeUser.password);
    const customer = await fixtures.createCustomer("inquiry-office-staff");

    const createRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/inquiries`)
      .set("Authorization", officeHeader)
      .send({ subject: "Office Staff created this" });
    expect(createRes.status).toBe(201);

    const closeRes = await request(app.getHttpServer())
      .patch(`/inquiries/${createRes.body.id}/close`)
      .set("Authorization", officeHeader);
    expect(closeRes.status).toBe(200);
  });

  it("inquiries.close is a distinct permission from inquiries.update (Step 3 correction)", async () => {
    const create = await fixtures.ensurePermission("inquiries", "create");
    const read = await fixtures.ensurePermission("inquiries", "read");
    const update = await fixtures.ensurePermission("inquiries", "update");
    const close = await fixtures.ensurePermission("inquiries", "close");

    // Role A: create/read/update but NOT close.
    const noCloseRole = await fixtures.createRole("inquiries-no-close", [create.id, read.id, update.id]);
    const noCloseUser = await fixtures.createUser("inquiries-no-close", UserStatus.ACTIVE, [noCloseRole.id]);
    const noCloseHeader = await loginHeader(noCloseUser.email, noCloseUser.password);
    const customerA = await fixtures.createCustomer("inquiry-perm-split-a");

    const createdByA = await request(app.getHttpServer())
      .post(`/customers/${customerA.id}/inquiries`)
      .set("Authorization", noCloseHeader)
      .send({ subject: "Can create, cannot close" });
    expect(createdByA.status).toBe(201);

    const deniedClose = await request(app.getHttpServer())
      .patch(`/inquiries/${createdByA.body.id}/close`)
      .set("Authorization", noCloseHeader);
    expect(deniedClose.status).toBe(403);

    // Role B: read/close but NOT update.
    const closeOnlyRole = await fixtures.createRole("inquiries-close-only", [read.id, close.id]);
    const closeOnlyUser = await fixtures.createUser("inquiries-close-only", UserStatus.ACTIVE, [closeOnlyRole.id]);
    const closeOnlyHeader = await loginHeader(closeOnlyUser.email, closeOnlyUser.password);

    const deniedUpdate = await request(app.getHttpServer())
      .patch(`/inquiries/${createdByA.body.id}`)
      .set("Authorization", closeOnlyHeader)
      .send({ subject: "Should be denied" });
    expect(deniedUpdate.status).toBe(403);

    const allowedClose = await request(app.getHttpServer())
      .patch(`/inquiries/${createdByA.body.id}/close`)
      .set("Authorization", closeOnlyHeader);
    expect(allowedClose.status).toBe(200);
  });

  it("Technician is denied every Inquiries endpoint (no grants yet, matching Phase 2/3 precedent)", async () => {
    const technicianRole = await fixtures.createRole("inquiries-technician-like"); // no grants
    const technician = await fixtures.createUser("inquiries-tech", UserStatus.ACTIVE, [technicianRole.id]);
    const techHeader = await loginHeader(technician.email, technician.password);
    const customer = await fixtures.createCustomer("inquiry-technician-denied");

    const res = await request(app.getHttpServer())
      .get(`/customers/${customer.id}/inquiries`)
      .set("Authorization", techHeader);
    expect(res.status).toBe(403);
  });

  it("rejects creating an inquiry under a customer that doesn't exist", async () => {
    const authHeader = sharedAuthHeader;
    const res = await request(app.getHttpServer())
      .post("/customers/00000000-0000-0000-0000-000000000000/inquiries")
      .set("Authorization", authHeader)
      .send({ subject: "Orphan inquiry" });
    expect(res.status).toBe(404);
  });
});
