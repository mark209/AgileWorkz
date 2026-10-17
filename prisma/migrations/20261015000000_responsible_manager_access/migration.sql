ALTER TABLE "work_orders" ADD COLUMN "responsible_manager_id" TEXT;
CREATE INDEX "work_orders_responsible_manager_id_idx" ON "work_orders"("responsible_manager_id");
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_responsible_manager_id_fkey" FOREIGN KEY ("responsible_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "module", "action", "description", "created_at")
VALUES
  (gen_random_uuid()::text, 'work_orders', 'read_assigned', 'View Work Orders explicitly assigned to the responsible Manager', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'service_reports', 'read_assigned', 'View reports linked to Work Orders assigned to the responsible Manager', CURRENT_TIMESTAMP)
ON CONFLICT ("module", "action") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "created_at")
SELECT r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."name" = 'Manager' AND (
  (p."module" = 'work_orders' AND p."action" = 'read_assigned') OR
  (p."module" = 'service_reports' AND p."action" = 'read_assigned')
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."name" = 'Manager'
  AND ((p."module" = 'work_orders' AND p."action" = 'read') OR
       (p."module" = 'service_reports' AND p."action" = 'read'));
