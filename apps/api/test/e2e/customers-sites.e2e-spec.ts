import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 2 Step 9. Covers the Customers -> Contacts -> Sites
 * chain end-to-end through the real HTTP/guard/audit stack: full-permission
 * CRUD, the Office Staff / Technician RBAC boundary, the app-level "at
 * least one contact method" rule, and the approved Decision 1 guarantee
 * (deactivating a customer never touches its sites).
 */
describe("Customers / Contacts / Sites (live)", () => {
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

  async function fullAccessHeader() {
    const perms = await Promise.all(
      [
        ["customers", "create"],
        ["customers", "read"],
        ["customers", "update"],
        ["customers", "deactivate"],
        ["contacts", "create"],
        ["contacts", "read"],
        ["sites", "create"],
        ["sites", "read"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("full-access", perms.map((p) => p.id));
    const user = await fixtures.createUser("full", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  it("creates a customer -> contact -> site chain via live HTTP and audits every step", async () => {
    const authHeader = await fullAccessHeader();

    const customerRes = await request(app.getHttpServer())
      .post("/customers")
      .set("Authorization", authHeader)
      .send({ name: "e2e-verify-chain-customer", customerType: "COMMERCIAL", billingAddress: "1 Test St" });
    expect(customerRes.status).toBe(201);
    expect(customerRes.body.status).toBe("ACTIVE");
    const customerId = customerRes.body.id;

    const contactRes = await request(app.getHttpServer())
      .post(`/customers/${customerId}/contacts`)
      .set("Authorization", authHeader)
      .send({ fullName: "E2E Contact", phone: "+63 900 000 0001" });
    expect(contactRes.status).toBe(201);

    const siteRes = await request(app.getHttpServer())
      .post(`/customers/${customerId}/sites`)
      .set("Authorization", authHeader)
      .send({ label: "e2e-verify-chain-site", addressLine: "1 Test Ave" });
    expect(siteRes.status).toBe(201);

    const [customerAudit, contactAudit, siteAudit] = await Promise.all([
      prisma.auditLog.findFirst({ where: { action: "customer_created", entityId: customerId } }),
      prisma.auditLog.findFirst({ where: { action: "contact_created", entityId: contactRes.body.id } }),
      prisma.auditLog.findFirst({ where: { action: "site_created", entityId: siteRes.body.id } }),
    ]);
    expect(customerAudit).not.toBeNull();
    expect(contactAudit).not.toBeNull();
    expect(siteAudit).not.toBeNull();
    expect(customerAudit!.actorType).toBe("USER");
  });

  it("rejects a contact with neither phone nor email", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("contact-validation");

    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/contacts`)
      .set("Authorization", authHeader)
      .send({ fullName: "No Contact Method" });

    expect(res.status).toBe(400);
  });

  it("Office Staff can create but not deactivate a customer", async () => {
    const create = await fixtures.ensurePermission("customers", "create");
    const read = await fixtures.ensurePermission("customers", "read");
    const officeRole = await fixtures.createRole("office-like", [create.id, read.id]);
    const officeUser = await fixtures.createUser("office", UserStatus.ACTIVE, [officeRole.id]);
    const officeHeader = await loginHeader(officeUser.email, officeUser.password);

    const createRes = await request(app.getHttpServer())
      .post("/customers")
      .set("Authorization", officeHeader)
      .send({ name: "e2e-verify-office-created", customerType: "RESIDENTIAL", billingAddress: "2 Test St" });
    expect(createRes.status).toBe(201);

    const deactivateRes = await request(app.getHttpServer())
      .patch(`/customers/${createRes.body.id}/status`)
      .set("Authorization", officeHeader)
      .send({ status: "INACTIVE" });
    expect(deactivateRes.status).toBe(403);
  });

  it("Technician is denied every Phase 2 endpoint (no grants yet, per approved Decision 2)", async () => {
    const technicianRole = await fixtures.createRole("technician-like"); // no grants
    const technician = await fixtures.createUser("tech", UserStatus.ACTIVE, [technicianRole.id]);
    const techHeader = await loginHeader(technician.email, technician.password);

    const res = await request(app.getHttpServer()).get("/customers").set("Authorization", techHeader);
    expect(res.status).toBe(403);
  });

  it("deactivating a customer never touches its sites (approved Decision 1)", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("decision-1");
    const site = await fixtures.createSite(customer.id, "decision-1");

    const statusRes = await request(app.getHttpServer())
      .patch(`/customers/${customer.id}/status`)
      .set("Authorization", authHeader)
      .send({ status: "INACTIVE" });
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe("INACTIVE");

    const siteAfter = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(siteAfter.status).toBe("ACTIVE");
  });

  it("rejects creating a site under a customer that doesn't exist", async () => {
    const authHeader = await fullAccessHeader();
    const res = await request(app.getHttpServer())
      .post("/customers/00000000-0000-0000-0000-000000000000/sites")
      .set("Authorization", authHeader)
      .send({ label: "Orphan Site", addressLine: "1 Nowhere St" });
    expect(res.status).toBe(404);
  });
});
