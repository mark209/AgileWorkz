CREATE TYPE "ServiceReportVerificationBasis" AS ENUM ('DOCUMENT_ONLY', 'EXTRACTED_FIELDS');

ALTER TABLE "service_reports" ADD COLUMN "verification_basis" "ServiceReportVerificationBasis";

INSERT INTO "permissions" ("id", "module", "action", "description")
VALUES (gen_random_uuid()::text, 'service_reports', 'document_approve', 'Approve an original Service Report document without extracted fields')
ON CONFLICT ("module", "action") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'Admin/Owner' AND p."module" = 'service_reports' AND p."action" = 'document_approve'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
