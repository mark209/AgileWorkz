import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as argon2 from "argon2";
import {
  AssetStatus,
  CustomerStatus,
  CustomerType,
  EquipmentSystemStatus,
  InquiryStatus,
  SiteStatus,
  UserStatus,
} from "@prisma/client";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/http-exception.filter";
import { PrismaService } from "../../src/prisma/prisma.service";
import { STORAGE_PROVIDER, StorageProvider } from "../../src/common/storage/storage-provider.interface";

export interface TestApp {
  app: INestApplication;
  /**
   * The SAME PrismaService instance the running app uses internally,
   * fetched from Nest's own DI container — not a second, independently
   * constructed `new PrismaClient()`. Fixture setup/teardown and the app's
   * own request handling now share one connection/pool instead of two,
   * which removes an entire class of "why did the app not see the row my
   * fixture just created" test-harness fragility, regardless of the exact
   * mechanism that would have caused it.
   */
  prisma: PrismaService;
  /** Same rationale as prisma above — the real adapter the app itself uses. */
  storage: StorageProvider;
}

/**
 * Boots the real AppModule — same guards, pipes, filters, and modules as
 * production — against whatever DATABASE_URL / REDIS_URL are set in the
 * environment. Requires live Postgres and Redis; never used by `pnpm test`.
 */
export async function bootstrapTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  const prisma = app.get(PrismaService);
  const storage = app.get<StorageProvider>(STORAGE_PROVIDER);
  return { app, prisma, storage };
}

// All E2E fixtures are namespaced under this prefix so they're trivially
// distinguishable from the seed data and easy to clean up between runs.
export const E2E_PREFIX = "e2e-verify";

// equipment_types/equipment_system_types/capacity_units codes must be
// uppercase/digits/underscores only (see CreateEquipmentTypeDto etc.), so
// they can't use the lowercase E2E_PREFIX directly — same isolation
// guarantee, just an uppercase-safe spelling.
export const E2E_CODE_PREFIX = "E2E_VERIFY";

export interface TestRole {
  id: string;
  name: string;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export class E2eFixtures {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage?: StorageProvider,
  ) {}

  async ensurePermission(module: string, action: string) {
    return this.prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: {},
      create: { module, action, description: `${E2E_PREFIX} fixture` },
    });
  }

  async createRole(suffix: string, permissionIds: string[] = []): Promise<TestRole> {
    const name = `${E2E_PREFIX}-role-${suffix}-${Date.now()}`;
    const role = await this.prisma.role.create({ data: { name, isSystem: false } });
    for (const permissionId of permissionIds) {
      await this.prisma.rolePermission.create({ data: { roleId: role.id, permissionId } });
    }
    return { id: role.id, name: role.name };
  }

  async createUser(suffix: string, status: UserStatus, roleIds: string[] = []): Promise<TestUser> {
    const email = `${E2E_PREFIX}-${suffix}-${Date.now()}@example.test`;
    const password = "Correct-Horse-Battery-Staple-1!";
    const passwordHash = await argon2.hash(password);
    const user = await this.prisma.user.create({
      data: { fullName: `E2E ${suffix}`, email, passwordHash, status },
    });
    for (const roleId of roleIds) {
      await this.prisma.userRole.create({ data: { userId: user.id, roleId } });
    }
    return { id: user.id, email, password };
  }

  async revokeRole(userId: string, roleId: string) {
    await this.prisma.userRole.delete({ where: { userId_roleId: { userId, roleId } } });
  }

  async grantPermission(roleId: string, permissionId: string) {
    await this.prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      update: {},
      create: { roleId, permissionId },
    });
  }

  // --- Phase 2 fixtures ------------------------------------------------
  // All names/tags are E2E_PREFIX-namespaced, same isolation convention as
  // the Phase 1 fixtures above. Deleting an E2E_PREFIX customer cascades to
  // its sites/contacts/equipment_systems/assets at the DB level (all
  // CASCADE on customer_id/site_id) — cleanupAll() below only needs to
  // delete the customer row itself for those four.

  async createCustomer(suffix: string, overrides: Partial<{ status: CustomerStatus }> = {}) {
    return this.prisma.customer.create({
      data: {
        name: `${E2E_PREFIX}-customer-${suffix}-${Date.now()}`,
        customerType: CustomerType.COMMERCIAL,
        billingAddress: "123 E2E Test Street",
        status: overrides.status ?? CustomerStatus.ACTIVE,
      },
    });
  }

  async createContact(customerId: string, suffix: string, phone = "+63 900 000 0000") {
    return this.prisma.contact.create({
      data: {
        customerId,
        fullName: `E2E Contact ${suffix}`,
        phone,
      },
    });
  }

  async createSite(customerId: string, suffix: string, overrides: Partial<{ status: SiteStatus }> = {}) {
    return this.prisma.site.create({
      data: {
        customerId,
        label: `${E2E_PREFIX}-site-${suffix}-${Date.now()}`,
        addressLine: "456 E2E Test Avenue",
        status: overrides.status ?? SiteStatus.ACTIVE,
      },
    });
  }

  async createEquipmentSystem(
    siteId: string,
    suffix: string,
    overrides: Partial<{ systemTypeCode: string; status: EquipmentSystemStatus }> = {},
  ) {
    return this.prisma.equipmentSystem.create({
      data: {
        siteId,
        name: `${E2E_PREFIX}-system-${suffix}-${Date.now()}`,
        systemTypeCode: overrides.systemTypeCode ?? "SPLIT",
        status: overrides.status ?? EquipmentSystemStatus.ACTIVE,
      },
    });
  }

  async createAsset(
    siteId: string,
    suffix: string,
    overrides: Partial<{
      equipmentTypeCode: string;
      equipmentSystemId: string;
      parentAssetId: string;
      status: AssetStatus;
    }> = {},
  ) {
    return this.prisma.asset.create({
      data: {
        siteId,
        assetTag: `${E2E_PREFIX}-asset-${suffix}-${Date.now()}`,
        equipmentTypeCode: overrides.equipmentTypeCode ?? "SPLIT_INDOOR",
        equipmentSystemId: overrides.equipmentSystemId,
        parentAssetId: overrides.parentAssetId,
        status: overrides.status ?? AssetStatus.ACTIVE,
      },
    });
  }

  // --- Phase 3 Step 3 fixtures ------------------------------------------
  // No extra cleanup entry needed in cleanupAll(): inquiries.customer_id is
  // CASCADE, so deleting an E2E_PREFIX customer already removes its
  // inquiries — same as sites/contacts/equipment_systems/assets above.

  // Bypasses InquiriesService/NumberingService (this fixture writes directly
  // via Prisma) — inquiryNumber just needs to be unique for the fixture's
  // purposes, not a real INQ-YYYY-MM-NNNNN number from the shared counter.
  async createInquiry(
    customerId: string,
    suffix: string,
    overrides: Partial<{
      siteId: string;
      contactId: string;
      status: InquiryStatus;
      tradeCode: string;
      customerReferenceNo: string;
      description: string;
    }> = {},
  ) {
    return this.prisma.inquiry.create({
      data: {
        customerId,
        // inquiry_number is VARCHAR(30) — a short base36 timestamp keeps
        // this comfortably under the limit while staying unique per call.
        inquiryNumber: `FIX-${Date.now().toString(36)}`,
        subject: `${E2E_PREFIX}-inquiry-${suffix}-${Date.now()}`,
        description: overrides.description,
        siteId: overrides.siteId,
        contactId: overrides.contactId,
        tradeCode: overrides.tradeCode,
        customerReferenceNo: overrides.customerReferenceNo,
        status: overrides.status ?? InquiryStatus.OPEN,
      },
    });
  }

  /** Cleans up everything created under E2E_PREFIX / E2E_CODE_PREFIX. Never touches seed data. */
  async cleanupAll() {
    // customer_documents is polymorphic (no DB FK) — must be found and
    // removed explicitly, storage object included, before the customers/
    // sites/assets it points at are deleted, or the cascade below would
    // leave orphaned rows and orphaned storage objects behind.
    const e2eCustomers = await this.prisma.customer.findMany({
      where: { name: { startsWith: E2E_PREFIX } },
      select: { id: true },
    });
    const e2eSites = await this.prisma.site.findMany({
      where: { customerId: { in: e2eCustomers.map((c) => c.id) } },
      select: { id: true },
    });
    const e2eAssets = await this.prisma.asset.findMany({
      where: { siteId: { in: e2eSites.map((s) => s.id) } },
      select: { id: true },
    });
    const relatedIds = [...e2eCustomers, ...e2eSites, ...e2eAssets].map((row) => row.id);
    if (relatedIds.length) {
      const documents = await this.prisma.customerDocument.findMany({ where: { relatedId: { in: relatedIds } } });
      if (this.storage) {
        await Promise.all(documents.map((doc) => this.storage!.deleteObject(doc.fileKey).catch(() => undefined)));
      }
      await this.prisma.customerDocument.deleteMany({ where: { relatedId: { in: relatedIds } } });
    }

    // Cascades away sites, contacts, equipment_systems, and assets.
    await this.prisma.customer.deleteMany({ where: { name: { startsWith: E2E_PREFIX } } });

    // Reference-table rows created directly (not under a customer).
    await this.prisma.equipmentType.deleteMany({ where: { code: { startsWith: E2E_CODE_PREFIX } } });
    await this.prisma.equipmentSystemType.deleteMany({ where: { code: { startsWith: E2E_CODE_PREFIX } } });
    await this.prisma.capacityUnit.deleteMany({ where: { code: { startsWith: E2E_CODE_PREFIX } } });

    // Step 4 reference tables — same code-prefix convention.
    await this.prisma.trade.deleteMany({ where: { code: { startsWith: E2E_CODE_PREFIX } } });
    await this.prisma.inquirySource.deleteMany({ where: { code: { startsWith: E2E_CODE_PREFIX } } });
    await this.prisma.inquiryType.deleteMany({ where: { code: { startsWith: E2E_CODE_PREFIX } } });
    await this.prisma.quotationTermTemplate.deleteMany({ where: { name: { startsWith: E2E_PREFIX } } });

    const users = await this.prisma.user.findMany({ where: { email: { startsWith: E2E_PREFIX } } });
    const userIds = users.map((u) => u.id);
    if (userIds.length) {
      await this.prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await this.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    const roles = await this.prisma.role.findMany({ where: { name: { startsWith: E2E_PREFIX } } });
    const roleIds = roles.map((r) => r.id);
    if (roleIds.length) {
      await this.prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
      await this.prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    }
  }
}
