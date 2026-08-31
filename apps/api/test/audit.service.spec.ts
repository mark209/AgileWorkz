import { ActorType } from "@prisma/client";
import { AuditService } from "../src/modules/audit/audit.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { mockOf } from "./test-utils";

describe("AuditService — append-only by construction", () => {
  it("exposes only write() and query() — no update/delete method exists at the code level", () => {
    const methodNames = Object.getOwnPropertyNames(AuditService.prototype).filter((n) => n !== "constructor");
    expect(methodNames.sort()).toEqual(["query", "write"]);
  });

  it("writes a SYSTEM-actor entry with a null actor_user_id", async () => {
    const prisma = mockOf<PrismaService>({ auditLog: { create: jest.fn().mockResolvedValue({}) } });
    const service = new AuditService(prisma);

    await service.write({ actorType: ActorType.SYSTEM, action: "seed", entityType: "user", entityId: "u1" });

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorType: "SYSTEM", actorUserId: null }),
      }),
    );
  });

  it("refuses to write a USER-actor entry with no actor_user_id — actor_user_id=null alone must not stand in for actor classification", async () => {
    const prisma = mockOf<PrismaService>({ auditLog: { create: jest.fn() } });
    const service = new AuditService(prisma);

    await expect(
      service.write({ actorType: ActorType.USER, action: "login", entityType: "auth" }),
    ).rejects.toThrow(/requires actorUserId/);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("allows WORKER and INTEGRATION actor types with a null actor_user_id", async () => {
    const prisma = mockOf<PrismaService>({ auditLog: { create: jest.fn().mockResolvedValue({}) } });
    const service = new AuditService(prisma);

    await service.write({ actorType: ActorType.WORKER, action: "extraction_attempted", entityType: "service_report_document" });
    await service.write({ actorType: ActorType.INTEGRATION, action: "webhook_received", entityType: "external" });

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2);
  });
});
