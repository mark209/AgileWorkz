import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";

/**
 * Live E2E — Phase 2 Step 9. Covers Equipment Systems + Assets end-to-end:
 * the nested create routes, the capacity_value/capacity_unit_code pairing
 * rule, the cross-site integrity rule for parent_asset_id/equipment_system_id
 * (app-layer only, no DB FK can express it), and the dedicated
 * PATCH /assets/:id/link endpoint with its own asset_regrouped audit action.
 */
describe("Equipment Systems / Assets (live)", () => {
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
        ["equipment_systems", "create"],
        ["equipment_systems", "read"],
        ["assets", "create"],
        ["assets", "read"],
        ["assets", "update"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("equipment-full-access", perms.map((p) => p.id));
    const user = await fixtures.createUser("equipment-full", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  it("creates an equipment system and an asset under a site via live HTTP, audits both", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("equip-chain");
    const site = await fixtures.createSite(customer.id, "equip-chain");

    const systemRes = await request(app.getHttpServer())
      .post(`/sites/${site.id}/equipment-systems`)
      .set("Authorization", authHeader)
      .send({ name: "e2e-verify-vrf-system", systemTypeCode: "VRV_VRF" });
    expect(systemRes.status).toBe(201);

    const assetRes = await request(app.getHttpServer())
      .post(`/sites/${site.id}/assets`)
      .set("Authorization", authHeader)
      .send({
        assetTag: "e2e-verify-AC-901",
        equipmentTypeCode: "VRV_VRF_INDOOR",
        equipmentSystemId: systemRes.body.id,
      });
    expect(assetRes.status).toBe(201);
    expect(assetRes.body.equipmentSystemId).toBe(systemRes.body.id);

    const [systemAudit, assetAudit] = await Promise.all([
      prisma.auditLog.findFirst({ where: { action: "equipment_system_created", entityId: systemRes.body.id } }),
      prisma.auditLog.findFirst({ where: { action: "asset_created", entityId: assetRes.body.id } }),
    ]);
    expect(systemAudit).not.toBeNull();
    expect(assetAudit).not.toBeNull();
  });

  it("rejects capacityValue without capacityUnitCode", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("capacity-pair");
    const site = await fixtures.createSite(customer.id, "capacity-pair");

    const res = await request(app.getHttpServer())
      .post(`/sites/${site.id}/assets`)
      .set("Authorization", authHeader)
      .send({ assetTag: "e2e-verify-bad-capacity", equipmentTypeCode: "SPLIT_INDOOR", capacityValue: 2 });

    expect(res.status).toBe(400);
  });

  it("rejects an equipmentSystemId that belongs to a different site (app-layer cross-site check)", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("cross-site");
    const siteA = await fixtures.createSite(customer.id, "cross-site-a");
    const siteB = await fixtures.createSite(customer.id, "cross-site-b");
    const systemOnA = await fixtures.createEquipmentSystem(siteA.id, "cross-site");

    const res = await request(app.getHttpServer())
      .post(`/sites/${siteB.id}/assets`)
      .set("Authorization", authHeader)
      .send({ assetTag: "e2e-verify-cross-site-asset", equipmentTypeCode: "SPLIT_INDOOR", equipmentSystemId: systemOnA.id });

    expect(res.status).toBe(400);
  });

  it("PATCH /assets/:id/link sets parentAssetId and audits asset_regrouped (not asset_updated)", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("link-endpoint");
    const site = await fixtures.createSite(customer.id, "link-endpoint");
    const indoor = await fixtures.createAsset(site.id, "link-indoor", { equipmentTypeCode: "SPLIT_INDOOR" });
    const outdoor = await fixtures.createAsset(site.id, "link-outdoor", { equipmentTypeCode: "SPLIT_OUTDOOR" });

    const res = await request(app.getHttpServer())
      .patch(`/assets/${indoor.id}/link`)
      .set("Authorization", authHeader)
      .send({ parentAssetId: outdoor.id });

    expect(res.status).toBe(200);
    expect(res.body.parentAssetId).toBe(outdoor.id);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "asset_regrouped", entityId: indoor.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.afterData).toEqual({ parentAssetId: outdoor.id });
  });

  it("rejects an asset being linked as its own parent", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("self-parent");
    const site = await fixtures.createSite(customer.id, "self-parent");
    const asset = await fixtures.createAsset(site.id, "self-parent");

    const res = await request(app.getHttpServer())
      .patch(`/assets/${asset.id}/link`)
      .set("Authorization", authHeader)
      .send({ parentAssetId: asset.id });

    expect(res.status).toBe(400);
  });

  it("Technician is denied assets and equipment_systems endpoints (no grants yet)", async () => {
    const technicianRole = await fixtures.createRole("equip-technician-like");
    const technician = await fixtures.createUser("equip-tech", UserStatus.ACTIVE, [technicianRole.id]);
    const techHeader = await loginHeader(technician.email, technician.password);
    const customer = await fixtures.createCustomer("tech-denied");
    const site = await fixtures.createSite(customer.id, "tech-denied");

    const res = await request(app.getHttpServer()).get(`/sites/${site.id}/assets`).set("Authorization", techHeader);
    expect(res.status).toBe(403);
  });
});
