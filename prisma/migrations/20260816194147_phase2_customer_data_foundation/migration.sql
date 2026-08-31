-- Phase 2 — Customer, Site & Equipment domain.
-- Purely additive: no Phase 1 table, column, grant, or constraint is touched
-- by this migration. Generated via `prisma migrate diff` (schema-to-schema,
-- no live database involved) against the approved Phase 2 plan/ERD, with one
-- hand-added constraint at the bottom that Prisma has no declarative
-- attribute for (see note above that statement).

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "EquipmentSystemStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'OUT_OF_SERVICE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "ReferenceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DocumentRelatedType" AS ENUM ('CUSTOMER', 'SITE', 'ASSET');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CONTRACT', 'WARRANTY', 'PHOTO', 'MANUAL', 'COMPLIANCE_CERT', 'OTHER');

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "customer_type" "CustomerType" NOT NULL,
    "billing_address" TEXT NOT NULL,
    "tax_id" VARCHAR(60),
    "phone" VARCHAR(30),
    "email" VARCHAR(255),
    "account_manager_id" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "designation" VARCHAR(100),
    "phone" VARCHAR(30),
    "email" VARCHAR(255),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "address_line" TEXT NOT NULL,
    "city" VARCHAR(100),
    "region" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "geo_lat" DECIMAL(9,6),
    "geo_lng" DECIMAL(9,6),
    "primary_contact_id" TEXT,
    "access_notes" TEXT,
    "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_types" (
    "code" VARCHAR(30) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_types_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "equipment_system_types" (
    "code" VARCHAR(20) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_system_types_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "capacity_units" (
    "code" VARCHAR(20) NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capacity_units_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "equipment_systems" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "system_type_code" VARCHAR(20) NOT NULL,
    "status" "EquipmentSystemStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "equipment_system_id" TEXT,
    "parent_asset_id" TEXT,
    "asset_tag" VARCHAR(60) NOT NULL,
    "equipment_type_code" VARCHAR(30) NOT NULL,
    "brand" VARCHAR(100),
    "model_no" VARCHAR(100),
    "serial_no" VARCHAR(100),
    "capacity_value" DECIMAL(8,2),
    "capacity_unit_code" VARCHAR(20),
    "refrigerant_type" VARCHAR(30),
    "location_in_site" VARCHAR(160),
    "install_date" DATE,
    "warranty_expiry" DATE,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_documents" (
    "id" TEXT NOT NULL,
    "related_type" "DocumentRelatedType" NOT NULL,
    "related_id" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "file_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL,
    "caption" VARCHAR(255),
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- CreateIndex
CREATE INDEX "contacts_customer_id_idx" ON "contacts"("customer_id");

-- CreateIndex
CREATE INDEX "contacts_status_idx" ON "contacts"("status");

-- CreateIndex
CREATE INDEX "sites_customer_id_idx" ON "sites"("customer_id");

-- CreateIndex
CREATE INDEX "sites_status_idx" ON "sites"("status");

-- CreateIndex
CREATE INDEX "equipment_types_status_idx" ON "equipment_types"("status");

-- CreateIndex
CREATE INDEX "equipment_system_types_status_idx" ON "equipment_system_types"("status");

-- CreateIndex
CREATE INDEX "capacity_units_status_idx" ON "capacity_units"("status");

-- CreateIndex
CREATE INDEX "equipment_systems_site_id_idx" ON "equipment_systems"("site_id");

-- CreateIndex
CREATE INDEX "equipment_systems_system_type_code_idx" ON "equipment_systems"("system_type_code");

-- CreateIndex
CREATE INDEX "equipment_systems_status_idx" ON "equipment_systems"("status");

-- CreateIndex
CREATE INDEX "assets_site_id_idx" ON "assets"("site_id");

-- CreateIndex
CREATE INDEX "assets_equipment_system_id_idx" ON "assets"("equipment_system_id");

-- CreateIndex
CREATE INDEX "assets_parent_asset_id_idx" ON "assets"("parent_asset_id");

-- CreateIndex
CREATE INDEX "assets_equipment_type_code_idx" ON "assets"("equipment_type_code");

-- CreateIndex
CREATE INDEX "assets_capacity_unit_code_idx" ON "assets"("capacity_unit_code");

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "assets_site_id_asset_tag_key" ON "assets"("site_id", "asset_tag");

-- CreateIndex
CREATE INDEX "customer_documents_related_type_related_id_idx" ON "customer_documents"("related_type", "related_id");

-- CreateIndex
CREATE INDEX "customer_documents_document_type_idx" ON "customer_documents"("document_type");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_account_manager_id_fkey" FOREIGN KEY ("account_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_systems" ADD CONSTRAINT "equipment_systems_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_systems" ADD CONSTRAINT "equipment_systems_system_type_code_fkey" FOREIGN KEY ("system_type_code") REFERENCES "equipment_system_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_equipment_system_id_fkey" FOREIGN KEY ("equipment_system_id") REFERENCES "equipment_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_asset_id_fkey" FOREIGN KEY ("parent_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_equipment_type_code_fkey" FOREIGN KEY ("equipment_type_code") REFERENCES "equipment_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_capacity_unit_code_fkey" FOREIGN KEY ("capacity_unit_code") REFERENCES "capacity_units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraint
-- Not expressible as a Prisma schema attribute on the pinned 5.x version
-- (no declarative @@check support), so it's hand-added here rather than
-- generated. Approved Phase 2 plan §Constraints: an asset can never be its
-- own parent. NULL passes (a standalone asset with no parent is valid) —
-- Postgres treats a NULL comparison as satisfying the CHECK, so this only
-- rejects the actual self-reference case.
ALTER TABLE "assets" ADD CONSTRAINT "assets_parent_not_self_check" CHECK ("parent_asset_id" <> "id");
