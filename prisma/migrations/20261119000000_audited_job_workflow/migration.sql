ALTER TABLE "quotations" ADD COLUMN "source_work_order_id" TEXT;
CREATE INDEX "quotations_source_work_order_id_idx" ON "quotations"("source_work_order_id");
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_source_work_order_id_fkey"
  FOREIGN KEY ("source_work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "roles" ("id", "name", "is_system", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'Technical Supervisor', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
       (gen_random_uuid()::text, 'Supervisor', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "permissions" ("id", "module", "action", "description", "created_at")
VALUES (gen_random_uuid()::text, 'service_reports', 'technical_approve', 'Supervisor first-stage approval of a reviewed Service Report', CURRENT_TIMESTAMP)
ON CONFLICT ("module", "action") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP FROM "roles" r CROSS JOIN "permissions" p
WHERE r."name" IN ('Technical Supervisor', 'Supervisor') AND p."module" = 'service_reports'
  AND p."action" IN ('read', 'verify', 'technical_approve', 'document_approve')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

DELETE FROM "role_permissions" rp USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id" AND p."module" = 'service_reports'
  AND ((r."name" = 'Office Staff' AND p."action" = 'confirm')
    OR (r."name" IN ('Admin/Owner', 'Manager', 'Office Staff') AND p."action" IN ('technical_approve', 'document_approve')));
