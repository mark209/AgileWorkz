import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, ServiceReport, ServiceReportStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ConfirmationPlan, ConfirmationPlanBuilderService } from "./confirmation-plan-builder.service";

export interface ActorContext {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ConfirmationResult {
  report: ServiceReport;
  createdCounts: {
    technicians: number;
    equipmentUnits: number;
    problems: number;
    measurements: number;
    narrativeItems: number;
    signoffs: number;
  };
  skippedCount: number;
  warnings: string[];
}

/**
 * Phase 5 Step 6 (Confirm Report). The only code path permitted to write to
 * the six canonical service_report_* detail tables and to move a Service
 * Report into CONFIRMED — same "one writer" discipline the staging tables
 * already have for ocr_worker (ocr-worker-db-isolation.md) and verification
 * already has for extraction_* review columns (Step 5).
 */
@Injectable()
export class ServiceReportConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planBuilder: ConfirmationPlanBuilderService,
    private readonly audit: AuditService,
  ) {}

  private async findReportOrThrow(serviceReportId: string): Promise<ServiceReport> {
    const report = await this.prisma.serviceReport.findUnique({ where: { id: serviceReportId } });
    if (!report) throw new NotFoundException("Service Report not found");
    return report;
  }

  /**
   * Approved Decision 7 — read-only, zero persistent writes. Runs the exact
   * same ConfirmationPlanBuilderService against the live PrismaService
   * (not a transaction, since nothing is written) that confirm() below runs
   * inside its own transaction — the mapping/validation logic can never
   * drift between the two, only the write side differs. Advisory only: the
   * plan returned here is never accepted back from a client as input to
   * confirm() — confirm() always re-reads and re-builds from scratch.
   */
  async preview(serviceReportId: string): Promise<ConfirmationPlan> {
    await this.findReportOrThrow(serviceReportId);
    return this.planBuilder.buildPlan(this.prisma, serviceReportId);
  }

  async getCanonicalView(serviceReportId: string) {
    const report = await this.findReportOrThrow(serviceReportId);
    if (report.status !== ServiceReportStatus.CONFIRMED && report.status !== ServiceReportStatus.LOCKED) {
      throw new BadRequestException(`Service Report is ${report.status}, not CONFIRMED or LOCKED — no canonical data exists yet`);
    }
    const [technicians, equipmentUnits, problems, measurements, narrativeItems, signoffs] = await Promise.all([
      this.prisma.serviceReportTechnician.findMany({ where: { serviceReportId }, orderBy: { sortOrder: "asc" } }),
      this.prisma.serviceReportEquipmentUnit.findMany({ where: { serviceReportId }, orderBy: { sortOrder: "asc" } }),
      this.prisma.serviceReportProblem.findMany({ where: { serviceReportId }, orderBy: { sortOrder: "asc" } }),
      this.prisma.serviceReportMeasurement.findMany({ where: { serviceReportId }, orderBy: { sortOrder: "asc" } }),
      this.prisma.serviceReportNarrativeItem.findMany({ where: { serviceReportId }, orderBy: { sortOrder: "asc" } }),
      this.prisma.serviceReportSignoff.findMany({ where: { serviceReportId }, orderBy: { sortOrder: "asc" } }),
    ]);
    return { report, technicians, equipmentUnits, problems, measurements, narrativeItems, signoffs };
  }

  /**
   * Approved Decision set (Step 6) — one atomic transaction, in the exact
   * order specified: re-read/validate, resolve mappings, create equipment
   * units first (so dependents can link to them by rowIndex), create
   * dependents, update the report's confirmation metadata/status, write the
   * audit record. Any failure anywhere rolls back everything — a report is
   * never left partially confirmed.
   *
   * Idempotency/concurrency: the guarded `updateMany({where:{id,
   * status:VERIFIED}})` at the end is the sole gate, but it is safe even
   * though it runs last, not first — Postgres serializes two concurrent
   * transactions' UPDATEs against the same row: whichever commits first
   * wins (count===1); the second's WHERE clause no longer matches once the
   * first has committed (status is no longer VERIFIED), so it throws
   * ConflictException, and because everything is inside ONE
   * `$transaction`, that failure rolls back every canonical row the
   * "losing" transaction had created earlier in this same call — it never
   * leaves duplicate canonical data behind. The same
   * updateMany-guard-then-ConflictException idiom is already used
   * elsewhere in this codebase (quotations.service.ts, work-orders.service.ts).
   */
  async confirm(serviceReportId: string, actor: ActorContext): Promise<ConfirmationResult> {
    return this.prisma.$transaction(async (tx) => {
      // Steps 1-4: re-read, validate, resolve deterministic mappings.
      const plan = await this.planBuilder.buildPlan(tx, serviceReportId);
      if (!plan.isConfirmable) {
        throw new BadRequestException(
          `Cannot confirm: ${plan.validationIssues.map((i) => i.message).join("; ")}`,
        );
      }

      // Defense in depth beyond the status check above: refuse outright if
      // canonical data already exists for this report under any
      // circumstance (a status/data desync that should never happen, but
      // must never silently double-write if it somehow did).
      const existingCanonicalCount =
        (await tx.serviceReportEquipmentUnit.count({ where: { serviceReportId } })) +
        (await tx.serviceReportProblem.count({ where: { serviceReportId } })) +
        (await tx.serviceReportMeasurement.count({ where: { serviceReportId } })) +
        (await tx.serviceReportNarrativeItem.count({ where: { serviceReportId } })) +
        (await tx.serviceReportSignoff.count({ where: { serviceReportId } })) +
        (await tx.serviceReportTechnician.count({ where: { serviceReportId } }));
      if (existingCanonicalCount > 0) {
        throw new ConflictException("Service Report already has canonical data — Confirm cannot run again");
      }

      // Step 5: canonical equipment units first, building the rowIndex ->
      // canonical id map every dependent category below resolves against.
      const equipmentIdByRowIndex = new Map<number, string>();
      const createdEquipmentIds: string[] = []; // parallel to plan.equipmentUnits, by index — used only to build the audit manifest below
      let sortOrder = 0;
      for (const unit of plan.equipmentUnits) {
        const created = await tx.serviceReportEquipmentUnit.create({
          data: {
            serviceReportId,
            equipmentTypeCode: unit.equipmentTypeCode,
            unitTag: unit.unitTag,
            description: unit.description,
            location: unit.location,
            modelNumber: unit.modelNumber,
            serialNumber: unit.serialNumber,
            sortOrder: sortOrder++,
            sourceRowIndex: unit.rowIndex,
          },
        });
        equipmentIdByRowIndex.set(unit.rowIndex, created.id);
        createdEquipmentIds.push(created.id);
      }

      // Step 6: every dependent canonical row.
      if (plan.technicians.length > 0) {
        await tx.serviceReportTechnician.createMany({
          data: plan.technicians.map((t) => ({ serviceReportId, technicianName: t.technicianName, sortOrder: t.sortOrder })),
        });
      }
      let problemSort = 0;
      for (const p of plan.problems) {
        await tx.serviceReportProblem.create({
          data: {
            serviceReportId,
            equipmentUnitId: equipmentIdByRowIndex.get(p.rowIndex) ?? null,
            problemTypeCode: p.problemTypeCode,
            description: p.description,
            sortOrder: problemSort++,
            sourceRowIndex: p.rowIndex,
          },
        });
      }
      let measurementSort = 0;
      for (const m of plan.measurements) {
        await tx.serviceReportMeasurement.create({
          data: {
            serviceReportId,
            equipmentUnitId: equipmentIdByRowIndex.get(m.equipmentRowIndex) ?? null,
            measurementTypeCode: m.measurementTypeCode,
            stageCode: m.stageCode,
            value: m.value,
            unit: m.unit,
            sortOrder: measurementSort++,
            sourceRowIndex: m.equipmentRowIndex,
            sourceFieldName: m.sourceFieldName,
          },
        });
      }
      let narrativeSort = 0;
      for (const n of plan.narrativeItems) {
        await tx.serviceReportNarrativeItem.create({
          data: {
            serviceReportId,
            equipmentUnitId: equipmentIdByRowIndex.get(n.equipmentRowIndex) ?? null,
            category: n.category,
            description: n.description,
            sortOrder: narrativeSort++,
            sourceRowIndex: n.equipmentRowIndex,
          },
        });
      }
      let signoffSort = 0;
      for (const s of plan.signoffs) {
        await tx.serviceReportSignoff.create({
          data: {
            serviceReportId,
            signoffRoleCode: s.signoffRoleCode,
            signatoryName: s.signatoryName,
            signed: s.signed,
            sortOrder: signoffSort++,
            sourceRowIndex: s.provenance.rowIndex,
          },
        });
      }

      // Step 7: the atomic status guard — see the method-level comment for
      // why placing it last is still safe.
      const now = new Date();
      const guarded = await tx.serviceReport.updateMany({
        where: { id: serviceReportId, status: ServiceReportStatus.VERIFIED },
        data: {
          status: ServiceReportStatus.CONFIRMED,
          confirmedBy: actor.userId,
          confirmedAt: now,
          // The canonical basic_info header fields (OD3) — this is the one
          // and only place they are ever populated, per the schema's own
          // design comment on ServiceReport.
          serviceDate: plan.header.serviceDate,
          timeIn: plan.header.timeIn,
          timeOut: plan.header.timeOut,
          reportReferenceNumber: plan.header.reportReferenceNumber,
          contactName: plan.header.contactName,
          contactPhone: plan.header.contactPhone,
          generalNotes: plan.header.generalNotes,
        },
      });
      if (guarded.count === 0) {
        throw new ConflictException("This Service Report is no longer VERIFIED — it may have just been confirmed by someone else");
      }
      const updatedReport = await tx.serviceReport.findUniqueOrThrow({ where: { id: serviceReportId } });

      // Step 8: the confirmation audit record, inside the same transaction
      // — a full manifest of every canonical row created (category +
      // canonical id + originating staging row id/fieldName), sufficient to
      // reconstruct provenance for every value even where no dedicated
      // provenance column exists on the canonical table itself (only
      // service_report_measurements.source_field_name does — see that
      // column's migration comment).
      const manifest = [
        ...plan.equipmentUnits.map((u, i) => ({ category: "equipmentUnit", canonicalId: createdEquipmentIds[i], provenance: u.provenance })),
        ...plan.problems.map((p) => ({ category: "problem", provenance: [p.provenance] })),
        ...plan.measurements.map((m) => ({ category: "measurement", provenance: [m.provenance] })),
        ...plan.narrativeItems.map((n) => ({ category: "narrativeItem", provenance: [n.provenance] })),
        ...plan.signoffs.map((s) => ({ category: "signoff", provenance: [s.provenance] })),
        ...plan.technicians.map((t) => ({ category: "basicInfo", provenance: [t.provenance] })),
      ];
      await this.audit.write(
        {
          actorType: ActorType.USER,
          actorUserId: actor.userId,
          action: "service_report_confirmed",
          entityType: "ServiceReport",
          entityId: serviceReportId,
          beforeData: { status: ServiceReportStatus.VERIFIED },
          afterData: {
            status: ServiceReportStatus.CONFIRMED,
            createdCounts: {
              technicians: plan.technicians.length,
              equipmentUnits: plan.equipmentUnits.length,
              problems: plan.problems.length,
              measurements: plan.measurements.length,
              narrativeItems: plan.narrativeItems.length,
              signoffs: plan.signoffs.length,
            },
            skipped: plan.skipped,
            warnings: plan.warnings,
            manifest,
          },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        },
        tx,
      );

      return {
        report: updatedReport,
        createdCounts: {
          technicians: plan.technicians.length,
          equipmentUnits: plan.equipmentUnits.length,
          problems: plan.problems.length,
          measurements: plan.measurements.length,
          narrativeItems: plan.narrativeItems.length,
          signoffs: plan.signoffs.length,
        },
        skippedCount: plan.skipped.length,
        warnings: plan.warnings,
      };
    });
  }

  /**
   * Phase 5 Step 7 (Lock) — approved design. CONFIRMED -> LOCKED only, a
   * pure status/actor/timestamp transition: unlike confirm(), lock() never
   * reads staging data, resolves any mapping, or writes to any canonical
   * detail table (service_report_equipment_units/problems/measurements/
   * narrative_items/signoffs/technicians are untouched — verified by
   * dedicated tests). Forward-only by explicit approved decision: there is
   * no unlock() method, no unlock endpoint, and none should ever be added
   * under normal application operation.
   *
   * Exceptional correction of a LOCKED report's canonical data is
   * explicitly out of scope here (approved decision) — it would require a
   * separately designed amendment/correction capability that preserves
   * historical auditability (e.g. an append-only correction record
   * referencing the original), never an in-place mutation of a locked row.
   * No such capability exists anywhere in this codebase today.
   *
   * Same atomic-guard idiom as confirm() and as quotations.service.ts/
   * work-orders.service.ts: a pre-check gives a clean 404/400, and the
   * guarded updateMany is the actual concurrency-safe gate — safe even
   * though nothing else happens after it, for the same reason confirm()'s
   * end-of-transaction guard is safe (Postgres serializes concurrent
   * UPDATEs on the same row; the loser's WHERE clause stops matching once
   * the winner commits, and the whole transaction rolls back).
   */
  async lock(serviceReportId: string, actor: ActorContext): Promise<ServiceReport> {
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.serviceReport.findUnique({ where: { id: serviceReportId } });
      if (!report) throw new NotFoundException("Service Report not found");
      if (report.status !== ServiceReportStatus.CONFIRMED) {
        throw new BadRequestException(`Service Report is ${report.status}, not CONFIRMED — only a CONFIRMED report can be locked`);
      }

      const now = new Date();
      const guarded = await tx.serviceReport.updateMany({
        where: { id: serviceReportId, status: ServiceReportStatus.CONFIRMED },
        data: { status: ServiceReportStatus.LOCKED, lockedBy: actor.userId, lockedAt: now },
      });
      if (guarded.count === 0) {
        throw new ConflictException("This Service Report is no longer CONFIRMED — it may have just been locked by someone else");
      }
      const updatedReport = await tx.serviceReport.findUniqueOrThrow({ where: { id: serviceReportId } });

      await this.audit.write(
        {
          actorType: ActorType.USER,
          actorUserId: actor.userId,
          action: "service_report_locked",
          entityType: "ServiceReport",
          entityId: serviceReportId,
          beforeData: { status: ServiceReportStatus.CONFIRMED },
          afterData: { status: ServiceReportStatus.LOCKED },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        },
        tx,
      );

      return updatedReport;
    });
  }
}
