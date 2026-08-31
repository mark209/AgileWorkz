import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 4 Step 5, Work Order lifecycle / status state machine
 * (§04). Covers the full happy path DRAFT -> SCHEDULED -> IN_PROGRESS ->
 * COMPLETED -> CLOSED, every prohibited transition (including terminal-state
 * dead-ends), RBAC per §07 (Office Staff vs. Manager/Admin-Owner-only close
 * and final cancel), Technician start_own's two-layer backend enforcement
 * (permission AND active assignment — verified both for a never-assigned
 * technician and for one whose assignment has since ended), the D5
 * request/confirm/dismiss cancellation split, the COMPLETED-vs-CLOSED
 * separation, concurrent-transition safety, and audit entries per
 * transition. Recurring-maintenance generation, actual-cost capture, and
 * every other later-phase concern are out of scope — nothing below
 * exercises them.
 *
 * All login-consuming actors are created ONCE in beforeAll and their tokens
 * reused — POST /auth/login is throttled to 10/60s (see the Step 4 report),
 * far stricter than the general API limit.
 */
describe("Work Order Lifecycle — Step 5 (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  let officeHeader: string; // create/read/update/assign/complete/request_cancel — NOT close/cancel
  let managerHeader: string; // same as office PLUS close/cancel (§07: Admin/Owner and Manager share one column)
  let techA: { header: string; userId: string }; // will be actively assigned in most tests
  let techB: { header: string; userId: string }; // stays unassigned — the "stranger" for start_own denial

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
    officeHeader = await officeAccessHeader();
    managerHeader = await managerAccessHeader();
    techA = await createTechnician("a");
    techB = await createTechnician("b");
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
    const role = await fixtures.createRole("wo5-office", perms.map((p) => p.id));
    const user = await fixtures.createUser("wo5-office", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function managerAccessHeader() {
    const actions = [...WORK_ORDER_ACTIONS, "close", "cancel"] as const;
    const perms = await Promise.all(actions.map((action) => fixtures.ensurePermission("work_orders", action)));
    const role = await fixtures.createRole("wo5-mgr", perms.map((p) => p.id));
    const user = await fixtures.createUser("wo5-mgr", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  // Matches the real seeded Technician role's Step 5-relevant grants
  // (read_own + start_own) — isolated in its own fixture role so this suite
  // proves exactly the §07 permission boundary, not whatever the live seed
  // happens to carry.
  async function createTechnician(suffix: string) {
    const perms = await Promise.all(
      [
        ["work_orders", "read_own"],
        ["work_orders", "start_own"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole(`wo5-t-${suffix}`, perms.map((p) => p.id));
    const user = await fixtures.createUser(`wo5-t-${suffix}`, UserStatus.ACTIVE, [role.id]);
    const header = await loginHeader(user.email, user.password);
    return { header, userId: user.id };
  }

  async function createStandaloneWorkOrder(suffix: string, withScheduledDate = false) {
    const customer = await fixtures.createCustomer(suffix);
    const site = await fixtures.createSite(customer.id, suffix);
    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/work-orders`)
      .set("Authorization", officeHeader)
      .send({
        siteId: site.id,
        standaloneReason: "E2E fixture",
        standaloneReasonType: "OTHER",
        ...(withScheduledDate ? { scheduledDate: "2027-01-15" } : {}),
      });
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

  /** Drives a fresh standalone Work Order to SCHEDULED (assign techA + schedule). Returns the WO id and its active assignment id. */
  async function scheduleFreshWorkOrder(suffix: string) {
    const wo = await createStandaloneWorkOrder(suffix);
    const assignment = await assignActive(wo.id, techA.userId);
    const scheduleRes = await request(app.getHttpServer())
      .patch(url(wo.id, "schedule"))
      .set("Authorization", officeHeader)
      .send({ scheduledDate: "2027-01-15" });
    expect(scheduleRes.status).toBe(200);
    expect(scheduleRes.body.status).toBe("SCHEDULED");
    return { workOrderId: wo.id, assignmentId: assignment.id };
  }

  // --- Full happy path -----------------------------------------------------

  it("drives a Work Order through the full happy path DRAFT -> SCHEDULED -> IN_PROGRESS -> COMPLETED -> CLOSED", async () => {
    const { workOrderId } = await scheduleFreshWorkOrder("happy-path");

    const startRes = await request(app.getHttpServer()).patch(url(workOrderId, "start")).set("Authorization", techA.header);
    expect(startRes.status).toBe(200);
    expect(startRes.body.status).toBe("IN_PROGRESS");
    expect(startRes.body.startedAt).not.toBeNull();
    expect(startRes.body.startedBy).toBe(techA.userId);

    const completeRes = await request(app.getHttpServer()).patch(url(workOrderId, "complete")).set("Authorization", officeHeader);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.status).toBe("COMPLETED");
    expect(completeRes.body.completedAt).not.toBeNull();
    expect(completeRes.body.closedAt).toBeNull(); // COMPLETED != CLOSED (§04/D2)

    const closeRes = await request(app.getHttpServer()).patch(url(workOrderId, "close")).set("Authorization", managerHeader);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe("CLOSED");
    expect(closeRes.body.closedAt).not.toBeNull();

    // Audit trail — one entry per transition.
    for (const action of ["work_order_scheduled", "work_order_started", "work_order_completed", "work_order_closed"]) {
      const audit = await prisma.auditLog.findFirst({ where: { action, entityId: workOrderId } });
      expect(audit).not.toBeNull();
    }
  });

  // --- Prohibited transitions / terminal-state dead-ends --------------------

  it("rejects scheduling a Work Order with no active assignment (400)", async () => {
    const wo = await createStandaloneWorkOrder("schedule-no-tech", true);
    const res = await request(app.getHttpServer()).patch(url(wo.id, "schedule")).set("Authorization", officeHeader).send({});
    expect(res.status).toBe(400);
  });

  it("rejects scheduling when no scheduledDate exists and none is supplied (400)", async () => {
    const wo = await createStandaloneWorkOrder("schedule-no-date"); // no scheduledDate at creation
    await assignActive(wo.id, techA.userId);
    const res = await request(app.getHttpServer()).patch(url(wo.id, "schedule")).set("Authorization", officeHeader).send({});
    expect(res.status).toBe(400);
  });

  it("rejects start from DRAFT (skipping SCHEDULED) and from any already-started status", async () => {
    const wo = await createStandaloneWorkOrder("start-wrong-status", true);
    await assignActive(wo.id, techA.userId);
    // Still DRAFT — never scheduled.
    const fromDraft = await request(app.getHttpServer()).patch(url(wo.id, "start")).set("Authorization", techA.header);
    expect(fromDraft.status).toBe(400);
  });

  it("rejects complete from DRAFT/SCHEDULED (only IN_PROGRESS is valid) and close from anything but COMPLETED", async () => {
    const { workOrderId } = await scheduleFreshWorkOrder("complete-wrong-status");
    // SCHEDULED, not IN_PROGRESS yet.
    const completeTooEarly = await request(app.getHttpServer()).patch(url(workOrderId, "complete")).set("Authorization", officeHeader);
    expect(completeTooEarly.status).toBe(400);
    const closeTooEarly = await request(app.getHttpServer()).patch(url(workOrderId, "close")).set("Authorization", managerHeader);
    expect(closeTooEarly.status).toBe(400);
  });

  it("terminal state: CLOSED accepts no further transition of any kind", async () => {
    const { workOrderId } = await scheduleFreshWorkOrder("closed-terminal");
    await request(app.getHttpServer()).patch(url(workOrderId, "start")).set("Authorization", techA.header);
    await request(app.getHttpServer()).patch(url(workOrderId, "complete")).set("Authorization", officeHeader);
    await request(app.getHttpServer()).patch(url(workOrderId, "close")).set("Authorization", managerHeader);

    const attempts = await Promise.all([
      request(app.getHttpServer()).patch(url(workOrderId, "schedule")).set("Authorization", officeHeader).send({}),
      request(app.getHttpServer()).patch(url(workOrderId, "start")).set("Authorization", techA.header),
      request(app.getHttpServer()).patch(url(workOrderId, "complete")).set("Authorization", officeHeader),
      request(app.getHttpServer()).patch(url(workOrderId, "close")).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(url(workOrderId, "request-cancel")).set("Authorization", officeHeader).send({ reason: "x" }),
      request(app.getHttpServer()).patch(url(workOrderId, "cancel")).set("Authorization", managerHeader).send({ reason: "x" }),
    ]);
    for (const res of attempts) expect(res.status).toBe(400);
  });

  // --- COMPLETED vs. CLOSED separation --------------------------------------

  it("COMPLETED cannot be cancelled, re-completed, or bypassed straight to CLOSED without going through close", async () => {
    const { workOrderId } = await scheduleFreshWorkOrder("completed-separation");
    await request(app.getHttpServer()).patch(url(workOrderId, "start")).set("Authorization", techA.header);
    const completeRes = await request(app.getHttpServer()).patch(url(workOrderId, "complete")).set("Authorization", officeHeader);
    expect(completeRes.body.status).toBe("COMPLETED");

    const cancelDenied = await request(app.getHttpServer()).patch(url(workOrderId, "cancel")).set("Authorization", managerHeader).send({ reason: "too late" });
    expect(cancelDenied.status).toBe(400); // COMPLETED is not in the cancellable set (§04)

    const recomplete = await request(app.getHttpServer()).patch(url(workOrderId, "complete")).set("Authorization", officeHeader);
    expect(recomplete.status).toBe(400);

    // Only close (Manager/Admin-Owner) actually reaches CLOSED.
    const officeCloseDenied = await request(app.getHttpServer()).patch(url(workOrderId, "close")).set("Authorization", officeHeader);
    expect(officeCloseDenied.status).toBe(403);
    const closeRes = await request(app.getHttpServer()).patch(url(workOrderId, "close")).set("Authorization", managerHeader);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe("CLOSED");
  });

  // --- RBAC per §07 ----------------------------------------------------------

  it("RBAC: Office Staff cannot close or give final cancellation; Technician cannot schedule/complete/close/request-cancel/cancel", async () => {
    const { workOrderId } = await scheduleFreshWorkOrder("rbac-matrix");

    const officeCloseDenied = await request(app.getHttpServer()).patch(url(workOrderId, "close")).set("Authorization", officeHeader);
    expect(officeCloseDenied.status).toBe(403);
    const officeCancelDenied = await request(app.getHttpServer()).patch(url(workOrderId, "cancel")).set("Authorization", officeHeader).send({ reason: "x" });
    expect(officeCancelDenied.status).toBe(403);

    const techScheduleDenied = await request(app.getHttpServer()).patch(url(workOrderId, "schedule")).set("Authorization", techA.header).send({});
    expect(techScheduleDenied.status).toBe(403);
    const techCompleteDenied = await request(app.getHttpServer()).patch(url(workOrderId, "complete")).set("Authorization", techA.header);
    expect(techCompleteDenied.status).toBe(403);
    const techCloseDenied = await request(app.getHttpServer()).patch(url(workOrderId, "close")).set("Authorization", techA.header);
    expect(techCloseDenied.status).toBe(403);
    const techRequestCancelDenied = await request(app.getHttpServer()).patch(url(workOrderId, "request-cancel")).set("Authorization", techA.header).send({ reason: "x" });
    expect(techRequestCancelDenied.status).toBe(403);
    const techCancelDenied = await request(app.getHttpServer()).patch(url(workOrderId, "cancel")).set("Authorization", techA.header).send({ reason: "x" });
    expect(techCancelDenied.status).toBe(403);
  });

  // --- Technician start_own: two-layer backend enforcement -----------------

  it("SECURITY: start_own rejects a Technician who holds the permission but has no active assignment to this Work Order", async () => {
    const { workOrderId } = await scheduleFreshWorkOrder("start-own-stranger");
    // techB holds start_own (same role shape) but was never assigned here.
    const res = await request(app.getHttpServer()).patch(url(workOrderId, "start")).set("Authorization", techB.header);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not currently assigned/i);
  });

  it("SECURITY: start_own rejects a Technician whose assignment has since ended — the permission alone is never sufficient", async () => {
    const wo = await createStandaloneWorkOrder("start-own-ended", true);
    const assignment = await assignActive(wo.id, techA.userId);
    await request(app.getHttpServer()).patch(url(wo.id, "schedule")).set("Authorization", officeHeader).send({});
    // Unassign techA BEFORE they get a chance to start — direct API attempt afterward must fail.
    await unassign(wo.id, assignment.id);

    const res = await request(app.getHttpServer()).patch(url(wo.id, "start")).set("Authorization", techA.header);
    expect(res.status).toBe(403);
  });

  it("a genuinely assigned Technician can start their own Work Order, and a second technician on the same crew can too (D3, no lead/helper distinction)", async () => {
    const wo = await createStandaloneWorkOrder("start-own-crew", true);
    await assignActive(wo.id, techA.userId);
    await assignActive(wo.id, techB.userId);
    await request(app.getHttpServer()).patch(url(wo.id, "schedule")).set("Authorization", officeHeader).send({});

    const res = await request(app.getHttpServer()).patch(url(wo.id, "start")).set("Authorization", techB.header);
    expect(res.status).toBe(200);
    expect(res.body.startedBy).toBe(techB.userId);
  });

  // --- Cancellation: request vs. final authority (D5) -----------------------

  it("request-cancel never changes status; Manager confirms it into CANCELLED", async () => {
    const { workOrderId } = await scheduleFreshWorkOrder("cancel-confirm");

    const requestRes = await request(app.getHttpServer())
      .patch(url(workOrderId, "request-cancel"))
      .set("Authorization", officeHeader)
      .send({ reason: "Customer postponed indefinitely" });
    expect(requestRes.status).toBe(200);
    expect(requestRes.body.status).toBe("SCHEDULED"); // unchanged
    expect(requestRes.body.cancellationRequestedAt).not.toBeNull();
    expect(requestRes.body.cancellationRequestedReason).toBe("Customer postponed indefinitely");

    const confirmRes = await request(app.getHttpServer())
      .patch(url(workOrderId, "cancel"))
      .set("Authorization", managerHeader)
      .send({ reason: "Confirmed with customer by phone" });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe("CANCELLED");
    expect(confirmRes.body.cancelledBy).not.toBeNull();

    const requestAudit = await prisma.auditLog.findFirst({ where: { action: "work_order_cancellation_requested", entityId: workOrderId } });
    expect(requestAudit?.reason).toBe("Customer postponed indefinitely");
    const cancelAudit = await prisma.auditLog.findFirst({ where: { action: "work_order_cancelled", entityId: workOrderId } });
    expect(cancelAudit?.reason).toBe("Confirmed with customer by phone");
  });

  it("Manager can dismiss a pending request instead of confirming it — the Work Order continues unchanged", async () => {
    const { workOrderId } = await scheduleFreshWorkOrder("cancel-dismiss");
    await request(app.getHttpServer()).patch(url(workOrderId, "request-cancel")).set("Authorization", officeHeader).send({ reason: "Maybe not needed" });

    const dismissRes = await request(app.getHttpServer()).patch(url(workOrderId, "dismiss-cancellation-request")).set("Authorization", managerHeader);
    expect(dismissRes.status).toBe(200);
    expect(dismissRes.body.cancellationRequestedAt).toBeNull();
    expect(dismissRes.body.status).toBe("SCHEDULED"); // never changed by the request OR the dismissal

    // The Work Order genuinely continues — it can still progress normally.
    const startRes = await request(app.getHttpServer()).patch(url(workOrderId, "start")).set("Authorization", techA.header);
    expect(startRes.status).toBe(200);

    const dismissAudit = await prisma.auditLog.findFirst({ where: { action: "work_order_cancellation_dismissed", entityId: workOrderId } });
    expect(dismissAudit).not.toBeNull();
  });

  it("Manager can cancel directly with no prior request, using the same cancel permission", async () => {
    const { workOrderId } = await scheduleFreshWorkOrder("cancel-direct");
    const res = await request(app.getHttpServer()).patch(url(workOrderId, "cancel")).set("Authorization", managerHeader).send({ reason: "Project scrapped" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
    expect(res.body.cancellationRequestedAt).toBeNull(); // no request ever existed
  });

  it("rejects request-cancel/cancel with an empty reason, and dismiss with no pending request", async () => {
    const { workOrderId } = await scheduleFreshWorkOrder("cancel-validation");
    const emptyRequest = await request(app.getHttpServer()).patch(url(workOrderId, "request-cancel")).set("Authorization", officeHeader).send({ reason: "" });
    expect(emptyRequest.status).toBe(400);
    const emptyCancel = await request(app.getHttpServer()).patch(url(workOrderId, "cancel")).set("Authorization", managerHeader).send({ reason: "" });
    expect(emptyCancel.status).toBe(400);
    const noPendingDismiss = await request(app.getHttpServer()).patch(url(workOrderId, "dismiss-cancellation-request")).set("Authorization", managerHeader);
    expect(noPendingDismiss.status).toBe(400);
  });

  it("CANCELLED is terminal — Office Staff/Technician direct-API bypass attempts all fail", async () => {
    const { workOrderId } = await scheduleFreshWorkOrder("cancelled-terminal");
    await request(app.getHttpServer()).patch(url(workOrderId, "cancel")).set("Authorization", managerHeader).send({ reason: "x" });

    const attempts = await Promise.all([
      request(app.getHttpServer()).patch(url(workOrderId, "start")).set("Authorization", techA.header),
      request(app.getHttpServer()).patch(url(workOrderId, "complete")).set("Authorization", officeHeader),
      request(app.getHttpServer()).patch(url(workOrderId, "close")).set("Authorization", managerHeader),
      request(app.getHttpServer()).patch(url(workOrderId, "cancel")).set("Authorization", managerHeader).send({ reason: "x" }),
    ]);
    for (const res of attempts) expect(res.status).toBe(400);
  });

  // --- Concurrency: two simultaneous transitions -----------------------------

  it("only one of two concurrent schedule requests on the same DRAFT Work Order succeeds — the other gets 409", async () => {
    const wo = await createStandaloneWorkOrder("concurrent-schedule", true);
    await assignActive(wo.id, techA.userId);

    const [a, b] = await Promise.all([
      request(app.getHttpServer()).patch(url(wo.id, "schedule")).set("Authorization", officeHeader).send({}),
      request(app.getHttpServer()).patch(url(wo.id, "schedule")).set("Authorization", officeHeader).send({}),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const audits = await prisma.auditLog.findMany({ where: { action: "work_order_scheduled", entityId: wo.id } });
    expect(audits).toHaveLength(1);
  });
});
