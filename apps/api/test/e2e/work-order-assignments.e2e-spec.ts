import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 4 Step 4, Technician Assignment module and the D4
 * server-side ownership enforcement behind work_orders.read_own. Covers:
 * assign/unassign (Office Staff+ only, §07), team assignment (D3 — multiple
 * simultaneously-active technicians on one Work Order), append-only history
 * (reassignment never overwrites a historical row), an assigned Technician
 * reading their own Work Order, an unassigned Technician being denied 403
 * on direct API access to someone else's Work Order, GET /work-orders/mine
 * returning only actively-assigned Work Orders, an ended assignment no
 * longer granting access, Step 3 creation paths remaining unaffected, and
 * audit entries for every assignment action. Lifecycle transitions
 * (including Technician self-start) are Step 5 — nothing below exercises
 * them; every Work Order here stays in DRAFT throughout.
 *
 * All login-consuming actors (office user, 3 technicians, one no-grants
 * user) are created ONCE in beforeAll and their tokens reused across every
 * test — POST /auth/login is throttled to 10/60s (auth.controller.ts), far
 * stricter than the general 100/60s API limit, so per-test logins would
 * blow through it. Reusing a small fixed pool of technicians across
 * different Work Orders is safe: assignment state is scoped per
 * (workOrderId, technicianId) and every test creates its own fresh Work
 * Order, so nothing leaks between tests.
 */
describe("Work Order Assignments — Step 4 (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  let officeHeader: string; // work_orders.create/read/assign + quotations.create/read/update
  let techA: { header: string; userId: string };
  let techB: { header: string; userId: string };
  let techC: { header: string; userId: string };
  let noPermsHeader: string; // authenticated, but holds neither work_orders.read nor read_own

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
    officeHeader = await officeAccessHeader();
    techA = await createTechnician("a");
    techB = await createTechnician("b");
    techC = await createTechnician("c");
    const noPermsRole = await fixtures.createRole("wo4-none");
    const noPermsUser = await fixtures.createUser("wo4-none", UserStatus.ACTIVE, [noPermsRole.id]);
    noPermsHeader = await loginHeader(noPermsUser.email, noPermsUser.password);
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function officeAccessHeader() {
    const perms = await Promise.all(
      [
        ["work_orders", "create"],
        ["work_orders", "read"],
        ["work_orders", "assign"],
        ["quotations", "create"],
        ["quotations", "read"],
        ["quotations", "update"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("wo4-office", perms.map((p) => p.id));
    const user = await fixtures.createUser("wo4-office", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  // Deliberately grants ONLY read_own — matches §07's exact Technician
  // column, isolated from whatever the real seeded Technician role also
  // carries (start_own, Step 5) so this suite proves exactly the Step 4
  // permission boundary, nothing more.
  async function createTechnician(suffix: string) {
    const perm = await fixtures.ensurePermission("work_orders", "read_own");
    const role = await fixtures.createRole(`wo4-t-${suffix}`, [perm.id]);
    const user = await fixtures.createUser(`wo4-t-${suffix}`, UserStatus.ACTIVE, [role.id]);
    const header = await loginHeader(user.email, user.password);
    return { header, userId: user.id };
  }

  // Two-level approval correction: submit no longer auto-approves under any
  // circumstance — the Step 3 regression test below needs an explicit
  // Manager approval to reach ACCEPTED. Office Staff has zero approval
  // authority, so this is a separate, minimally-scoped actor.
  async function managerAccessHeader() {
    const perm = await fixtures.ensurePermission("quotations", "approve");
    const role = await fixtures.createRole("wo4-mgr", [perm.id]);
    const user = await fixtures.createUser("wo4-mgr", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  async function createCustomerAndSite(suffix: string) {
    const customer = await fixtures.createCustomer(suffix);
    const site = await fixtures.createSite(customer.id, suffix);
    return { customer, site };
  }

  async function createStandaloneWorkOrder(suffix: string) {
    const { customer, site } = await createCustomerAndSite(suffix);
    const res = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/work-orders`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, standaloneReason: "E2E fixture", standaloneReasonType: "OTHER" });
    return res.body as { id: string };
  }

  const assignmentsUrl = (workOrderId: string) => `/work-orders/${workOrderId}/assignments`;
  const unassignUrl = (workOrderId: string, assignmentId: string) => `${assignmentsUrl(workOrderId)}/${assignmentId}/unassign`;

  // --- 1/2/3: assign, team assignment, append-only reassignment history ----

  it("Office Staff assigns a technician; GET /work-orders/:id shows the active assignment", async () => {
    const wo = await createStandaloneWorkOrder("assign-happy");

    const assignRes = await request(app.getHttpServer())
      .post(assignmentsUrl(wo.id))
      .set("Authorization", officeHeader)
      .send({ technicianId: techA.userId });
    expect(assignRes.status).toBe(201);
    expect(assignRes.body.workOrderId).toBe(wo.id);
    expect(assignRes.body.technicianId).toBe(techA.userId);
    expect(assignRes.body.unassignedAt).toBeNull();

    const woRes = await request(app.getHttpServer()).get(`/work-orders/${wo.id}`).set("Authorization", officeHeader);
    expect(woRes.body.assignments).toHaveLength(1);
    expect(woRes.body.assignments[0].technicianId).toBe(techA.userId);

    // Clean up the active assignment so techA starts the next test unassigned.
    await request(app.getHttpServer()).patch(unassignUrl(wo.id, assignRes.body.id)).set("Authorization", officeHeader);
  });

  it("D3: multiple technicians can be simultaneously active on the same Work Order (a crew)", async () => {
    const wo = await createStandaloneWorkOrder("team-assign");

    const resA = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: techA.userId });
    const resB = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: techB.userId });
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const list = await request(app.getHttpServer()).get(assignmentsUrl(wo.id)).set("Authorization", officeHeader);
    const active = list.body.filter((a: { unassignedAt: string | null }) => a.unassignedAt === null);
    expect(active).toHaveLength(2);

    // Both technicians can read the Work Order — equal access, no lead/helper distinction (D3).
    const getA = await request(app.getHttpServer()).get(`/work-orders/${wo.id}`).set("Authorization", techA.header);
    const getB = await request(app.getHttpServer()).get(`/work-orders/${wo.id}`).set("Authorization", techB.header);
    expect(getA.status).toBe(200);
    expect(getB.status).toBe(200);

    await request(app.getHttpServer()).patch(unassignUrl(wo.id, resA.body.id)).set("Authorization", officeHeader);
    await request(app.getHttpServer()).patch(unassignUrl(wo.id, resB.body.id)).set("Authorization", officeHeader);
  });

  it("rejects assigning the same technician twice while already active (409)", async () => {
    const wo = await createStandaloneWorkOrder("double-assign");
    const first = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: techA.userId });
    const dupe = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: techA.userId });
    expect(dupe.status).toBe(409);
    await request(app.getHttpServer()).patch(unassignUrl(wo.id, first.body.id)).set("Authorization", officeHeader);
  });

  it("append-only history: unassign then reassign the same technician preserves BOTH rows, never overwriting the first", async () => {
    const wo = await createStandaloneWorkOrder("reassign-history");

    const firstAssign = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: techA.userId });
    const unassignRes = await request(app.getHttpServer()).patch(unassignUrl(wo.id, firstAssign.body.id)).set("Authorization", officeHeader);
    expect(unassignRes.status).toBe(200);
    expect(unassignRes.body.unassignedAt).not.toBeNull();
    expect(unassignRes.body.id).toBe(firstAssign.body.id); // same row, ended — not deleted

    const secondAssign = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: techA.userId });
    expect(secondAssign.status).toBe(201);
    expect(secondAssign.body.id).not.toBe(firstAssign.body.id); // a genuinely new row

    const list = await request(app.getHttpServer()).get(assignmentsUrl(wo.id)).set("Authorization", officeHeader);
    expect(list.body).toHaveLength(2); // both rows still present
    const ids = list.body.map((a: { id: string }) => a.id).sort();
    expect(ids).toEqual([firstAssign.body.id, secondAssign.body.id].sort());
    const first = list.body.find((a: { id: string }) => a.id === firstAssign.body.id);
    expect(first.unassignedAt).not.toBeNull(); // history intact, not reset by the later reassignment

    await request(app.getHttpServer()).patch(unassignUrl(wo.id, secondAssign.body.id)).set("Authorization", officeHeader);
  });

  it("rejects unassigning an already-ended assignment (400), and unassigning a foreign id (404)", async () => {
    const wo = await createStandaloneWorkOrder("unassign-edge-cases");
    const assign = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: techA.userId });
    await request(app.getHttpServer()).patch(unassignUrl(wo.id, assign.body.id)).set("Authorization", officeHeader);

    const alreadyEnded = await request(app.getHttpServer()).patch(unassignUrl(wo.id, assign.body.id)).set("Authorization", officeHeader);
    expect(alreadyEnded.status).toBe(400);

    const otherWo = await createStandaloneWorkOrder("unassign-edge-cases-2");
    const foreignId = await request(app.getHttpServer()).patch(unassignUrl(otherWo.id, assign.body.id)).set("Authorization", officeHeader);
    expect(foreignId.status).toBe(404);
  });

  // --- 4/5: assigned Technician reads own WO; unassigned gets 403 on another's --

  it("an assigned Technician can retrieve their own Work Order by id", async () => {
    const wo = await createStandaloneWorkOrder("tech-reads-own");
    const assign = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: techA.userId });

    const res = await request(app.getHttpServer()).get(`/work-orders/${wo.id}`).set("Authorization", techA.header);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(wo.id);

    await request(app.getHttpServer()).patch(unassignUrl(wo.id, assign.body.id)).set("Authorization", officeHeader);
  });

  it("SECURITY: a Technician with no assignment to a Work Order gets 403 calling GET /work-orders/:id directly, even knowing its real id", async () => {
    const wo = await createStandaloneWorkOrder("tech-denied-foreign");
    const ownerAssign = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: techA.userId });

    // techB was never assigned to this Work Order at all.
    const strangerRes = await request(app.getHttpServer()).get(`/work-orders/${wo.id}`).set("Authorization", techB.header);
    expect(strangerRes.status).toBe(403);
    expect(strangerRes.body.message).toMatch(/not currently assigned/i);

    // A user with neither read nor read_own also gets 403, not a 500 or a silent 200.
    const noPermsRes = await request(app.getHttpServer()).get(`/work-orders/${wo.id}`).set("Authorization", noPermsHeader);
    expect(noPermsRes.status).toBe(403);

    await request(app.getHttpServer()).patch(unassignUrl(wo.id, ownerAssign.body.id)).set("Authorization", officeHeader);
  });

  // --- 6/7: /work-orders/mine scoping, and ended assignments losing access --

  it("GET /work-orders/mine returns only actively-assigned Work Orders, and an ended assignment stops appearing", async () => {
    const wo1 = await createStandaloneWorkOrder("mine-scope-1");
    const wo2 = await createStandaloneWorkOrder("mine-scope-2");

    const assign1 = await request(app.getHttpServer()).post(assignmentsUrl(wo1.id)).set("Authorization", officeHeader).send({ technicianId: techA.userId });
    // Deliberately NOT assigned to wo2.

    const mineBefore = await request(app.getHttpServer()).get("/work-orders/mine").set("Authorization", techA.header);
    expect(mineBefore.status).toBe(200);
    const idsBefore = mineBefore.body.map((w: { id: string }) => w.id);
    expect(idsBefore).toContain(wo1.id);
    expect(idsBefore).not.toContain(wo2.id);

    // 7 — ending the assignment removes both list visibility and direct-id access.
    await request(app.getHttpServer()).patch(unassignUrl(wo1.id, assign1.body.id)).set("Authorization", officeHeader);

    const mineAfter = await request(app.getHttpServer()).get("/work-orders/mine").set("Authorization", techA.header);
    expect(mineAfter.body.map((w: { id: string }) => w.id)).not.toContain(wo1.id);

    const directAfter = await request(app.getHttpServer()).get(`/work-orders/${wo1.id}`).set("Authorization", techA.header);
    expect(directAfter.status).toBe(403);
  });

  // --- RBAC: assignment mutation is Office Staff+ only, never Technician ---

  it("RBAC: Technician cannot assign or unassign — 403 on both routes", async () => {
    const wo = await createStandaloneWorkOrder("tech-cannot-assign");

    const assignDenied = await request(app.getHttpServer())
      .post(assignmentsUrl(wo.id))
      .set("Authorization", techA.header)
      .send({ technicianId: techB.userId });
    expect(assignDenied.status).toBe(403);

    const realAssign = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: techB.userId });
    const unassignDenied = await request(app.getHttpServer()).patch(unassignUrl(wo.id, realAssign.body.id)).set("Authorization", techA.header);
    expect(unassignDenied.status).toBe(403);

    await request(app.getHttpServer()).patch(unassignUrl(wo.id, realAssign.body.id)).set("Authorization", officeHeader);
  });

  it("rejects assigning a nonexistent user (404) and an inactive user (400)", async () => {
    const wo = await createStandaloneWorkOrder("assign-invalid-technician");
    const notFound = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: "00000000-0000-0000-0000-000000000099" });
    expect(notFound.status).toBe(404);

    const inactiveUser = await fixtures.createUser("wo4-inactive", UserStatus.SUSPENDED, []);
    const inactive = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: inactiveUser.id });
    expect(inactive.status).toBe(400);
  });

  // --- 8: Step 3 creation paths remain unaffected -------------------------

  it("Step 3 regression: standalone creation and quotation conversion still work unchanged", async () => {
    const { customer, site } = await createCustomerAndSite("step3-regression");
    const standaloneRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/work-orders`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, standaloneReason: "Regression check", standaloneReasonType: "OTHER" });
    expect(standaloneRes.status).toBe(201);
    expect(standaloneRes.body.workOrderNumber).toMatch(/^WO-\d{4}-\d{2}-\d{5}$/);

    const quotationRes = await request(app.getHttpServer())
      .post(`/customers/${customer.id}/quotations`)
      .set("Authorization", officeHeader)
      .send({ siteId: site.id, quotationType: "REPAIR", primaryTradeCode: "HVAC" });
    const quotationId = quotationRes.body.id;
    const revisionId = (
      await request(app.getHttpServer()).get(`/quotations/${quotationId}/revisions`).set("Authorization", officeHeader)
    ).body[0].id;
    await request(app.getHttpServer())
      .post(`/quotations/${quotationId}/revisions/${revisionId}/line-items`)
      .set("Authorization", officeHeader)
      .send({ description: "Line", quantity: 1, unit: "lot", unitPriceBeforeVat: 1000, taxTreatment: "VAT_EXEMPT" });
    await request(app.getHttpServer())
      .patch(`/quotations/${quotationId}/revisions/${revisionId}`)
      .set("Authorization", officeHeader)
      .send({ termsAndConditions: "HAND-EDITED TERMS — not the placeholder." });
    await request(app.getHttpServer()).patch(`/quotations/${quotationId}/revisions/${revisionId}/submit`).set("Authorization", officeHeader);
    const managerHeader = await managerAccessHeader();
    await request(app.getHttpServer()).patch(`/quotations/${quotationId}/revisions/${revisionId}/approve`).set("Authorization", managerHeader);
    await request(app.getHttpServer()).patch(`/quotations/${quotationId}/revisions/${revisionId}/send`).set("Authorization", officeHeader);
    await request(app.getHttpServer())
      .patch(`/quotations/${quotationId}/revisions/${revisionId}/decision`)
      .set("Authorization", officeHeader)
      .send({ decision: "ACCEPTED" });

    const convertRes = await request(app.getHttpServer())
      .post(`/quotations/${quotationId}/revisions/${revisionId}/convert-to-work-orders`)
      .set("Authorization", officeHeader)
      .send({});
    expect(convertRes.status).toBe(201);
    expect(convertRes.body).toHaveLength(1);
    expect(convertRes.body[0].workOrderType).toBe("FROM_QUOTATION");
  });

  // --- 9: audit logging, append-only, records assignment actions ----------

  it("records append-only audit entries for assign and unassign", async () => {
    const wo = await createStandaloneWorkOrder("audit-check");

    const assignRes = await request(app.getHttpServer()).post(assignmentsUrl(wo.id)).set("Authorization", officeHeader).send({ technicianId: techC.userId });
    const assignAudit = await prisma.auditLog.findFirst({ where: { action: "work_order_technician_assigned", entityId: assignRes.body.id } });
    expect(assignAudit).not.toBeNull();
    expect(assignAudit!.entityType).toBe("work_order_assignment");
    expect((assignAudit!.afterData as Record<string, unknown>).technicianId).toBe(techC.userId);

    await request(app.getHttpServer()).patch(unassignUrl(wo.id, assignRes.body.id)).set("Authorization", officeHeader);
    const unassignAudit = await prisma.auditLog.findFirst({ where: { action: "work_order_technician_unassigned", entityId: assignRes.body.id } });
    expect(unassignAudit).not.toBeNull();

    // Append-only guarantee at the DB grant level (app_runtime has no UPDATE/DELETE on audit_logs)
    // was verified via psql in the Step 1-3 reports and is unaffected by Step 4 — no schema or
    // grant change touched audit_logs here. This test only confirms the expected rows exist.
  });
});
