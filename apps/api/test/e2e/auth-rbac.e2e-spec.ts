import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures, E2E_PREFIX } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — requires a reachable PostgreSQL and Redis (see README §"Running
 * checks"). Covers infra-verification item G in full: login success/failure
 * paths for every user status, JWT enforcement, permission-protected access,
 * multi-role permission union, and that revoking one role only narrows that
 * role's grants — plus that the corresponding audit events are actually
 * persisted, not just returned in the HTTP response.
 */
describe("Auth + RBAC (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;

  beforeAll(async () => {
    // Fixtures use the app's own PrismaService (same connection the running
    // app queries with), not a second independent PrismaClient — see
    // support.ts for why that matters.
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close(); // also disconnects PrismaService via its onModuleDestroy hook
  });

  it("rejects login for an unknown email and audits it as a SYSTEM-actor event", async () => {
    const email = `${E2E_PREFIX}-nobody-${Date.now()}@example.test`;

    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password: "whatever" });

    expect(res.status).toBe(401);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "login_failed", actorType: "SYSTEM" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorUserId).toBeNull();
  });

  it("rejects a wrong password for an ACTIVE user and audits it against that user", async () => {
    const user = await fixtures.createUser("wrongpw", UserStatus.ACTIVE);

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: "not-the-real-password" });

    expect(res.status).toBe(401);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "login_failed", actorUserId: user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorType).toBe("USER");
  });

  it("rejects login for an INACTIVE user", async () => {
    const user = await fixtures.createUser("inactive", UserStatus.INACTIVE);

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: user.password });

    expect(res.status).toBe(401);
  });

  it("rejects login for a SUSPENDED user", async () => {
    const user = await fixtures.createUser("suspended", UserStatus.SUSPENDED);

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: user.password });

    expect(res.status).toBe(401);
  });

  it("logs in an ACTIVE user, issues a working JWT, and audits the success", async () => {
    const user = await fixtures.createUser("active", UserStatus.ACTIVE);

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));

    const me = await request(app.getHttpServer())
      .get("/users/me")
      .set("Authorization", `Bearer ${res.body.accessToken}`);
    // Diagnostic safety net: if this ever fails again, the response body
    // distinguishes a true routing 404 (Express's own, no JSON body) from
    // an application-level NotFoundException (Nest's JSON error shape,
    // AllExceptionsFilter-formatted) — very different bugs, same status code.
    if (me.status !== 200) {
      // eslint-disable-next-line no-console
      console.error("GET /users/me did not return 200. Status:", me.status, "Body:", me.body, "Text:", me.text);
    }
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(user.email);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "login", actorUserId: user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects a protected endpoint with no token (401) and blocks access without the required permission (403)", async () => {
    const noAuth = await request(app.getHttpServer()).get("/audit-logs");
    expect(noAuth.status).toBe(401);

    const user = await fixtures.createUser("noperm", UserStatus.ACTIVE); // no roles at all
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: user.password });

    const forbidden = await request(app.getHttpServer())
      .get("/audit-logs")
      .set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(forbidden.status).toBe(403);
  });

  it("grants the union of permissions across multiple roles, and revoking one role only removes that role's grants", async () => {
    const auditRead = await fixtures.ensurePermission("audit_logs", "read");
    const settingsManage = await fixtures.ensurePermission("system_settings", "manage");
    const roleA = await fixtures.createRole("audit-reader", [auditRead.id]);
    const roleB = await fixtures.createRole("settings-manager", [settingsManage.id]);
    const user = await fixtures.createUser("multirole", UserStatus.ACTIVE, [roleA.id, roleB.id]);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    const authHeader = `Bearer ${login.body.accessToken}`;

    // Union: both grants work.
    const auditRes = await request(app.getHttpServer()).get("/audit-logs").set("Authorization", authHeader);
    expect(auditRes.status).toBe(200);
    const settingsRes = await request(app.getHttpServer()).get("/system-settings").set("Authorization", authHeader);
    expect(settingsRes.status).toBe(200);

    // Revoke only roleB (settings-manager).
    await fixtures.revokeRole(user.id, roleB.id);

    const auditResAfter = await request(app.getHttpServer()).get("/audit-logs").set("Authorization", authHeader);
    expect(auditResAfter.status).toBe(200); // roleA's grant is untouched

    const settingsResAfter = await request(app.getHttpServer())
      .get("/system-settings")
      .set("Authorization", authHeader);
    expect(settingsResAfter.status).toBe(403); // roleB's grant is gone, and only roleB's
  });
});
