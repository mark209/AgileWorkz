import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures, E2E_CODE_PREFIX } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 2 Step 9. Covers the three controlled-value reference
 * tables (equipment_types, equipment_system_types, capacity_units): the
 * seeded rows are actually there, the read/manage RBAC split holds
 * (Office Staff read-only, per the approved plan), and a duplicate code
 * returns a clean 409 rather than a raw constraint violation.
 */
describe("Equipment/system-type/capacity-unit reference data (live)", () => {
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
        ["equipment_types", "read"],
        ["equipment_types", "manage"],
        ["equipment_system_types", "read"],
        ["equipment_system_types", "manage"],
        ["capacity_units", "read"],
        ["capacity_units", "manage"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("reference-manage", perms.map((p) => p.id));
    const user = await fixtures.createUser("reference-manage", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  it("the approved seed data is really there — 15 equipment types, 6 system types, 4 capacity units", async () => {
    const authHeader = await manageHeader();

    const [types, systemTypes, units] = await Promise.all([
      request(app.getHttpServer()).get("/equipment-types").set("Authorization", authHeader),
      request(app.getHttpServer()).get("/equipment-system-types").set("Authorization", authHeader),
      request(app.getHttpServer()).get("/capacity-units").set("Authorization", authHeader),
    ]);

    expect(types.body.length).toBeGreaterThanOrEqual(15);
    expect(types.body.some((t: { code: string }) => t.code === "ELECTRICAL_PANEL")).toBe(true);
    expect(systemTypes.body.length).toBeGreaterThanOrEqual(6);
    expect(units.body.length).toBeGreaterThanOrEqual(4);
  });

  it("creates a new equipment type, rejects a duplicate code with 409, and deactivates it", async () => {
    const authHeader = await manageHeader();
    const code = `${E2E_CODE_PREFIX}_TYPE`;

    const created = await request(app.getHttpServer())
      .post("/equipment-types")
      .set("Authorization", authHeader)
      .send({ code, label: "E2E Verification Type" });
    expect(created.status).toBe(201);

    const duplicate = await request(app.getHttpServer())
      .post("/equipment-types")
      .set("Authorization", authHeader)
      .send({ code, label: "Duplicate Attempt" });
    expect(duplicate.status).toBe(409);

    const deactivated = await request(app.getHttpServer())
      .patch(`/equipment-types/${code}/status`)
      .set("Authorization", authHeader)
      .send({ status: "INACTIVE" });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe("INACTIVE");

    const audit = await prisma.auditLog.findFirst({ where: { action: "equipment_type_status_changed", entityId: code } });
    expect(audit).not.toBeNull();
  });

  it("Office Staff can read but not manage reference data", async () => {
    const read = await fixtures.ensurePermission("capacity_units", "read");
    const officeRole = await fixtures.createRole("reference-office-like", [read.id]);
    const officeUser = await fixtures.createUser("reference-office", UserStatus.ACTIVE, [officeRole.id]);
    const officeHeader = await loginHeader(officeUser.email, officeUser.password);

    const readRes = await request(app.getHttpServer()).get("/capacity-units").set("Authorization", officeHeader);
    expect(readRes.status).toBe(200);

    const manageRes = await request(app.getHttpServer())
      .post("/capacity-units")
      .set("Authorization", officeHeader)
      .send({ code: `${E2E_CODE_PREFIX}_UNIT`, label: "Should be denied" });
    expect(manageRes.status).toBe(403);
  });
});
