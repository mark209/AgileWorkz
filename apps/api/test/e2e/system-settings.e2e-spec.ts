import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { SYSTEM_SETTING_KEYS } from "@agileworks/shared-types";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — infra-verification item H. Uses a dedicated test role with
 * system_settings.manage granted to stand in for "an Admin/Owner-equivalent
 * user" rather than depending on the seeded bootstrap admin's env-var
 * credentials being loaded in this process — keeps the suite self-contained.
 */
describe("System Settings (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: E2eFixtures;
  const settingKey = SYSTEM_SETTING_KEYS.QUOTATION_APPROVAL_THRESHOLD_PHP;

  beforeAll(async () => {
    ({ app, prisma } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma);
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close(); // also disconnects PrismaService via its onModuleDestroy hook
  });

  it("allows a user with system_settings.manage to update a setting; blocks one without it; grants access explicitly", async () => {
    const manage = await fixtures.ensurePermission("system_settings", "manage");
    const managerRole = await fixtures.createRole("manager-like"); // no grant yet
    const officeRole = await fixtures.createRole("office-like"); // no grant yet
    const technicianRole = await fixtures.createRole("technician-like"); // never granted

    const before = await prisma.systemSetting.findUniqueOrThrow({ where: { key: settingKey } });
    const newValue = before.value === "50000" ? "60000" : "50000";

    const manager = await fixtures.createUser("manager", UserStatus.ACTIVE, [managerRole.id]);
    const officeStaff = await fixtures.createUser("office", UserStatus.ACTIVE, [officeRole.id]);
    const technician = await fixtures.createUser("tech", UserStatus.ACTIVE, [technicianRole.id]);

    async function loginHeader(email: string, password: string) {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
      return `Bearer ${res.body.accessToken}`;
    }

    // Manager without the grant: denied.
    const managerHeader = await loginHeader(manager.email, manager.password);
    const deniedManager = await request(app.getHttpServer())
      .patch(`/system-settings/${settingKey}`)
      .set("Authorization", managerHeader)
      .send({ value: newValue });
    expect(deniedManager.status).toBe(403);

    // Office Staff without the grant: denied.
    const officeHeader = await loginHeader(officeStaff.email, officeStaff.password);
    const deniedOffice = await request(app.getHttpServer())
      .patch(`/system-settings/${settingKey}`)
      .set("Authorization", officeHeader)
      .send({ value: newValue });
    expect(deniedOffice.status).toBe(403);

    // Technician: never granted, always denied.
    const techHeader = await loginHeader(technician.email, technician.password);
    const deniedTech = await request(app.getHttpServer())
      .patch(`/system-settings/${settingKey}`)
      .set("Authorization", techHeader)
      .send({ value: newValue });
    expect(deniedTech.status).toBe(403);

    // Explicitly grant Manager the permission — now it works.
    await fixtures.grantPermission(managerRole.id, manage.id);
    const allowedManager = await request(app.getHttpServer())
      .patch(`/system-settings/${settingKey}`)
      .set("Authorization", managerHeader)
      .send({ value: newValue });
    expect(allowedManager.status).toBe(200);
    expect(allowedManager.body.value).toBe(newValue);

    // The audit event has everything required, and reflects the real change.
    const audit = await prisma.auditLog.findFirst({
      where: { action: "system_setting_changed", entityId: settingKey, actorUserId: manager.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorType).toBe("USER");
    expect(audit!.entityType).toBe("system_settings");
    expect(audit!.beforeData).toEqual({ value: before.value });
    expect(audit!.afterData).toEqual({ value: newValue });
    expect(audit!.createdAt).toBeInstanceOf(Date);
    // ip_address / user_agent are best-effort (supertest against an in-process
    // server may not populate a real client IP) — assert the columns exist
    // and are the right type when present, not that they're always non-null.
    if (audit!.ipAddress !== null) expect(typeof audit!.ipAddress).toBe("string");
    if (audit!.userAgent !== null) expect(typeof audit!.userAgent).toBe("string");

    // Restore the original value so this test is repeatable.
    await prisma.systemSetting.update({ where: { key: settingKey }, data: { value: before.value } });
  });
});
