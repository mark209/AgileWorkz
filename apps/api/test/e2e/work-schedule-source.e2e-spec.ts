import { INestApplication } from "@nestjs/common";
import { UserStatus } from "@prisma/client";
import request from "supertest";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

describe("Work Schedule existing Work Order source (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  const actors: Record<string, { id: string; header: string }> = {};

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
    for (const [key, action] of [["admin", "read"], ["manager", "read_assigned"], ["technician", "read_own"], ["other", "read_assigned"], ["denied", ""]]) {
      const permissions = action ? [(await fixtures.ensurePermission("work_orders", action)).id] : [];
      const role = await fixtures.createRole(`schedule-${key}`, permissions);
      const user = await fixtures.createUser(`schedule-${key}`, UserStatus.ACTIVE, [role.id]);
      const login = await request(app.getHttpServer()).post("/auth/login").send({ email: user.email, password: user.password });
      expect(login.status).toBe(200);
      actors[key] = { id: user.id, header: `Bearer ${login.body.accessToken}` };
    }
  });
  afterAll(async () => { await fixtures.cleanupAll(); await app.close(); });

  it("preserves broad, responsible-Manager and active-technician visibility without new permissions", async () => {
    const customer = await fixtures.createCustomer("schedule-scopes");
    const site = await fixtures.createSite(customer.id, "schedule-scopes");
    const own = await prisma.workOrder.create({ data: { workOrderNumber: `SCHEDULE-OWN-${Date.now()}`, customerId: customer.id, siteId: site.id,
      workOrderType: "STANDALONE", responsibleManagerId: actors.manager.id, scheduledDate: new Date("2026-11-20"),
      assignments: { create: { technicianId: actors.technician.id, assignedBy: actors.admin.id } } } });
    const other = await prisma.workOrder.create({ data: { workOrderNumber: `SCHEDULE-OTHER-${Date.now()}`, customerId: customer.id, siteId: site.id,
      workOrderType: "STANDALONE", responsibleManagerId: actors.other.id } });
    for (const [key, expected, excluded] of [["admin", [own.id, other.id], []], ["manager", [own.id], [other.id]], ["technician", [own.id], [other.id]] ] as Array<[string, string[], string[]]>) {
      const response = await request(app.getHttpServer()).get("/work-orders").set("Authorization", actors[key].header);
      expect(response.status).toBe(200);
      const ids = response.body.map((row: { id: string }) => row.id);
      for (const id of expected) expect(ids).toContain(id);
      for (const id of excluded) expect(ids).not.toContain(id);
    }
    const detail = await request(app.getHttpServer()).get(`/work-orders/${own.id}`).set("Authorization", actors.technician.header);
    expect(detail.status).toBe(200);
    expect(detail.body.customer.name).toBe(customer.name);
    expect(detail.body.assignments[0].technician.id).toBe(actors.technician.id);
    expect((await request(app.getHttpServer()).get("/work-orders").set("Authorization", actors.denied.header)).status).toBe(403);
    expect((await request(app.getHttpServer()).get(`/work-orders/${other.id}`).set("Authorization", actors.technician.header)).status).toBe(403);

    await prisma.workOrderAssignment.updateMany({ where: { workOrderId: own.id }, data: { unassignedAt: new Date() } });
    const ended = await request(app.getHttpServer()).get("/work-orders").set("Authorization", actors.technician.header);
    expect(ended.body.map((row: { id: string }) => row.id)).not.toContain(own.id);
  });

  it("returns new schedule dates, completion, cancellation and newly created orders on the next read", async () => {
    const customer = await fixtures.createCustomer("schedule-refresh");
    const site = await fixtures.createSite(customer.id, "schedule-refresh");
    const job = await prisma.workOrder.create({ data: { workOrderNumber: `SCHEDULE-REFRESH-${Date.now()}`, customerId: customer.id, siteId: site.id,
      workOrderType: "STANDALONE", responsibleManagerId: actors.manager.id } });
    const read = async () => {
      const response = await request(app.getHttpServer()).get("/work-orders").set("Authorization", actors.manager.header);
      expect(response.status).toBe(200);
      return response.body.find((row: { id: string }) => row.id === job.id);
    };
    expect((await read()).scheduledDate).toBeNull();
    await prisma.workOrder.update({ where: { id: job.id }, data: { scheduledDate: new Date("2026-11-21"), status: "SCHEDULED" } });
    expect((await read()).scheduledDate).toBe("2026-11-21T00:00:00.000Z");
    await prisma.workOrder.update({ where: { id: job.id }, data: { scheduledDate: new Date("2026-11-25") } });
    expect((await read()).scheduledDate).toBe("2026-11-25T00:00:00.000Z");
    await prisma.workOrder.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
    expect((await read()).status).toBe("COMPLETED");
    await prisma.workOrder.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    expect((await read()).status).toBe("CANCELLED");
  });
});
