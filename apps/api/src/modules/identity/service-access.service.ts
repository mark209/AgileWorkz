import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PermissionsService } from "./permissions.service";

@Injectable()
export class ServiceAccessService {
  constructor(private readonly prisma: PrismaService, private readonly permissions: PermissionsService) {}

  private async grants(userId: string) {
    return new Set((await this.permissions.getEffectivePermissions(userId)).map((p) => `${p.module}.${p.action}`));
  }

  async workOrderFilter(userId: string): Promise<Prisma.WorkOrderWhereInput> {
    const grants = await this.grants(userId);
    if (grants.has("work_orders.read")) return {};
    const scopes: Prisma.WorkOrderWhereInput[] = [];
    if (grants.has("work_orders.read_assigned")) scopes.push({ responsibleManagerId: userId });
    if (grants.has("work_orders.read_own")) scopes.push({ assignments: { some: { technicianId: userId, unassignedAt: null } } });
    if (scopes.length === 1) return scopes[0];
    if (scopes.length > 1) return { OR: scopes };
    throw new ForbiddenException("Missing Work Order read permission");
  }

  async assertWorkOrderReadable(workOrderId: string, userId: string): Promise<void> {
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { responsibleManagerId: true, assignments: { where: { unassignedAt: null }, select: { technicianId: true } } },
    });
    if (!workOrder) throw new NotFoundException("Work Order not found");
    const grants = await this.grants(userId);
    if (grants.has("work_orders.read")) return;
    if (grants.has("work_orders.read_assigned") && workOrder.responsibleManagerId === userId) return;
    if (grants.has("work_orders.read_own") && workOrder.assignments.some((a) => a.technicianId === userId)) return;
    throw new ForbiddenException("You are not assigned to this Work Order");
  }

  async assertManagerScopedAction(workOrderId: string, userId: string): Promise<void> {
    const grants = await this.grants(userId);
    if (!grants.has("work_orders.read_assigned") || grants.has("work_orders.read")) return;
    const workOrder = await this.prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { responsibleManagerId: true } });
    if (!workOrder) throw new NotFoundException("Work Order not found");
    if (workOrder.responsibleManagerId !== userId) throw new ForbiddenException("You are not the responsible Manager for this Work Order");
  }

  async assertReportReadable(reportId: string, userId: string): Promise<void> {
    const report = await this.prisma.serviceReport.findUnique({
      where: { id: reportId }, select: { workOrderId: true, uploadedBy: true },
    });
    if (!report) throw new NotFoundException("Service Report not found");
    const grants = await this.grants(userId);
    if (grants.has("service_reports.read")) return;
    if (grants.has("service_reports.read_own") && report.uploadedBy === userId) return;
    if (grants.has("service_reports.read_assigned") && report.workOrderId) {
      await this.assertWorkOrderReadable(report.workOrderId, userId);
      return;
    }
    throw new ForbiddenException("You cannot access this Service Report");
  }

  async assertFullReportReadable(reportId: string, userId: string): Promise<void> {
    const grants = await this.grants(userId);
    if (grants.has("service_reports.read")) return;
    if (grants.has("service_reports.read_assigned")) {
      const report = await this.prisma.serviceReport.findUnique({ where: { id: reportId }, select: { workOrderId: true } });
      if (!report) throw new NotFoundException("Service Report not found");
      if (report.workOrderId) {
        await this.assertManagerScopedAction(report.workOrderId, userId);
        return;
      }
    }
    throw new ForbiddenException("Missing full Service Report read permission");
  }

  async assertManagerScopedReportAction(reportId: string, userId: string): Promise<void> {
    const grants = await this.grants(userId);
    if (!grants.has("service_reports.read_assigned") || grants.has("service_reports.read")) return;
    await this.assertFullReportReadable(reportId, userId);
  }

  async reportFilter(userId: string): Promise<Prisma.ServiceReportWhereInput> {
    const grants = await this.grants(userId);
    if (grants.has("service_reports.read")) return {};
    const scopes: Prisma.ServiceReportWhereInput[] = [];
    if (grants.has("service_reports.read_assigned")) scopes.push({ workOrder: { responsibleManagerId: userId } });
    if (grants.has("service_reports.read_own")) scopes.push({ uploadedBy: userId });
    if (scopes.length === 1) return scopes[0];
    if (scopes.length > 1) return { OR: scopes };
    throw new ForbiddenException("Missing Service Report read permission");
  }
}
