import { ForbiddenException } from "@nestjs/common";
import { ServiceAccessService } from "../src/modules/identity/service-access.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { PermissionsService } from "../src/modules/identity/permissions.service";
import { mockOf } from "./test-utils";

function setup(grants: string[], managerId: string | null = "manager-1") {
  const prisma = mockOf<PrismaService>({
    workOrder: { findUnique: jest.fn().mockResolvedValue({ responsibleManagerId: managerId, assignments: [] }) },
    serviceReport: { findUnique: jest.fn().mockResolvedValue({ workOrderId: "wo-1", uploadedBy: "tech-1" }) },
  });
  const permissions = mockOf<PermissionsService>({
    getEffectivePermissions: jest.fn().mockResolvedValue(grants.map((grant) => {
      const [module, action] = grant.split(".");
      return { module, action };
    })),
  });
  return { access: new ServiceAccessService(prisma, permissions), prisma };
}

describe("ServiceAccessService", () => {
  it("limits a Manager to explicitly assigned Work Orders", async () => {
    const { access } = setup(["work_orders.read_assigned"]);
    await expect(access.assertWorkOrderReadable("wo-1", "manager-1")).resolves.toBeUndefined();
    await expect(access.assertWorkOrderReadable("wo-1", "manager-2")).rejects.toThrow(ForbiddenException);
    await expect(access.workOrderFilter("manager-1")).resolves.toEqual({ responsibleManagerId: "manager-1" });
  });

  it("preserves an independent broad grant for a multi-role user", async () => {
    const { access } = setup(["work_orders.read_assigned", "work_orders.read"], null);
    await expect(access.assertWorkOrderReadable("wo-1", "manager-1")).resolves.toBeUndefined();
  });

  it("combines Manager and Technician read scopes without granting Manager actions on Technician jobs", async () => {
    const { access, prisma } = setup(["work_orders.read_assigned", "work_orders.read_own"], "manager-2");
    (prisma.workOrder.findUnique as jest.Mock).mockResolvedValue({ responsibleManagerId: "manager-2", assignments: [{ technicianId: "manager-1" }] });
    await expect(access.workOrderFilter("manager-1")).resolves.toEqual({ OR: [
      { responsibleManagerId: "manager-1" },
      { assignments: { some: { technicianId: "manager-1", unassignedAt: null } } },
    ] });
    await expect(access.assertWorkOrderReadable("wo-1", "manager-1")).resolves.toBeUndefined();
    await expect(access.assertManagerScopedAction("wo-1", "manager-1")).rejects.toThrow(ForbiddenException);
  });

  it("denies a Manager full access to a report linked to another Work Order", async () => {
    const { access } = setup(["service_reports.read_assigned", "work_orders.read_assigned"], "manager-2");
    await expect(access.assertFullReportReadable("report-1", "manager-1")).rejects.toThrow(ForbiddenException);
  });

  it("does not expose direct reports through Manager assignment", async () => {
    const { access, prisma } = setup(["service_reports.read_assigned", "work_orders.read_assigned"]);
    (prisma.serviceReport.findUnique as jest.Mock).mockResolvedValue({ workOrderId: null, uploadedBy: "tech-1" });
    await expect(access.assertFullReportReadable("report-1", "manager-1")).rejects.toThrow(ForbiddenException);
  });
});
