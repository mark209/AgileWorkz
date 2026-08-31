import { BadRequestException, Inject, Injectable, NotFoundException, UnsupportedMediaTypeException } from "@nestjs/common";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { ActorType, DocumentRelatedType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ActorContext } from "../identity/users.service";
import { STORAGE_PROVIDER, StorageProvider } from "../../common/storage/storage-provider.interface";
import { UploadDocumentDto } from "./dto/upload-document.dto";

const STORAGE_KEY_PREFIX = "customer-documents";

// Approved V1 decisions (customer_documents upload policy) — not
// implementation assumptions. Both are also recorded in the Phase 2 plan
// artifact (§08/§15). Widening either is a scope change, not a bug fix.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB per file
export const ALLOWED_UPLOAD_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async findByIdOrThrow(id: string) {
    const document = await this.prisma.customerDocument.findUnique({ where: { id } });
    if (!document) throw new NotFoundException("Document not found");
    return document;
  }

  async list(relatedType: DocumentRelatedType, relatedId: string) {
    return this.prisma.customerDocument.findMany({
      where: { relatedType, relatedId },
      orderBy: { uploadedAt: "desc" },
    });
  }

  async getSignedUrl(id: string) {
    const document = await this.findByIdOrThrow(id);
    const url = await this.storage.getSignedUrl(document.fileKey);
    return { url };
  }

  async upload(file: Express.Multer.File | undefined, dto: UploadDocumentDto, actor: ActorContext) {
    if (!file) {
      throw new BadRequestException("A file is required");
    }
    // Approved V1 allowlist — PDF and the three common image formats only.
    // DOCX/XLSX/ZIP/executables are explicitly out of scope until a later
    // phase requires them.
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `Unsupported file type: ${file.mimetype}. Allowed types: ${[...ALLOWED_UPLOAD_MIME_TYPES].join(", ")}`,
      );
    }
    await this.assertRelatedEntityExists(dto.relatedType, dto.relatedId);

    // The row's own id doubles as the storage key's unique component, so
    // the two always correlate 1:1 with no separate collision risk.
    const id = crypto.randomUUID();
    const checksumSha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
    const extension = path.extname(file.originalname);
    const fileKey = `${STORAGE_KEY_PREFIX}/${id}${extension}`;

    // Storage write happens before the DB row exists, never after — a row
    // must never reference an object that was never actually written.
    await this.storage.putObject({ key: fileKey, body: file.buffer, contentType: file.mimetype });

    let document;
    try {
      document = await this.prisma.customerDocument.create({
        data: {
          id,
          relatedType: dto.relatedType,
          relatedId: dto.relatedId,
          documentType: dto.documentType,
          fileKey,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          checksumSha256,
          uploadedBy: actor.userId,
          uploadedAt: new Date(),
          caption: dto.caption,
          description: dto.description,
        },
      });
    } catch (e) {
      // Don't leave an orphaned object behind if the DB write fails right
      // after a successful upload.
      await this.storage.deleteObject(fileKey).catch(() => undefined);
      throw e;
    }

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "document_uploaded",
      entityType: "customer_document",
      entityId: document.id,
      afterData: {
        relatedType: document.relatedType,
        relatedId: document.relatedId,
        documentType: document.documentType,
        fileName: document.fileName,
        checksumSha256: document.checksumSha256,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return document;
  }

  // The one Phase 2 entity with a real DELETE — approved as a deliberate
  // exception to the disable-never-delete pattern used everywhere else,
  // since these documents (contracts, warranties, photos) are far less
  // sensitive than the future immutable Service Report proof-of-service
  // records. The DB row is authoritative and removed first; storage cleanup
  // is best-effort afterward so an unrelated storage hiccup never reports a
  // successful deletion as a failure.
  async remove(id: string, actor: ActorContext) {
    const before = await this.findByIdOrThrow(id);

    await this.prisma.customerDocument.delete({ where: { id } });

    await this.audit.write({
      actorType: ActorType.USER,
      actorUserId: actor.userId,
      action: "document_deleted",
      entityType: "customer_document",
      entityId: id,
      beforeData: {
        relatedType: before.relatedType,
        relatedId: before.relatedId,
        fileName: before.fileName,
        checksumSha256: before.checksumSha256,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    await this.storage.deleteObject(before.fileKey).catch(() => undefined);
  }

  private async assertRelatedEntityExists(relatedType: DocumentRelatedType, relatedId: string) {
    switch (relatedType) {
      case DocumentRelatedType.CUSTOMER: {
        const exists = await this.prisma.customer.findUnique({ where: { id: relatedId }, select: { id: true } });
        if (!exists) throw new NotFoundException("Customer not found");
        return;
      }
      case DocumentRelatedType.SITE: {
        const exists = await this.prisma.site.findUnique({ where: { id: relatedId }, select: { id: true } });
        if (!exists) throw new NotFoundException("Site not found");
        return;
      }
      case DocumentRelatedType.ASSET: {
        const exists = await this.prisma.asset.findUnique({ where: { id: relatedId }, select: { id: true } });
        if (!exists) throw new NotFoundException("Asset not found");
        return;
      }
      // Step 3 correction — reuses this existing polymorphic infrastructure
      // for inquiry attachments instead of a separate system.
      case DocumentRelatedType.INQUIRY: {
        const exists = await this.prisma.inquiry.findUnique({ where: { id: relatedId }, select: { id: true } });
        if (!exists) throw new NotFoundException("Inquiry not found");
        return;
      }
    }
  }
}
