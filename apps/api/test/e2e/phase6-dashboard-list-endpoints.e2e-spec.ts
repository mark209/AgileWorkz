import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 6 (Dashboard) backend addition. Covers the two new
 * global, cross-customer listing endpoints — GET /quotations?status=... and
 * GET /work-orders?status=... — added solely so the Dashboard can build
 * Quotation/Work Order KPI cards and queues. No new permission, no
 * aggregate table, no schema change: the endpoints use the module's
 * existing read permissions and scope results to the caller.
 * Real HTTP/guard/RBAC stack.
 */
describe("Phase 6 Dashboard — global list endpoints (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;

  let admin: { user: { id: string }; authHeader: string };
  let officeStaff: { user: { id: string }; authHeader: string };
  let technician: { user: { id: string }; authHeader: string };

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function userWithPermissions(suffix: string, modules: Array<[string, string]>) {
    const perms = await Promise.all(modules.map(([module, action]) => fixtures.ensurePermission(module, action)));
    const role = await fixtures.createRole(`sr-dash-${suffix}`, perms.map((p) => p.id));
    const user = await fixtures.createUser(suffix, UserStatus.ACTIVE, [role.id]);
    const authHeader = await loginHeader(user.email, user.password);
    return { user, authHeader };
  }

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
    // Full read across both modules — stands in for Admin/Owner or Manager.
    admin = await userWithPermissions("admin", [
      ["quotations", "read"],
      ["work_orders", "read"],
    ]);
    // Office Staff holds work_orders.read (per the approved Phase 4 grants)
    // but this suite only needs it to prove read access works the same way
    // regardless of role name — reuse the same "admin" fixture shape under
    // a different identity for the read-access assertions, and a genuinely
    // scope-limited identity for the work order visibility assertion below.
    officeStaff = await userWithPermissions("office", [
      ["quotations", "read"],
      ["work_orders", "read"],
    ]);
    // Technician-equivalent: only the scoped variants, matching the real
    // seeded Technician grants exactly (work_orders.read_own/start_own,
    // no quotations permission at all).
    technician = await userWithPermissions("tech", [["work_orders", "read_own"]]);
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function seedCustomerSite(suffix: string) {
    const customer = await fixtures.createCustomer(`dash-${suffix}`);
    const site = await fixtures.createSite(customer.id, `dash-${suffix}`);
    return { customer, site };
  }

  // quotation_number/work_order_number are VarChar(30) — kept short and
  // unique via Date.now(), not E2E_PREFIX-namespaced like customer/site
  // names, since cleanupAll() removes these rows via the customer's own
  // CASCADE delete, never by matching the number itself.
  async function seedQuotation(suffix: string, status: string) {
    const { customer, site } = await seedCustomerSite(suffix);
    return prisma.quotation.create({
      data: {
        quotationNumber: `QT-DASH-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        customerId: customer.id,
        siteId: site.id,
        quotationType: "REPAIR",
        primaryTradeCode: "HVAC",
        status: status as never,
      },
    });
  }

  async function seedWorkOrder(suffix: string, status: string, extra: Record<string, unknown> = {}) {
    const { customer, site } = await seedCustomerSite(suffix);
    return prisma.workOrder.create({
      data: {
        workOrderNumber: `WO-DASH-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        customerId: customer.id,
        siteId: site.id,
        workOrderType: "STANDALONE",
        standaloneReason: "dashboard e2e fixture",
        standaloneReasonType: "INTERNAL",
        status: status as never,
        ...extra,
      },
    });
  }

  describe("GET /quotations", () => {
    it("rejects a caller with no quotations permission at all", async () => {
      const res = await request(app.getHttpServer()).get("/quotations").set("Authorization", technician.authHeader);
      expect(res.status).toBe(403);
    });

    it("returns every quotation when no status filter is given", async () => {
      const q = await seedQuotation("all", "DRAFT");
      const res = await request(app.getHttpServer()).get("/quotations").set("Authorization", admin.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.map((r: { id: string }) => r.id)).toContain(q.id);
    });

    it("filters by a comma-separated status list", async () => {
      const pending = await seedQuotation("pending", "PENDING_APPROVAL");
      const sent = await seedQuotation("sent", "SENT");
      const draft = await seedQuotation("draft-excl", "DRAFT");

      const res = await request(app.getHttpServer())
        .get("/quotations?status=PENDING_APPROVAL,SENT")
        .set("Authorization", admin.authHeader);
      expect(res.status).toBe(200);
      const ids = res.body.map((r: { id: string }) => r.id);
      expect(ids).toContain(pending.id);
      expect(ids).toContain(sent.id);
      expect(ids).not.toContain(draft.id);
    });

    it("rejects an unknown status value with 400", async () => {
      const res = await request(app.getHttpServer()).get("/quotations?status=NOT_A_REAL_STATUS").set("Authorization", admin.authHeader);
      expect(res.status).toBe(400);
    });

    it("allows a caller holding only quotations.read (Office-Staff-equivalent)", async () => {
      const res = await request(app.getHttpServer()).get("/quotations").set("Authorization", officeStaff.authHeader);
      expect(res.status).toBe(200);
    });
  });

  describe("GET /work-orders", () => {
    it("limits a Technician-equivalent to assigned work orders", async () => {
      const wo = await seedWorkOrder("unassigned", "DRAFT");
      const res = await request(app.getHttpServer()).get("/work-orders").set("Authorization", technician.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.map((r: { id: string }) => r.id)).not.toContain(wo.id);
    });

    it("returns every work order when no status filter is given", async () => {
      const wo = await seedWorkOrder("all", "DRAFT");
      const res = await request(app.getHttpServer()).get("/work-orders").set("Authorization", admin.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.map((r: { id: string }) => r.id)).toContain(wo.id);
    });

    it("filters by a comma-separated status list", async () => {
      const scheduled = await seedWorkOrder("scheduled", "SCHEDULED");
      const inProgress = await seedWorkOrder("in-progress", "IN_PROGRESS");
      const completed = await seedWorkOrder("completed-excl", "COMPLETED");

      const res = await request(app.getHttpServer())
        .get("/work-orders?status=SCHEDULED,IN_PROGRESS")
        .set("Authorization", admin.authHeader);
      expect(res.status).toBe(200);
      const ids = res.body.map((r: { id: string }) => r.id);
      expect(ids).toContain(scheduled.id);
      expect(ids).toContain(inProgress.id);
      expect(ids).not.toContain(completed.id);
    });

    it("rejects an unknown status value with 400", async () => {
      const res = await request(app.getHttpServer()).get("/work-orders?status=NOT_A_REAL_STATUS").set("Authorization", admin.authHeader);
      expect(res.status).toBe(400);
    });

    it("surfaces cancellationRequestedAt so the Dashboard's cancellation-requested queue can be derived client-side", async () => {
      const wo = await seedWorkOrder("cancel-req", "IN_PROGRESS", {
        cancellationRequestedAt: new Date(),
        cancellationRequestedBy: admin.user.id,
        cancellationRequestedReason: "dashboard e2e fixture",
      });
      const res = await request(app.getHttpServer()).get("/work-orders?status=IN_PROGRESS").set("Authorization", admin.authHeader);
      const row = res.body.find((r: { id: string }) => r.id === wo.id);
      expect(row).toBeDefined();
      expect(row.cancellationRequestedAt).not.toBeNull();
    });
  });
});
