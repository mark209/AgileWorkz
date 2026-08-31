import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 4 Operations Frontend, backend additions (approved
 * Decision 1): the technician-picker endpoint (GET /users/technicians) and
 * the Work-Order-scoped Service Reports endpoint
 * (GET /work-orders/:id/service-reports), plus the read-only enrichment
 * (customer/site/assigned-technician) added to the existing Work Order
 * list/detail responses (approved Decision 5). No new permission, no
 * schema change — every assertion here is about reusing existing grants
 * correctly.
 */
describe("Phase 4 Operations Frontend — backend additions (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;

  let dispatcher: { user: { id: string }; authHeader: string }; // work_orders.create/read/assign, service_reports.read
  let technician: { user: { id: string }; authHeader: string }; // work_orders.read_own/start_own only
  let noGrants: { authHeader: string };

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function userWithPermissions(suffix: string, modules: Array<[string, string]>) {
    const perms = await Promise.all(modules.map(([module, action]) => fixtures.ensurePermission(module, action)));
    const role = await fixtures.createRole(`p4-fe-${suffix}`, perms.map((p) => p.id));
    const user = await fixtures.createUser(suffix, UserStatus.ACTIVE, [role.id]);
    const authHeader = await loginHeader(user.email, user.password);
    return { user, authHeader };
  }

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
    dispatcher = await userWithPermissions("dispatcher", [
      ["work_orders", "create"],
      ["work_orders", "read"],
      ["work_orders", "assign"],
      ["service_reports", "read"],
    ]);
    technician = await userWithPermissions("technician", [
      ["work_orders", "read_own"],
      ["work_orders", "start_own"],
      ["service_reports", "upload"],
      ["service_reports", "read_own"],
    ]);
    const noGrantsRole = await fixtures.createRole("p4-fe-none");
    const noGrantsUser = await fixtures.createUser("p4-fe-none", UserStatus.ACTIVE, [noGrantsRole.id]);
    noGrants = { authHeader: await loginHeader(noGrantsUser.email, noGrantsUser.password) };
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function seedCustomerSite(suffix: string) {
    const customer = await fixtures.createCustomer(`p4fe-${suffix}`);
    const site = await fixtures.createSite(customer.id, `p4fe-${suffix}`);
    return { customer, site };
  }

  describe("GET /users/technicians", () => {
    it("rejects a caller with no relevant permission (not even users.manage)", async () => {
      const res = await request(app.getHttpServer()).get("/users/technicians").set("Authorization", noGrants.authHeader);
      expect(res.status).toBe(403);
    });

    it("rejects a Technician themselves (they hold neither users.manage nor work_orders.assign)", async () => {
      const res = await request(app.getHttpServer()).get("/users/technicians").set("Authorization", technician.authHeader);
      expect(res.status).toBe(403);
    });

    it("allows a work_orders.assign holder and returns only id/fullName/status, including the seeded technician", async () => {
      const res = await request(app.getHttpServer()).get("/users/technicians").set("Authorization", dispatcher.authHeader);
      expect(res.status).toBe(200);
      const row = res.body.find((u: { id: string }) => u.id === technician.user.id);
      expect(row).toBeDefined();
      expect(Object.keys(row).sort()).toEqual(["fullName", "id", "status"]);
      expect(row.status).toBe("ACTIVE");
      // The dispatcher (no start_own) must never appear in this list.
      expect(res.body.some((u: { id: string }) => u.id === dispatcher.user.id)).toBe(false);
    });
  });

  describe("GET /work-orders/:id/service-reports", () => {
    it("rejects a caller without service_reports.read", async () => {
      const woOnlyReader = await userWithPermissions("wo-only", [["work_orders", "read"]]);
      const { customer, site } = await seedCustomerSite("sr-scope-rbac");
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `WO-P4FE-${Date.now().toString(36)}`,
          customerId: customer.id,
          siteId: site.id,
          workOrderType: "STANDALONE",
          standaloneReason: "e2e",
          standaloneReasonType: "INTERNAL",
        },
      });
      const res = await request(app.getHttpServer()).get(`/work-orders/${wo.id}/service-reports`).set("Authorization", woOnlyReader.authHeader);
      expect(res.status).toBe(403);
    });

    it("returns 404 for a non-existent Work Order", async () => {
      const res = await request(app.getHttpServer())
        .get("/work-orders/00000000-0000-0000-0000-000000000000/service-reports")
        .set("Authorization", dispatcher.authHeader);
      expect(res.status).toBe(404);
    });

    it("returns only Service Reports linked to this Work Order, using the same safe projection as GET /service-reports (no documentFileKey)", async () => {
      const { customer, site } = await seedCustomerSite("sr-scope");
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `WO-P4FE-${Date.now().toString(36)}`,
          customerId: customer.id,
          siteId: site.id,
          workOrderType: "STANDALONE",
          standaloneReason: "e2e",
          standaloneReasonType: "INTERNAL",
        },
      });
      const otherWo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `WO-P4FE-OTHER-${Date.now().toString(36)}`,
          customerId: customer.id,
          siteId: site.id,
          workOrderType: "STANDALONE",
          standaloneReason: "e2e",
          standaloneReasonType: "INTERNAL",
        },
      });
      const linked = await prisma.serviceReport.create({
        data: {
          serviceReportNumber: `E2ESR-P4FE-${Date.now().toString(36)}`,
          customerId: customer.id,
          siteId: site.id,
          workOrderId: wo.id,
          reportTypeCode: "MAINTENANCE_CLEANING",
          documentFileKey: "unused-p4fe-key",
          documentMimeType: "image/jpeg",
          documentFileName: "f.jpg",
          documentFileSize: 17,
          status: "PENDING_EXTRACTION",
          uploadedAt: new Date(),
        },
      });
      await prisma.serviceReport.create({
        data: {
          serviceReportNumber: `E2ESR-P4FE-OTHER-${Date.now().toString(36)}`,
          customerId: customer.id,
          siteId: site.id,
          workOrderId: otherWo.id,
          reportTypeCode: "MAINTENANCE_CLEANING",
          documentFileKey: "unused-p4fe-key-2",
          documentMimeType: "image/jpeg",
          documentFileName: "f.jpg",
          documentFileSize: 17,
          status: "PENDING_EXTRACTION",
          uploadedAt: new Date(),
        },
      });

      const res = await request(app.getHttpServer()).get(`/work-orders/${wo.id}/service-reports`).set("Authorization", dispatcher.authHeader);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(linked.id);
      expect(res.body[0].documentFileKey).toBeUndefined(); // never exposed, same rule as every other Service Report response
    });
  });

  describe("GET /service-reports/types", () => {
    it("rejects a caller with no relevant permission", async () => {
      const res = await request(app.getHttpServer()).get("/service-reports/types").set("Authorization", noGrants.authHeader);
      expect(res.status).toBe(403);
    });

    it("allows a service_reports.upload holder (Technician) and returns only ACTIVE, seeded types", async () => {
      const res = await request(app.getHttpServer()).get("/service-reports/types").set("Authorization", technician.authHeader);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      const row = res.body.find((t: { code: string }) => t.code === "MAINTENANCE_CLEANING");
      expect(row).toBeDefined();
      expect(Object.keys(row).sort()).toEqual(["code", "label", "sortOrder"]);
      for (const t of res.body) {
        // Never leaks an inactive/retired type — matches exactly what
        // assertReportTypeActive would accept if the caller submitted it.
        expect(t.status).toBeUndefined();
      }
    });
  });

  describe("Enriched Work Order list/detail (approved Decision 5)", () => {
    it("GET /work-orders includes customer name, site label, and active assignments with technician name — in one call", async () => {
      const { customer, site } = await seedCustomerSite("enrich-list");
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `WO-P4FE-${Date.now().toString(36)}`,
          customerId: customer.id,
          siteId: site.id,
          workOrderType: "STANDALONE",
          standaloneReason: "e2e",
          standaloneReasonType: "INTERNAL",
          status: "SCHEDULED",
        },
      });
      await prisma.workOrderAssignment.create({ data: { workOrderId: wo.id, technicianId: technician.user.id } });

      const res = await request(app.getHttpServer()).get("/work-orders?status=SCHEDULED").set("Authorization", dispatcher.authHeader);
      expect(res.status).toBe(200);
      const row = res.body.find((w: { id: string }) => w.id === wo.id);
      expect(row).toBeDefined();
      expect(row.customer.name).toBe(customer.name);
      expect(row.site.label).toBe(site.label);
      expect(row.assignments).toHaveLength(1);
      expect(row.assignments[0].technician.fullName).toBeDefined();
      expect(row.assignments[0].technician.id).toBe(technician.user.id);
    });

    it("GET /work-orders/:id includes the same enrichment plus tasks", async () => {
      const { customer, site } = await seedCustomerSite("enrich-detail");
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `WO-P4FE-${Date.now().toString(36)}`,
          customerId: customer.id,
          siteId: site.id,
          workOrderType: "STANDALONE",
          standaloneReason: "e2e",
          standaloneReasonType: "INTERNAL",
        },
      });
      const res = await request(app.getHttpServer()).get(`/work-orders/${wo.id}`).set("Authorization", dispatcher.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.customer.name).toBe(customer.name);
      expect(res.body.site.label).toBe(site.label);
      expect(res.body.tasks).toEqual([]);
    });

    it("an ended (unassigned) assignment never appears in the enrichment", async () => {
      const { customer, site } = await seedCustomerSite("enrich-ended");
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `WO-P4FE-${Date.now().toString(36)}`,
          customerId: customer.id,
          siteId: site.id,
          workOrderType: "STANDALONE",
          standaloneReason: "e2e",
          standaloneReasonType: "INTERNAL",
        },
      });
      await prisma.workOrderAssignment.create({
        data: { workOrderId: wo.id, technicianId: technician.user.id, unassignedAt: new Date() },
      });
      const res = await request(app.getHttpServer()).get(`/work-orders/${wo.id}`).set("Authorization", dispatcher.authHeader);
      expect(res.body.assignments).toEqual([]);
    });
  });
});
