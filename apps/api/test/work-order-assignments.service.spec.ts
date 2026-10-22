import { BadRequestException } from "@nestjs/common";
import { UserStatus } from "@prisma/client";
import { WorkOrderAssignmentsService } from "../src/modules/work-orders/work-order-assignments.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { WorkOrdersService } from "../src/modules/work-orders/work-orders.service";
import { ServiceAccessService } from "../src/modules/identity/service-access.service";
import { mockOf } from "./test-utils";

function setup(user: { status: UserStatus; userRoles: Array<{ roleId: string }> }) {
  const prisma = mockOf<PrismaService>({
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    workOrderAssignment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "assignment-1" }),
    },
  });
  const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
  const workOrders = mockOf<WorkOrdersService>({ findByIdOrThrow: jest.fn().mockResolvedValue({ id: "wo-1" }) });
  const access = mockOf<ServiceAccessService>({ assertManagerScopedAction: jest.fn().mockResolvedValue(undefined) });
  return { service: new WorkOrderAssignmentsService(prisma, audit, workOrders, access), prisma };
}

describe("WorkOrderAssignmentsService", () => {
  const actor = { userId: "dispatcher-1" };

  it("rejects an active user without Technician assignment permission", async () => {
    const { service, prisma } = setup({ status: UserStatus.ACTIVE, userRoles: [] });

    await expect(service.assign("wo-1", { technicianId: "office-1" }, actor))
      .rejects.toThrow(BadRequestException);
    expect(prisma.workOrderAssignment.create).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "office-1" },
      select: expect.objectContaining({ userRoles: expect.objectContaining({
        where: { role: { rolePermissions: { some: { permission: { module: "work_orders", action: "start_own" } } } } },
      }) }),
    }));
  });

  it("accepts an active user with Technician assignment permission", async () => {
    const { service, prisma } = setup({ status: UserStatus.ACTIVE, userRoles: [{ roleId: "technician-role" }] });

    await expect(service.assign("wo-1", { technicianId: "technician-1" }, actor))
      .resolves.toEqual({ id: "assignment-1" });
    expect(prisma.workOrderAssignment.create).toHaveBeenCalledWith({
      data: { workOrderId: "wo-1", technicianId: "technician-1", assignedBy: "dispatcher-1" },
    });
  });
});
