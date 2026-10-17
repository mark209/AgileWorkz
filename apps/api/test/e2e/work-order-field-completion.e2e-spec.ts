import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — RBAC correction: Technician field-completion signal
 * (work_orders.field_complete_own). Covers authorization (the permission
 * grant itself is required, not just active assignment), the two-layer
 * own-assignment enforcement (permission AND an ACTIVE work_order_assignments
 * row for this exact Work Order — mirrors start_own's precedent in
 * work-order-lifecycle.e2e-spec.ts), invalid source states, idempotent
 * repeated calls (including a second actively-assigned crew member),
 * forbidden access to a Work Order the caller isn't assigned to, that the
 * action never changes `status`, and that office/management's real
 * complete()/close() authority is entirely unaffected by a prior field
 * completion.
 *
 * All login-consuming actors are created ONCE in beforeAll and their tokens
 * reused — POST /auth/login is throttled to 10/60s (see the Step 4 report).
 */
describe("Work Order field completion — RBAC correction (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  let officeHeader: string; // create/read/update/assign/complete/request_cancel — NOT close/cancel
  let managerHeader: string; // same as office PLUS close/cancel
  let techA: { header: string; userId: string }; // holds field_complete_own, will be actively assigned
  let techB: { header: string; userId: string }; // holds field_complete_own, stays unassigned — the "stranger"
  let techNoPerm: { header: string; userId: string }; // read_own/start_own only, NO field_complete_own

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
    officeHeader = await officeAccessHeader();
    managerHeader = await managerAccessHeader();
    techA = await createTechnician("fc-a", true);
    techB = await createTechnician("fc-b", true);
    techNoPerm = await createTechnician("fc-noperm", false);
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  const WORK_ORDER_ACTIONS = ["create", "read", "update", "assign", "complete", "request_cancel"] as const;

  async function officeAccessHeader() {
    const perms = await Promise.all(WORK_ORDER_ACTIONS.map((action) => fixtures.ensurePermission("work_orders", action)));
    const role = await fixtures.createRole("wofc-office", perms.map((p) => p.id));
    const user = await fixtures.createUser("wofc-office", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function managerAccessHeader() {
    const actions = [...WORK_ORDER_ACTIONS, "close", "cancel"] as const;
    const perms = await Promise.all(actions.map((action) => fixtures.ensurePermission("work_orders", action)));
    const role = await fixtures.createRole("wofc-mgr", perms.map((p) => p.id));
    const user = await fixtures.createUser("wofc-mgr", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  // withFieldComplete=false builds a Technician holding only read_own/
  // start_own — the real seeded Technician's Phase 4 set BEFORE this RBAC
  // correction — to prove field-complete-own is a distinct, separately-
  // required grant, not something read_own/start_own already imply.
  async function createTechnician(suffix: string, withFieldComplete: boolean) {
    const actionList = withFieldComplete
      ? (["read_own", "start_own", "field_complete_own"] as const)
      : (["read_own", "start_own"] as const);
    const perms = await Promise.all(actionList.map((action) => fixtures.ensurePermission("work_orders", action)));
    const role = await fixtures.createRole(`wofc-t-${suffix}`, perms.map((p) => p.id));
    const user = await fixtures.createUser(`wofc-t-${suffix}`, UserStatus.ACTIVE, [role.id]);
    const header = await loginHeader(user.email, user.password);
    return { header, userId: user.id };
  }

  async function createStandaloneWorkOrder(suffix: string) {
    const customer = await fixtures.createCustomer(suffix);
    const site = await fixtures.createSite(customer.id, suffix);
    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/work-orders`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, standaloneReason: "E2E fixture", standaloneReasonType: "OTHER" });
    return res.body as { id: string };
  }

  async function assignActive(workOrderId: string, technicianId: string) {
    const res = await request(app.getHttpServer())
      .post(`/work-orders/${workOrderId}/assignments`)
      .set("Authorization", officeHeader)
      .send({ technicianId });
    return res.body as { id: string };
  }

  async function unassign(workOrderId: string, assignmentId: string) {
    await request(app.getHttpServer())
      .patch(`/work-orders/${workOrderId}/assignments/${assignmentId}/unassign`)
      .set("Authorization", officeHeader);
  }

  const url = (id: string, suffix: string) => `/work-orders/${id}/${suffix}`;

  async function addVerifiedReport(workOrderId: string) {
    const workOrder = await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
    const reportType = await prisma.serviceReportType.findFirstOrThrow();
    return prisma.serviceReport.create({ data: {
      serviceReportNumber: `T-${randomUUID().slice(0, 24)}`,
      customerId: workOrder.customerId, siteId: workOrder.siteId, workOrderId,
      reportTypeCode: reportType.code, status: "VERIFIED",
      documentFileKey: "test/report.pdf", documentMimeType: "application/pdf",
      documentFileName: "report.pdf", documentFileSize: 1, uploadedAt: new Date(),
    } });
  }

  /** Drives a fresh standalone Work Order to IN_PROGRESS with techA actively assigned. */
  async function inProgressWorkOrder(suffix: string, technicianId = techA.userId) {
    const wo = await createStandaloneWorkOrder(suffix);
    const assignment = await assignActive(wo.id, technicianId);
    await request(app.getHttpServer())
      .patch(url(wo.id, "schedule"))
      .set("Authorization", officeHeader)
      .send({ scheduledDate: "2027-01-15" });
    const startRes = await request(app.getHttpServer())
      .patch(url(wo.id, "start"))
      .set("Authorization", technicianId === techA.userId ? techA.header : techB.header);
    expect(startRes.status).toBe(200);
    expect(startRes.body.status).toBe("IN_PROGRESS");
    return { workOrderId: wo.id as string, assignmentId: assignment.id as string };
  }

  // --- Authorization: the permission itself is required ----------------------

  it("SECURITY: a Technician without field_complete_own is denied even though actively assigned (403)", async () => {
    const { workOrderId } = await inProgressWorkOrder("noperm-assigned");
    await assignActive(workOrderId, techNoPerm.userId);

    const res = await request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", techNoPerm.header);
    expect(res.status).toBe(403);
  });

  it("RBAC: Office Staff and Manager cannot call field-complete — it is Technician-only", async () => {
    const { workOrderId } = await inProgressWorkOrder("rbac-office-manager");

    const officeDenied = await request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", officeHeader);
    expect(officeDenied.status).toBe(403);
    const managerDenied = await request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", managerHeader);
    expect(managerDenied.status).toBe(403);
  });

  // --- Own-assignment enforcement (two-layer, mirrors start_own) -------------

  it("SECURITY: field-complete rejects a Technician who holds the permission but has no active assignment to this Work Order (403)", async () => {
    const { workOrderId } = await inProgressWorkOrder("stranger");
    // techB holds field_complete_own (same role shape) but was never assigned here.
    const res = await request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", techB.header);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not currently assigned/i);
  });

  it("SECURITY: field-complete rejects a Technician whose assignment has since ended", async () => {
    const { workOrderId, assignmentId } = await inProgressWorkOrder("ended-assignment");
    await unassign(workOrderId, assignmentId);

    const res = await request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", techA.header);
    expect(res.status).toBe(403);
  });

  // --- Invalid source states ---------------------------------------------------

  it("rejects field-complete on a Work Order that is not IN_PROGRESS (SCHEDULED)", async () => {
    const wo = await createStandaloneWorkOrder("wrong-state-scheduled");
    await assignActive(wo.id, techA.userId);
    await request(app.getHttpServer()).patch(url(wo.id, "schedule")).set("Authorization", officeHeader).send({ scheduledDate: "2027-01-15" });
    // Still SCHEDULED — never started.
    const res = await request(app.getHttpServer()).patch(url(wo.id, "field-complete")).set("Authorization", techA.header);
    expect(res.status).toBe(400);
  });

  it("rejects field-complete once the Work Order has moved past IN_PROGRESS (COMPLETED/CLOSED)", async () => {
    const { workOrderId } = await inProgressWorkOrder("wrong-state-completed");
    await addVerifiedReport(workOrderId);
    await request(app.getHttpServer()).patch(url(workOrderId, "complete")).set("Authorization", officeHeader);

    const afterComplete = await request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", techA.header);
    expect(afterComplete.status).toBe(400);

    await request(app.getHttpServer()).patch(url(workOrderId, "close")).set("Authorization", managerHeader);
    const afterClose = await request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", techA.header);
    expect(afterClose.status).toBe(400);
  });

  // --- Core behavior: never changes status, records actor/timestamp ----------

  it("marks field work complete without changing status, and records fieldCompletedAt/fieldCompletedBy", async () => {
    const { workOrderId } = await inProgressWorkOrder("core-behavior");

    const res = await request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", techA.header);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS"); // unchanged — office/management still owns the real transition
    expect(res.body.fieldCompletedAt).not.toBeNull();
    expect(res.body.fieldCompletedBy).toBe(techA.userId);
    expect(res.body.completedAt).toBeNull();
    expect(res.body.closedAt).toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { action: "work_order_field_completed", entityId: workOrderId } });
    expect(audit).not.toBeNull();
  });

  it("office/management's real complete() and close() work normally after a prior field completion", async () => {
    const { workOrderId } = await inProgressWorkOrder("field-then-office-complete");
    const fieldRes = await request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", techA.header);
    expect(fieldRes.status).toBe(200);

    await addVerifiedReport(workOrderId);

    const completeRes = await request(app.getHttpServer()).patch(url(workOrderId, "complete")).set("Authorization", officeHeader);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe("COMPLETED");
    expect(completeRes.body.fieldCompletedAt).not.toBeNull(); // preserved, not cleared

    const closeRes = await request(app.getHttpServer()).patch(url(workOrderId, "close")).set("Authorization", managerHeader);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe("CLOSED");
  });

  // --- Idempotent repeated calls ------------------------------------------------

  it("a second call by the same Technician is idempotent — same timestamp, no error, exactly one audit entry", async () => {
    const { workOrderId } = await inProgressWorkOrder("idempotent-same-tech");

    const first = await request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", techA.header);
    expect(first.status).toBe(200);
    const firstTimestamp = first.body.fieldCompletedAt;

    const second = await request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", techA.header);
    expect(second.status).toBe(200);
    expect(second.body.fieldCompletedAt).toBe(firstTimestamp); // unchanged, not re-stamped
    expect(second.body.fieldCompletedBy).toBe(techA.userId);

    const audits = await prisma.auditLog.findMany({ where: { action: "work_order_field_completed", entityId: workOrderId } });
    expect(audits).toHaveLength(1);
  });

  it("a second, different actively-assigned crew member's call is also idempotent — no error, original actor/timestamp preserved", async () => {
    const wo = await createStandaloneWorkOrder("idempotent-crew");
    await assignActive(wo.id, techA.userId);
    await assignActive(wo.id, techB.userId);
    await request(app.getHttpServer()).patch(url(wo.id, "schedule")).set("Authorization", officeHeader).send({ scheduledDate: "2027-01-15" });
    await request(app.getHttpServer()).patch(url(wo.id, "start")).set("Authorization", techA.header);

    const first = await request(app.getHttpServer()).patch(url(wo.id, "field-complete")).set("Authorization", techA.header);
    expect(first.status).toBe(200);
    expect(first.body.fieldCompletedBy).toBe(techA.userId);

    // techB is a genuinely different, actively-assigned crew member — not a stranger.
    const second = await request(app.getHttpServer()).patch(url(wo.id, "field-complete")).set("Authorization", techB.header);
    expect(second.status).toBe(200);
    expect(second.body.fieldCompletedBy).toBe(techA.userId); // first writer wins; second is a no-op, not an overwrite
    expect(second.body.fieldCompletedAt).toBe(first.body.fieldCompletedAt);

    const audits = await prisma.auditLog.findMany({ where: { action: "work_order_field_completed", entityId: wo.id } });
    expect(audits).toHaveLength(1);
  });

  // --- Concurrency -----------------------------------------------------------

  it("only one audit entry is written when two field-complete requests race on the same Work Order", async () => {
    const { workOrderId } = await inProgressWorkOrder("concurrent-field-complete");

    const [a, b] = await Promise.all([
      request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", techA.header),
      request(app.getHttpServer()).patch(url(workOrderId, "field-complete")).set("Authorization", techA.header),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const audits = await prisma.auditLog.findMany({ where: { action: "work_order_field_completed", entityId: workOrderId } });
    expect(audits).toHaveLength(1);
  });
});
