import { ServiceReportStatus, ServiceReportVerificationBasis } from "@prisma/client";
import { ServiceReportsController } from "../src/modules/service-reports/service-reports.controller";
import { ServiceReportConfirmationService } from "../src/modules/service-report-confirmation/service-report-confirmation.service";
import { WorkOrdersService } from "../src/modules/work-orders/work-orders.service";
import { QuotationsService } from "../src/modules/quotations/quotations.service";
import { ServiceReportVerificationController } from "../src/modules/service-report-verification/service-report-verification.controller";
import { PERMISSIONS_KEY } from "../src/common/guards/permissions.decorator";
import { QuotationTestingCommissioningItemsService } from "../src/modules/quotations/quotation-testing-commissioning-items.service";

describe("quotation scope sample", () => {
  it("adds the supplied scope transactionally without replacing existing items", async () => {
    const items = { count: jest.fn().mockResolvedValue(0), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) };
    const tx = { quotationRevision: { findUnique: jest.fn().mockResolvedValue({ status: "DRAFT" }), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() }, quotationTestingCommissioningItem: items };
    const prisma = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };
    const service = new QuotationTestingCommissioningItemsService(prisma as never, { write: jest.fn() } as never);
    await service.applyCleaningScope("revision", { userId: "office" });
    expect(items.createMany.mock.calls[0][0].data).toHaveLength(11);
    expect(items.createMany.mock.calls[0][0].data[2]).toEqual(expect.objectContaining({ description: "Shut down unit", method: "Ensure the unit is not energized.", indications: "Electrocution", quotationRevisionId: "revision" }));
    items.count.mockResolvedValue(11);
    await expect(service.applyCleaningScope("revision", { userId: "office" })).rejects.toThrow("already has checklist items");
    expect(items.createMany).toHaveBeenCalledTimes(1);
  });
});

describe("audited service report workflow", () => {
  it.each(["PENDING_VERIFICATION", "CONFIRMED", "LOCKED"])("rejects document-only final approval from %s", async (status) => {
    const tx = { serviceReport: {
      findUnique: jest.fn().mockResolvedValue({ status, verificationBasis: ServiceReportVerificationBasis.DOCUMENT_ONLY }),
      updateMany: jest.fn(),
    } };
    const prisma = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };
    const service = new ServiceReportConfirmationService(prisma as never, {} as never, {} as never);
    await expect(service.confirm("report", { userId: "manager" })).rejects.toThrow("Only a VERIFIED report");
    expect(tx.serviceReport.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a concurrent document-only approval without a duplicate audit", async () => {
    const tx = { serviceReport: {
      findUnique: jest.fn().mockResolvedValue({ status: "VERIFIED", verificationBasis: ServiceReportVerificationBasis.DOCUMENT_ONLY }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    } };
    const prisma = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };
    const audit = { write: jest.fn() };
    const service = new ServiceReportConfirmationService(prisma as never, {} as never, audit as never);
    await expect(service.confirm("report", { userId: "manager" })).rejects.toThrow("already approved");
    expect(audit.write).not.toHaveBeenCalled();
  });
  it("requires supervisor approval permission to complete technical review", () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ServiceReportVerificationController.prototype.complete))
      .toEqual([{ module: "service_reports", action: "technical_approve" }]);
  });
  it("lists every status when no status filter is requested", async () => {
    const reports = { listByStatus: jest.fn().mockResolvedValue([]) };
    const controller = new ServiceReportsController(reports as never);
    await controller.list({ user: { userId: "manager" } } as never);
    expect(reports.listByStatus).toHaveBeenCalledWith([], { userId: "manager" });
  });

  it("allows final approval of a document reviewed by a supervisor without creating extracted data", async () => {
    const report = {
      id: "report", status: ServiceReportStatus.VERIFIED,
      verificationBasis: ServiceReportVerificationBasis.DOCUMENT_ONLY,
      verifiedBy: "supervisor", verifiedAt: new Date(),
    };
    const tx = { serviceReport: {
      findUnique: jest.fn().mockResolvedValue(report),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...report, status: ServiceReportStatus.CONFIRMED }),
    } };
    const prisma = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };
    const audit = { write: jest.fn() };
    const builder = { buildPlan: jest.fn() };
    const service = new ServiceReportConfirmationService(prisma as never, builder as never, audit as never);
    await service.confirm("report", { userId: "manager" });
    expect(tx.serviceReport.updateMany).toHaveBeenCalledWith({
      where: { id: "report", status: ServiceReportStatus.VERIFIED },
      data: { status: ServiceReportStatus.CONFIRMED, confirmedBy: "manager", confirmedAt: expect.any(Date) },
    });
    expect(builder.buildPlan).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "service_report_confirmed" }), tx);
  });
});

describe("audited quotation relationships and maintenance", () => {
  it("assigns the explicitly selected Manager to every generated maintenance visit", async () => {
    const create = jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "visit", ...data }));
    const tx = { workOrder: { create, findFirst: jest.fn().mockResolvedValue(null) }, quotationRevision: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ status: "ACTIVE", userRoles: [{ roleId: "manager-role" }] }) },
      quotation: { findUnique: jest.fn().mockResolvedValue({ id: "q", customerId: "customer", siteId: "site", quotationType: "PREVENTIVE_MAINTENANCE" }) },
      quotationRevision: { findUnique: jest.fn().mockResolvedValue({ id: "r", quotationId: "q", status: "ACCEPTED" }) },
      quotationMaintenanceDetails: { findUnique: jest.fn().mockResolvedValue({ frequency: "MONTHLY", scheduledVisits: 2 }) },
      quotationLineItem: { findMany: jest.fn().mockResolvedValue([]) },
      quotationTestingCommissioningItem: { findMany: jest.fn().mockResolvedValue([]) },
      workOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    };
    const service = new WorkOrdersService(prisma as never, { write: jest.fn() } as never, { generateNumber: jest.fn().mockResolvedValue("WO-VISIT") } as never, {} as never, {} as never);
    await service.generateMaintenanceVisits("q", "r", { startDate: "2026-12-01", responsibleManagerId: "manager" }, { userId: "office" });
    expect(create).toHaveBeenCalledTimes(2);
    for (const [input] of create.mock.calls) expect(input.data).toEqual(expect.objectContaining({
      quotationId: "q", quotationRevisionId: "r", customerId: "customer", siteId: "site", responsibleManagerId: "manager",
    }));
  });
  it("keeps the original and additional quotations discoverable with accessible child Work Orders", async () => {
    const prisma = {
      workOrder: { findUnique: jest.fn().mockResolvedValue({ quotationId: "original" }) },
      quotation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const scope = { responsibleManagerId: "manager" };
    const access = { assertWorkOrderReadable: jest.fn(), workOrderFilter: jest.fn().mockResolvedValue(scope) };
    const service = new WorkOrdersService(prisma as never, {} as never, {} as never, {} as never, access as never);
    await service.listRelatedQuotations("wo", { userId: "manager" });
    expect(access.assertWorkOrderReadable).toHaveBeenCalledWith("wo", "manager");
    expect(prisma.quotation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ sourceWorkOrderId: "wo" }, { id: "original" }] },
      include: { workOrders: { where: scope, select: { id: true, workOrderNumber: true, status: true } } },
    }));
  });

  it("saves an additional quotation using the original customer/site and the shared creation workflow", async () => {
    const quotation = { id: "extra", sourceWorkOrderId: "wo" };
    const tx = {
      systemSetting: { findUnique: jest.fn().mockImplementation(async ({ where }: { where: { key: string } }) => ({ value: where.key === "vat_rate_percent" ? "8" : "VAT_INCLUSIVE" })) },
      quotationTermTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      quotation: { create: jest.fn().mockResolvedValue(quotation) },
      quotationRevision: { create: jest.fn().mockResolvedValue({ id: "revision", defaultTaxTreatment: "VAT_INCLUSIVE", vatRatePercent: 12 }) },
    };
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue({ id: "customer" }) },
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site", customerId: "customer" }) },
      trade: { findUnique: jest.fn().mockResolvedValue({ code: "HVAC" }) },
      workOrder: { findUniqueOrThrow: jest.fn().mockResolvedValue({ customerId: "customer", siteId: "site" }) },
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    };
    const access = { assertWorkOrderReadable: jest.fn() };
    const audit = { write: jest.fn() };
    const service = new QuotationsService(prisma as never, audit as never, { generateNumber: jest.fn().mockResolvedValue("Q-EXTRA") } as never, {} as never, {} as never, access as never);
    await expect(service.create("customer", { siteId: "site", sourceWorkOrderId: "wo", quotationType: "REPAIR", primaryTradeCode: "HVAC" }, { userId: "office" })).resolves.toEqual(quotation);
    expect(tx.quotation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ customerId: "customer", siteId: "site", sourceWorkOrderId: "wo" }) });
    expect(tx.quotationRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ quotationId: "extra", defaultTaxTreatment: "VAT_INCLUSIVE", vatRatePercent: "8" }) });
  });
  it("uses recurring visit generation when converting an accepted maintenance quotation", async () => {
    const prisma = {
      quotation: { findUnique: jest.fn().mockResolvedValue({ id: "q", quotationType: "PREVENTIVE_MAINTENANCE" }) },
      quotationRevision: { findUnique: jest.fn().mockResolvedValue({ id: "r", quotationId: "q", status: "ACCEPTED" }) },
    };
    const permissions = { getEffectivePermissions: jest.fn().mockResolvedValue([{ module: "work_orders", action: "generate_maintenance_visits" }]) };
    const service = new WorkOrdersService(prisma as never, {} as never, {} as never, permissions as never, {} as never);
    const generate = jest.spyOn(service, "generateMaintenanceVisits").mockResolvedValue([]);
    await service.convertRevision("q", "r", { scheduledDate: "2026-12-01" }, { userId: "office" });
    expect(generate).toHaveBeenCalledWith("q", "r", { startDate: "2026-12-01", responsibleManagerId: undefined }, { userId: "office" });
  });

  it("rejects an additional quotation for a different customer or site", async () => {
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue({ id: "customer" }) },
      site: { findUnique: jest.fn().mockResolvedValue({ id: "site", customerId: "customer" }) },
      trade: { findUnique: jest.fn().mockResolvedValue({ code: "HVAC", status: "ACTIVE" }) },
      workOrder: { findUniqueOrThrow: jest.fn().mockResolvedValue({ customerId: "other", siteId: "site" }) },
      $transaction: jest.fn(),
    };
    const access = { assertWorkOrderReadable: jest.fn() };
    const service = new QuotationsService(prisma as never, {} as never, {} as never, {} as never, {} as never, access as never);
    await expect(service.create("customer", { siteId: "site", sourceWorkOrderId: "wo", quotationType: "REPAIR", primaryTradeCode: "HVAC" }, { userId: "office" }))
      .rejects.toThrow("source Work Order's customer and site");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
