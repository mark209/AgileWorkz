import * as crypto from "node:crypto";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserStatus } from "@prisma/client";
import { bootstrapTestApp, E2eFixtures } from "./support";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageProvider } from "../../src/common/storage/storage-provider.interface";

const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF",
);

/**
 * Live E2E — Phase 2 Step 9. The real storage round-trip: an actual file
 * goes through StorageProvider.putObject (local disk or MinIO, whichever
 * STORAGE_PROVIDER selects) and back out via a signed URL, not a mock.
 * Also proves the approved V1 policy (25 MB limit, PDF/JPEG/PNG/WebP
 * allowlist) is enforced by the live HTTP stack, and that a rejected
 * upload never touches the existing document list.
 */
describe("Documents — real storage round-trip (live)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageProvider;
  let fixtures: E2eFixtures;

  beforeAll(async () => {
    ({ app, prisma, storage } = await bootstrapTestApp());
    fixtures = new E2eFixtures(prisma, storage);
  });

  afterAll(async () => {
    await fixtures.cleanupAll();
    await app.close();
  });

  async function loginHeader(email: string, password: string) {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
    return `Bearer ${res.body.accessToken}`;
  }

  async function fullAccessHeader() {
    const perms = await Promise.all(
      [
        ["customer_documents", "upload"],
        ["customer_documents", "read"],
        ["customer_documents", "delete"],
      ].map(([module, action]) => fixtures.ensurePermission(module, action)),
    );
    const role = await fixtures.createRole("documents-full-access", perms.map((p) => p.id));
    const user = await fixtures.createUser("documents-full", UserStatus.ACTIVE, [role.id]);
    return loginHeader(user.email, user.password);
  }

  it("uploads a real PDF, round-trips it through storage, and the checksum matches the actual bytes", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("doc-roundtrip");

    const uploadRes = await request(app.getHttpServer())
      .post("/documents")
      .set("Authorization", authHeader)
      .field("relatedType", "CUSTOMER")
      .field("relatedId", customer.id)
      .field("documentType", "CONTRACT")
      .attach("file", MINIMAL_PDF, { filename: "e2e-verify.pdf", contentType: "application/pdf" });

    expect(uploadRes.status).toBe(201);
    const expectedChecksum = crypto.createHash("sha256").update(MINIMAL_PDF).digest("hex");
    expect(uploadRes.body.checksumSha256).toBe(expectedChecksum);

    // The object is really in storage — not just a DB row claiming it is.
    const exists = await storage.objectExists(uploadRes.body.fileKey);
    expect(exists).toBe(true);

    const signedUrlRes = await request(app.getHttpServer())
      .get(`/documents/${uploadRes.body.id}/signed-url`)
      .set("Authorization", authHeader);
    expect(signedUrlRes.status).toBe(200);
    expect(typeof signedUrlRes.body.url).toBe("string");

    const listRes = await request(app.getHttpServer())
      .get(`/documents?relatedType=CUSTOMER&relatedId=${customer.id}`)
      .set("Authorization", authHeader);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(uploadRes.body.id);
  });

  it("rejects an unsupported MIME type with 415, and does not touch the existing document list", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("doc-mime-reject");

    // Upload one legitimate document first, to prove the rejected attempt
    // below leaves it untouched.
    const goodUpload = await request(app.getHttpServer())
      .post("/documents")
      .set("Authorization", authHeader)
      .field("relatedType", "CUSTOMER")
      .field("relatedId", customer.id)
      .field("documentType", "OTHER")
      .attach("file", MINIMAL_PDF, { filename: "existing.pdf", contentType: "application/pdf" });
    expect(goodUpload.status).toBe(201);

    const rejected = await request(app.getHttpServer())
      .post("/documents")
      .set("Authorization", authHeader)
      .field("relatedType", "CUSTOMER")
      .field("relatedId", customer.id)
      .field("documentType", "OTHER")
      .attach("file", Buffer.from("not a real document"), { filename: "malware.exe", contentType: "application/x-msdownload" });
    expect(rejected.status).toBe(415);

    const listRes = await request(app.getHttpServer())
      .get(`/documents?relatedType=CUSTOMER&relatedId=${customer.id}`)
      .set("Authorization", authHeader);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(goodUpload.body.id);
  });

  it("rejects a file over the 25 MB limit with 413, enforced mid-stream by Multer", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("doc-oversized");
    const oversized = Buffer.alloc(25 * 1024 * 1024 + 1, 0);

    const res = await request(app.getHttpServer())
      .post("/documents")
      .set("Authorization", authHeader)
      .field("relatedType", "CUSTOMER")
      .field("relatedId", customer.id)
      .field("documentType", "OTHER")
      .attach("file", oversized, { filename: "too-big.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(413);
    expect(JSON.stringify(res.body)).not.toContain("Multer");
  }, 20000);

  it("DELETE removes the DB row and the underlying storage object", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("doc-delete");

    const uploadRes = await request(app.getHttpServer())
      .post("/documents")
      .set("Authorization", authHeader)
      .field("relatedType", "CUSTOMER")
      .field("relatedId", customer.id)
      .field("documentType", "OTHER")
      .attach("file", MINIMAL_PDF, { filename: "to-delete.pdf", contentType: "application/pdf" });
    const fileKey = uploadRes.body.fileKey;

    const deleteRes = await request(app.getHttpServer())
      .delete(`/documents/${uploadRes.body.id}`)
      .set("Authorization", authHeader);
    expect(deleteRes.status).toBe(200);

    const stillThere = await prisma.customerDocument.findUnique({ where: { id: uploadRes.body.id } });
    expect(stillThere).toBeNull();

    const objectStillExists = await storage.objectExists(fileKey);
    expect(objectStillExists).toBe(false);

    const auditEntry = await prisma.auditLog.findFirst({ where: { action: "document_deleted", entityId: uploadRes.body.id } });
    expect(auditEntry).not.toBeNull();
  });

  it("rejects an upload whose relatedId doesn't resolve to an existing customer", async () => {
    const authHeader = await fullAccessHeader();
    const res = await request(app.getHttpServer())
      .post("/documents")
      .set("Authorization", authHeader)
      .field("relatedType", "CUSTOMER")
      .field("relatedId", "00000000-0000-0000-0000-000000000000")
      .field("documentType", "OTHER")
      .attach("file", MINIMAL_PDF, { filename: "orphan.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(404);
  });

  it("accepts an upload against an inquiry (Step 3 correction — reused polymorphic infrastructure)", async () => {
    const authHeader = await fullAccessHeader();
    const customer = await fixtures.createCustomer("doc-inquiry-relation");
    const inquiry = await fixtures.createInquiry(customer.id, "doc-relation");

    const uploadRes = await request(app.getHttpServer())
      .post("/documents")
      .set("Authorization", authHeader)
      .field("relatedType", "INQUIRY")
      .field("relatedId", inquiry.id)
      .field("documentType", "PHOTO")
      .attach("file", MINIMAL_PDF, { filename: "e2e-verify-inquiry.pdf", contentType: "application/pdf" });

    expect(uploadRes.status).toBe(201);

    const listRes = await request(app.getHttpServer())
      .get(`/documents?relatedType=INQUIRY&relatedId=${inquiry.id}`)
      .set("Authorization", authHeader);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(uploadRes.body.id);
  });

  it("rejects an upload whose relatedId doesn't resolve to an existing inquiry", async () => {
    const authHeader = await fullAccessHeader();
    const res = await request(app.getHttpServer())
      .post("/documents")
      .set("Authorization", authHeader)
      .field("relatedType", "INQUIRY")
      .field("relatedId", "00000000-0000-0000-0000-000000000000")
      .field("documentType", "OTHER")
      .attach("file", MINIMAL_PDF, { filename: "orphan-inquiry.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(404);
  });

  it("Technician is denied the documents endpoints (no grants yet)", async () => {
    const technicianRole = await fixtures.createRole("documents-technician-like");
    const technician = await fixtures.createUser("documents-tech", UserStatus.ACTIVE, [technicianRole.id]);
    const techHeader = await loginHeader(technician.email, technician.password);

    const res = await request(app.getHttpServer())
      .get("/documents?relatedType=CUSTOMER&relatedId=00000000-0000-0000-0000-000000000000")
      .set("Authorization", techHeader);
    expect(res.status).toBe(403);
  });
});
