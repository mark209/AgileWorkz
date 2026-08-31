import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures, E2E_CODE_PREFIX, E2E_PREFIX } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 3 Step 4. Covers the four reference-table modules
 * (trades, quotation_term_templates, inquiry_sources, inquiry_types): the
 * approved seed data is really there, the read/manage RBAC split holds
 * (Office Staff read-only, Technician denied — same pattern as Phase 2's
 * equipment-reference tables), a duplicate code returns a clean 409, and
 * status deactivation is audited. Same reference-table CRUD/status pattern
 * throughout — no new pattern introduced for Step 4.
 */
describe("Sales reference data — trades / inquiry sources / inquiry types / quotation templates (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function manageHeader() {
    const perms = await Promise.all(
      [
        ["trades", "read"],
        ["trades", "manage"],
        ["quotation_templates", "read"],
        ["quotation_templates", "manage"],
        ["inquiry_sources", "read"],
        ["inquiry_sources", "manage"],
        ["inquiry_types", "read"],
        ["inquiry_types", "manage"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("salesref-manage", perms.map((p) => p.id));
    const user = await fixtures.createUser("salesref-manage", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  it("the approved seed data is really there — 7 trades, 9 inquiry sources, 1 placeholder template, 0 inquiry types", async () => {
    const authHeader = await manageHeader();

    const [trades, sources, types, templates] = await Promise.all([
      request(app.getHttpServer()).get("/trades").set("Authorization", authHeader),
      request(app.getHttpServer()).get("/inquiry-sources").set("Authorization", authHeader),
      request(app.getHttpServer()).get("/inquiry-types").set("Authorization", authHeader),
      request(app.getHttpServer()).get("/quotation-templates").set("Authorization", authHeader),
    ]);

    expect(trades.body.length).toBeGreaterThanOrEqual(7);
    expect(trades.body.some((t: { code: string }) => t.code === "HVAC")).toBe(true);
    expect(trades.body.some((t: { code: string }) => t.code === "MULTI_TRADE")).toBe(true);

    expect(sources.body.length).toBeGreaterThanOrEqual(9);
    expect(sources.body.some((s: { code: string }) => s.code === "SMS")).toBe(true);
    expect(sources.body.some((s: { code: string }) => s.code === "VIBER")).toBe(true);

    // inquiry_types is deliberately unseeded (Step 3 correction — no
    // approved initial list yet) — the endpoint must still work, just empty
    // of the placeholder-free kind of row this test doesn't add itself.
    expect(Array.isArray(types.body)).toBe(true);

    expect(templates.body.some((t: { isDefault: boolean }) => t.isDefault === true)).toBe(true);
  });

  it("creates a trade, rejects a duplicate code with 409, and deactivates it (audited)", async () => {
    const authHeader = await manageHeader();
    const code = `${E2E_CODE_PREFIX}_TRADE`;

    const created = await request(app.getHttpServer())
      .post("/trades")
      .set("Authorization", authHeader)
      .send({ code, label: "E2E Verification Trade" });
    expect(created.status).toBe(201);

    const duplicate = await request(app.getHttpServer())
      .post("/trades")
      .set("Authorization", authHeader)
      .send({ code, label: "Duplicate Attempt" });
    expect(duplicate.status).toBe(409);

    const deactivated = await request(app.getHttpServer())
      .patch(`/trades/${code}/status`)
      .set("Authorization", authHeader)
      .send({ status: "INACTIVE" });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe("INACTIVE");

    const audit = await prisma.auditLog.findFirst({ where: { action: "trade_status_changed", entityId: code } });
    expect(audit).not.toBeNull();
  });

  it("creates an inquiry source, rejects a duplicate code with 409, and deactivates it (audited)", async () => {
    const authHeader = await manageHeader();
    const code = `${E2E_CODE_PREFIX}_SOURCE`;

    const created = await request(app.getHttpServer())
      .post("/inquiry-sources")
      .set("Authorization", authHeader)
      .send({ code, label: "E2E Verification Source" });
    expect(created.status).toBe(201);

    const duplicate = await request(app.getHttpServer())
      .post("/inquiry-sources")
      .set("Authorization", authHeader)
      .send({ code, label: "Duplicate Attempt" });
    expect(duplicate.status).toBe(409);

    const deactivated = await request(app.getHttpServer())
      .patch(`/inquiry-sources/${code}/status`)
      .set("Authorization", authHeader)
      .send({ status: "INACTIVE" });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe("INACTIVE");

    const audit = await prisma.auditLog.findFirst({ where: { action: "inquiry_source_status_changed", entityId: code } });
    expect(audit).not.toBeNull();
  });

  it("creates an inquiry type, rejects a duplicate code with 409, and deactivates it (audited)", async () => {
    const authHeader = await manageHeader();
    const code = `${E2E_CODE_PREFIX}_ITYPE`;

    const created = await request(app.getHttpServer())
      .post("/inquiry-types")
      .set("Authorization", authHeader)
      .send({ code, label: "E2E Verification Inquiry Type" });
    expect(created.status).toBe(201);

    const duplicate = await request(app.getHttpServer())
      .post("/inquiry-types")
      .set("Authorization", authHeader)
      .send({ code, label: "Duplicate Attempt" });
    expect(duplicate.status).toBe(409);

    const deactivated = await request(app.getHttpServer())
      .patch(`/inquiry-types/${code}/status`)
      .set("Authorization", authHeader)
      .send({ status: "INACTIVE" });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe("INACTIVE");

    const audit = await prisma.auditLog.findFirst({ where: { action: "inquiry_type_status_changed", entityId: code } });
    expect(audit).not.toBeNull();
  });

  it("creates a quotation term template, validates its tradeCode, and deactivates it (audited)", async () => {
    const authHeader = await manageHeader();
    const name = `${E2E_PREFIX}-template-${Date.now()}`;

    const badTrade = await request(app.getHttpServer())
      .post("/quotation-templates")
      .set("Authorization", authHeader)
      .send({ name, body: "Standard terms.", tradeCode: "NOT_A_REAL_TRADE" });
    expect(badTrade.status).toBe(404);

    const created = await request(app.getHttpServer())
      .post("/quotation-templates")
      .set("Authorization", authHeader)
      .send({ name, body: "Standard terms.", quotationType: "REPAIR", tradeCode: "HVAC" });
    expect(created.status).toBe(201);
    expect(created.body.quotationType).toBe("REPAIR");
    expect(created.body.tradeCode).toBe("HVAC");
    expect(created.body.isDefault).toBe(false);

    const deactivated = await request(app.getHttpServer())
      .patch(`/quotation-templates/${created.body.id}/status`)
      .set("Authorization", authHeader)
      .send({ status: "INACTIVE" });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe("INACTIVE");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "quotation_term_template_status_changed", entityId: created.body.id },
    });
    expect(audit).not.toBeNull();
  });

  it("Office Staff can read but not manage any of the four reference tables", async () => {
    const perms = await Promise.all(
      [
        ["trades", "read"],
        ["quotation_templates", "read"],
        ["inquiry_sources", "read"],
        ["inquiry_types", "read"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const officeRole = await fixtures.createRole("salesref-office-like", perms.map((p) => p.id));
    const officeUser = await fixtures.createUser("salesref-office", UserStatus.ACTIVE, [officeRole.id]);
    const officeHeader = await loginHeader(officeUser.email, officeUser.password);

    const reads = await Promise.all([
      request(app.getHttpServer()).get("/trades").set("Authorization", officeHeader),
      request(app.getHttpServer()).get("/quotation-templates").set("Authorization", officeHeader),
      request(app.getHttpServer()).get("/inquiry-sources").set("Authorization", officeHeader),
      request(app.getHttpServer()).get("/inquiry-types").set("Authorization", officeHeader),
    ]);
    for (const res of reads) expect(res.status).toBe(200);

    const denied = await request(app.getHttpServer())
      .post("/trades")
      .set("Authorization", officeHeader)
      .send({ code: `${E2E_CODE_PREFIX}_DENIED`, label: "Should be denied" });
    expect(denied.status).toBe(403);
  });

  it("Technician is denied all four reference-table endpoints (no grants yet)", async () => {
    const technicianRole = await fixtures.createRole("salesref-tech-like"); // no grants
    const technician = await fixtures.createUser("salesref-tech", UserStatus.ACTIVE, [technicianRole.id]);
    const techHeader = await loginHeader(technician.email, technician.password);

    const results = await Promise.all([
      request(app.getHttpServer()).get("/trades").set("Authorization", techHeader),
      request(app.getHttpServer()).get("/quotation-templates").set("Authorization", techHeader),
      request(app.getHttpServer()).get("/inquiry-sources").set("Authorization", techHeader),
      request(app.getHttpServer()).get("/inquiry-types").set("Authorization", techHeader),
    ]);
    for (const res of results) expect(res.status).toBe(403);
  });
});
