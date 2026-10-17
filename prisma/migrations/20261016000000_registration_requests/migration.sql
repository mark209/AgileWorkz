CREATE TABLE "registration_requests" (
    "id" TEXT NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(30),
    "password_hash" VARCHAR(255) NOT NULL,
    "requested_role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registration_requests_email_key" ON "registration_requests"("email");
CREATE INDEX "registration_requests_created_at_idx" ON "registration_requests"("created_at");
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_requested_role_id_fkey" FOREIGN KEY ("requested_role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Registration requests contain password hashes. They are available only to
-- the server-side Prisma role and the existing read-only backup role.
REVOKE ALL ON "registration_requests" FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON "registration_requests" TO app_runtime;
GRANT SELECT ON "registration_requests" TO app_backup;
ALTER TABLE "registration_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_access ON "registration_requests"
    FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_backup_read ON "registration_requests"
    FOR SELECT TO app_backup USING (true);
