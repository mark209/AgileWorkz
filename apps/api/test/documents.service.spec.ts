import * as crypto from "node:crypto";
import { DocumentRelatedType, DocumentType } from "@prisma/client";
import { BadRequestException, NotFoundException, UnsupportedMediaTypeException } from "@nestjs/common";
import { DocumentsService } from "../src/modules/documents/documents.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { AuditService } from "../src/modules/audit/audit.service";
import { StorageProvider } from "../src/common/storage/storage-provider.interface";
import { mockOf } from "./test-utils";

const actor = { userId: "actor-1", ipAddress: "127.0.0.1", userAgent: "jest" };

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: "warranty.pdf",
    encoding: "7bit",
    mimetype: "application/pdf",
    buffer: Buffer.from("test content"),
    size: 12,
    ...overrides,
  } as Express.Multer.File;
}

const uploadDto = {
  relatedType: DocumentRelatedType.CUSTOMER,
  relatedId: "cust-1",
  documentType: DocumentType.WARRANTY,
};

describe("DocumentsService — the one Phase 2 entity with a real DELETE", () => {
  it("rejects an upload with no file", async () => {
    const prisma = mockOf<PrismaService>({});
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const storage = mockOf<StorageProvider>({ putObject: jest.fn() });
    const service = new DocumentsService(prisma, audit, storage);

    await expect(service.upload(undefined, uploadDto, actor)).rejects.toThrow(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects an unsupported MIME type before any related-entity lookup or storage write", async () => {
    const prisma = mockOf<PrismaService>({ customer: { findUnique: jest.fn() } });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const storage = mockOf<StorageProvider>({ putObject: jest.fn() });
    const service = new DocumentsService(prisma, audit, storage);

    const zipFile = makeFile({ originalname: "archive.zip", mimetype: "application/zip" });

    await expect(service.upload(zipFile, uploadDto, actor)).rejects.toThrow(UnsupportedMediaTypeException);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it.each([
    ["application/pdf", "file.pdf"],
    ["image/jpeg", "photo.jpg"],
    ["image/png", "photo.png"],
    ["image/webp", "photo.webp"],
  ])("accepts the approved V1 MIME type %s", async (mimetype, originalname) => {
    const file = makeFile({ mimetype, originalname });
    const created = { id: "doc-1" };
    const prisma = mockOf<PrismaService>({
      customer: { findUnique: jest.fn().mockResolvedValue({ id: "cust-1" }) },
      customerDocument: { create: jest.fn().mockResolvedValue(created) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const storage = mockOf<StorageProvider>({
      putObject: jest.fn().mockResolvedValue({ key: "customer-documents/whatever" }),
    });
    const service = new DocumentsService(prisma, audit, storage);

    await expect(service.upload(file, uploadDto, actor)).resolves.toBe(created);
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({ contentType: mimetype }));
  });

  it("rejects an upload whose relatedId doesn't resolve to an existing customer", async () => {
    const prisma = mockOf<PrismaService>({
      customer: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const storage = mockOf<StorageProvider>({ putObject: jest.fn() });
    const service = new DocumentsService(prisma, audit, storage);

    await expect(service.upload(makeFile(), uploadDto, actor)).rejects.toThrow(NotFoundException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("validates against the site table when relatedType is SITE, not customer", async () => {
    const prisma = mockOf<PrismaService>({
      site: { findUnique: jest.fn().mockResolvedValue(null) },
      customer: { findUnique: jest.fn() },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const storage = mockOf<StorageProvider>({ putObject: jest.fn() });
    const service = new DocumentsService(prisma, audit, storage);

    await expect(
      service.upload(makeFile(), { ...uploadDto, relatedType: DocumentRelatedType.SITE, relatedId: "site-1" }, actor),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it("uploads to storage before creating the DB row, computes the real SHA-256, and audits document_uploaded", async () => {
    const file = makeFile();
    const expectedChecksum = crypto.createHash("sha256").update(file.buffer).digest("hex");
    const created = { id: "doc-1", relatedType: DocumentRelatedType.CUSTOMER, relatedId: "cust-1" };
    const prisma = mockOf<PrismaService>({
      customer: { findUnique: jest.fn().mockResolvedValue({ id: "cust-1" }) },
      customerDocument: { create: jest.fn().mockResolvedValue(created) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const storage = mockOf<StorageProvider>({
      putObject: jest.fn().mockResolvedValue({ key: "customer-documents/whatever.pdf" }),
    });
    const service = new DocumentsService(prisma, audit, storage);

    const result = await service.upload(file, uploadDto, actor);

    expect(result).toBe(created);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ body: file.buffer, contentType: "application/pdf" }),
    );
    const createCall = (prisma.customerDocument.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.checksumSha256).toBe(expectedChecksum);
    expect(createCall.data.fileKey).toMatch(/^customer-documents\/.+\.pdf$/);
    expect(createCall.data.uploadedBy).toBe(actor.userId);
    // storage write happened before the DB write
    expect(storage.putObject).toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document_uploaded", entityType: "customer_document", entityId: "doc-1" }),
    );
  });

  it("cleans up the just-uploaded storage object if the DB write fails", async () => {
    const file = makeFile();
    const prisma = mockOf<PrismaService>({
      customer: { findUnique: jest.fn().mockResolvedValue({ id: "cust-1" }) },
      customerDocument: { create: jest.fn().mockRejectedValue(new Error("db exploded")) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const storage = mockOf<StorageProvider>({
      putObject: jest.fn().mockResolvedValue({ key: "customer-documents/whatever.pdf" }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    });
    const service = new DocumentsService(prisma, audit, storage);

    await expect(service.upload(file, uploadDto, actor)).rejects.toThrow("db exploded");
    expect(storage.deleteObject).toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it("list() scopes by relatedType and relatedId", async () => {
    const rows = [{ id: "doc-1" }];
    const prisma = mockOf<PrismaService>({
      customerDocument: { findMany: jest.fn().mockResolvedValue(rows) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const storage = mockOf<StorageProvider>({});
    const service = new DocumentsService(prisma, audit, storage);

    const result = await service.list(DocumentRelatedType.ASSET, "asset-1");

    expect(result).toBe(rows);
    expect(prisma.customerDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { relatedType: DocumentRelatedType.ASSET, relatedId: "asset-1" } }),
    );
  });

  it("getSignedUrl() delegates to the storage provider with the document's fileKey", async () => {
    const prisma = mockOf<PrismaService>({
      customerDocument: { findUnique: jest.fn().mockResolvedValue({ id: "doc-1", fileKey: "customer-documents/doc-1.pdf" }) },
    });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const storage = mockOf<StorageProvider>({
      getSignedUrl: jest.fn().mockResolvedValue("https://signed.example/doc-1.pdf"),
    });
    const service = new DocumentsService(prisma, audit, storage);

    const result = await service.getSignedUrl("doc-1");

    expect(result).toEqual({ url: "https://signed.example/doc-1.pdf" });
    expect(storage.getSignedUrl).toHaveBeenCalledWith("customer-documents/doc-1.pdf");
  });

  it("remove() deletes the DB row first, audits document_deleted, then best-effort deletes storage", async () => {
    const before = { id: "doc-1", fileKey: "customer-documents/doc-1.pdf", fileName: "warranty.pdf" };
    const prisma = mockOf<PrismaService>({
      customerDocument: {
        findUnique: jest.fn().mockResolvedValue(before),
        delete: jest.fn().mockResolvedValue(before),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const storage = mockOf<StorageProvider>({ deleteObject: jest.fn().mockResolvedValue(undefined) });
    const service = new DocumentsService(prisma, audit, storage);

    await service.remove("doc-1", actor);

    expect(prisma.customerDocument.delete).toHaveBeenCalledWith({ where: { id: "doc-1" } });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document_deleted", entityType: "customer_document", entityId: "doc-1" }),
    );
    expect(storage.deleteObject).toHaveBeenCalledWith("customer-documents/doc-1.pdf");
  });

  it("remove() still succeeds even if the best-effort storage cleanup fails", async () => {
    const before = { id: "doc-1", fileKey: "customer-documents/doc-1.pdf" };
    const prisma = mockOf<PrismaService>({
      customerDocument: {
        findUnique: jest.fn().mockResolvedValue(before),
        delete: jest.fn().mockResolvedValue(before),
      },
    });
    const audit = mockOf<AuditService>({ write: jest.fn().mockResolvedValue(undefined) });
    const storage = mockOf<StorageProvider>({ deleteObject: jest.fn().mockRejectedValue(new Error("storage down")) });
    const service = new DocumentsService(prisma, audit, storage);

    await expect(service.remove("doc-1", actor)).resolves.toBeUndefined();
  });

  it("findByIdOrThrow throws NotFoundException for a missing document", async () => {
    const prisma = mockOf<PrismaService>({ customerDocument: { findUnique: jest.fn().mockResolvedValue(null) } });
    const audit = mockOf<AuditService>({ write: jest.fn() });
    const storage = mockOf<StorageProvider>({});
    const service = new DocumentsService(prisma, audit, storage);

    await expect(service.findByIdOrThrow("missing")).rejects.toThrow(NotFoundException);
  });
});
