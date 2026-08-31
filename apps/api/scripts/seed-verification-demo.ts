/**
 * One-off script: creates a demo Office Staff user + a PENDING_VERIFICATION
 * Service Report with a realistic spread of field states (high-confidence,
 * requires-verification, unresolved/unreadable, blank, and one already
 * CONFIRMED) so the Human Verification UI can be visually reviewed in a
 * real browser against real data. Not part of the application; run once,
 * prints login credentials + the report id.
 *
 * Usage (from apps/api):
 *   pnpm exec ts-node -O '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/seed-verification-demo.ts
 */
import * as path from "node:path";
import * as fs from "node:fs";
import * as dotenv from "dotenv";
import * as argon2 from "argon2";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { PrismaService } from "../src/prisma/prisma.service";
import { LocalDiskStorageProvider } from "../src/common/storage/local-disk-storage.provider";
import { S3StorageProvider } from "../src/common/storage/s3-storage.provider";

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  // Match storage.module.ts's own selection exactly — this environment's
  // .env has STORAGE_PROVIDER=s3 (a real local MinIO instance), so the
  // object must actually be written there for the real running app (which
  // makes this same choice) to find it when generating a signed URL.
  const storage = process.env.STORAGE_PROVIDER === "s3" ? new S3StorageProvider() : new LocalDiskStorageProvider();

  const suffix = Date.now().toString(36);

  // Permission + role + user (Office Staff-equivalent: upload/read/verify).
  const perms = await Promise.all(
    [
      ["service_reports", "upload"],
      ["service_reports", "read"],
      ["service_reports", "verify"],
    ].map(([module, action]) =>
      prisma.permission.upsert({
        where: { module_action: { module, action } },
        update: {},
        create: { module, action, description: "demo fixture" },
      }),
    ),
  );
  const role = await prisma.role.create({ data: { name: `demo-verifier-${suffix}`, isSystem: false } });
  for (const p of perms) await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: p.id } });

  const email = `verifier-demo-${suffix}@example.test`;
  const password = "Correct-Horse-Battery-Staple-1!";
  const user = await prisma.user.create({
    data: { fullName: "Demo Verifier", email, passwordHash: await argon2.hash(password), status: "ACTIVE" },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

  const uploaderRole = await prisma.role.create({ data: { name: `demo-technician-${suffix}`, isSystem: false } });
  const uploadPerm = perms.find((p) => p.action === "upload")!;
  await prisma.rolePermission.create({ data: { roleId: uploaderRole.id, permissionId: uploadPerm.id } });
  const uploader = await prisma.user.create({
    data: { fullName: "Demo Technician", email: `technician-demo-${suffix}@example.test`, passwordHash: await argon2.hash(password), status: "ACTIVE" },
  });
  await prisma.userRole.create({ data: { userId: uploader.id, roleId: uploaderRole.id } });

  // Customer/site + a real image object in local disk storage, using the
  // actual Bayshore Start-Up report photo already used throughout Phase 5
  // testing, so the document viewer shows a real, representative document.
  const customer = await prisma.customer.create({
    data: { name: `Demo Customer ${suffix}`, customerType: "COMMERCIAL", billingAddress: "123 Demo Street", status: "ACTIVE" },
  });
  const site = await prisma.site.create({
    data: { customerId: customer.id, label: `Demo Site ${suffix}`, addressLine: "456 Demo Avenue", status: "ACTIVE" },
  });

  const sourceImage = "C:/Users/Joy Ann/Downloads/Neil Personal Files/AgileWorks Solutions OPC/WhatsApp Image 2026-08-29 at 8.13.37 AM.jpeg";
  const fileKey = `demo/service-reports/${suffix}.jpeg`;
  await storage.putObject({ key: fileKey, body: fs.readFileSync(sourceImage), contentType: "image/jpeg" });

  const report = await prisma.serviceReport.create({
    data: {
      serviceReportNumber: `DEMO-${suffix}`,
      customerId: customer.id,
      siteId: site.id,
      reportTypeCode: "MAINTENANCE_CLEANING",
      sourceType: "INTERNAL_SERVICE",
      status: "PENDING_VERIFICATION",
      documentFileKey: fileKey,
      documentMimeType: "image/jpeg",
      documentFileName: "SR-0119.jpg",
      documentFileSize: fs.statSync(sourceImage).size,
      uploadedBy: uploader.id,
      uploadedAt: new Date(),
    },
  });

  await prisma.extractionBasicInfo.createMany({
    data: [
      { serviceReportId: report.id, rowIndex: 0, fieldName: "Customer Name", aiValue: "Sinocan Corporate Center", aiConfidence: "HIGH", requiresHumanVerification: false },
      { serviceReportId: report.id, rowIndex: 0, fieldName: "Work Date", aiValue: "August 28, 2026", aiConfidence: "HIGH", requiresHumanVerification: false },
      { serviceReportId: report.id, rowIndex: 0, fieldName: "Contact Person / Tel No.", aiValue: null, aiConfidence: null, requiresHumanVerification: false },
    ],
  });

  await prisma.extractionProblem.createMany({
    data: [
      { serviceReportId: report.id, rowIndex: 0, fieldName: "OTHERS", aiValue: "checked", aiConfidence: "HIGH", requiresHumanVerification: false, reviewStatus: "CONFIRMED", verifiedValue: "checked", verifiedBy: user.id, verifiedAt: new Date() },
      { serviceReportId: report.id, rowIndex: 0, fieldName: "NOT OPERATIONAL", aiValue: "unchecked", aiConfidence: "HIGH", requiresHumanVerification: false },
    ],
  });

  await prisma.extractionMeasurement.createMany({
    data: [
      { serviceReportId: report.id, rowIndex: 0, fieldName: "Low Side Pressure", aiValue: "65", aiUnit: "psi", aiConfidence: "HIGH", suggestedMeasurementTypeCode: "LOW_SIDE_PRESSURE", requiresHumanVerification: false },
      { serviceReportId: report.id, rowIndex: 0, fieldName: "High Side Pressure", aiValue: "410", aiUnit: "psi", aiConfidence: "MEDIUM", suggestedMeasurementTypeCode: "HIGH_SIDE_PRESSURE", requiresHumanVerification: true },
      { serviceReportId: report.id, rowIndex: 0, fieldName: "Breaker Capacity", aiValue: "ISA", aiConfidence: "LOW", suggestedMeasurementTypeCode: "BREAKER_CAPACITY", requiresHumanVerification: false },
      { serviceReportId: report.id, rowIndex: 1, fieldName: "Suction Air Temp", aiValue: null, aiConfidence: "UNREADABLE", suggestedMeasurementTypeCode: "OUTDOOR_SUCTION_AIR_TEMPERATURE", requiresHumanVerification: true },
      { serviceReportId: report.id, rowIndex: 1, fieldName: "Room Temp", aiValue: null, aiConfidence: null, requiresHumanVerification: false },
    ],
  });

  await prisma.extractionNarrativeItem.createMany({
    data: [
      { serviceReportId: report.id, rowIndex: 0, fieldName: "Work Description", aiValue: "General cleaning of 6 indoor and outdoor units.", aiConfidence: "HIGH", requiresHumanVerification: false },
    ],
  });

  await prisma.extractionSignoff.createMany({
    data: [
      { serviceReportId: report.id, rowIndex: 0, fieldName: "Technician Signature", aiValue: "John Arnold Candia", aiConfidence: "MEDIUM", requiresHumanVerification: false },
    ],
  });

  await prisma.$disconnect();

  console.log("\n=== Demo verification fixture ready ===");
  console.log(`Verifier login: ${email} / ${password}`);
  console.log(`Report id: ${report.id}`);
  console.log(`Verify URL: http://localhost:3000/service-reports/${report.id}/verify`);
  console.log(`Queue URL:  http://localhost:3000/service-reports`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
