import { ForbiddenException } from "@nestjs/common";
import { QuotationRevisionStatus } from "@prisma/client";
import { QuotationsService } from "../src/modules/quotations/quotations.service";
import { QuotationPdfService } from "../src/modules/quotations/pdf/quotation-pdf.service";

describe("quotation expiry and PDF access", () => {
  it("expires a sent quotation after its validity date and records the transition", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-11-10T16:05:00.000Z"));
    try {
      const due = { id: "revision-1", quotationId: "quotation-1", validUntil: new Date("2026-11-10T00:00:00.000Z") };
      const tx = {
        quotationRevision: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        quotation: { update: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        quotationRevision: { findMany: jest.fn().mockResolvedValue([due]) },
        $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
      };
      const audit = { write: jest.fn().mockResolvedValue(undefined) };
      const service = new QuotationsService(prisma as never, audit as never, {} as never, {} as never, {} as never);

      await service.expireDueRevisions();

      expect(prisma.quotationRevision.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          status: QuotationRevisionStatus.SENT,
          validUntil: { lt: new Date("2026-11-11T00:00:00.000Z") },
        }),
      }));
      expect(tx.quotationRevision.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: due.id, status: QuotationRevisionStatus.SENT }),
        data: expect.objectContaining({ status: QuotationRevisionStatus.EXPIRED }),
      }));
      expect(tx.quotation.update).toHaveBeenCalledWith({ where: { id: due.quotationId }, data: { status: QuotationRevisionStatus.EXPIRED } });
      expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: "revision_expired", entityId: due.id }), tx);
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects a PDF request before final approval", async () => {
    const prisma = { quotationRevision: { findUnique: jest.fn().mockResolvedValue({ quotationId: "quotation-1", approvedAt: null }) } };
    const service = new QuotationPdfService(prisma as never);

    await expect(service.generate("quotation-1", "revision-1")).rejects.toThrow(ForbiddenException);
  });
});
