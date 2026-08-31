import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ExtractionContext } from "./extraction-provider.interface";

/**
 * Builds ExtractionContext from the live reference tables — never hard-coded
 * in the provider, so a seeded taxonomy change (a new measurement type, a
 * newly-activated stage) needs no provider redeploy. Reads via the regular
 * app_runtime-credentialed PrismaService, not the ocr_worker client: these
 * are canonical reference tables, and ocr_worker has zero grant on anything
 * outside the six extraction_* staging tables
 * (docs/architecture/ocr-worker-db-isolation.md).
 */
@Injectable()
export class ExtractionContextBuilder {
  constructor(private readonly prisma: PrismaService) {}

  async build(reportTypeCode: string): Promise<ExtractionContext> {
    const [measurementTypes, measurementStages, problemTypes, signoffRoles] = await Promise.all([
      this.prisma.measurementType.findMany({
        where: { status: "ACTIVE" },
        orderBy: { sortOrder: "asc" },
        select: { code: true, label: true },
      }),
      this.prisma.measurementStage.findMany({
        where: { status: "ACTIVE" },
        orderBy: { sortOrder: "asc" },
        select: { code: true, label: true },
      }),
      this.prisma.problemType.findMany({
        where: { status: "ACTIVE" },
        orderBy: { sortOrder: "asc" },
        select: { code: true, label: true },
      }),
      this.prisma.signoffRole.findMany({
        where: { status: "ACTIVE" },
        orderBy: { sortOrder: "asc" },
        select: { code: true, label: true },
      }),
    ]);

    return {
      reportTypeCode,
      allowedMeasurementTypes: measurementTypes,
      allowedMeasurementStages: measurementStages,
      allowedProblemTypes: problemTypes,
      allowedSignoffRoles: signoffRoles,
    };
  }
}
