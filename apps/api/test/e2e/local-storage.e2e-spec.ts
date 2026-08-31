import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/http-exception.filter";
import { STORAGE_PROVIDER } from "../../src/common/storage/storage-provider.interface";
import { LocalDiskStorageProvider } from "../../src/common/storage/local-disk-storage.provider";
import { E2E_PREFIX } from "./support";

/**
 * Live E2E — Phase 5 Step 5's storage-resolver route
 * (LocalStorageController). This environment's own STORAGE_PROVIDER is
 * "s3" (a real MinIO instance), so this file explicitly overrides
 * STORAGE_PROVIDER to LocalDiskStorageProvider — same overrideProvider
 * pattern as service-report-extraction.e2e-spec.ts uses for
 * EXTRACTION_PROVIDER — to actually exercise the code path this route
 * exists for, regardless of which provider is active by default. This is
 * the ONLY @Public() (no JWT, no permission) route added for Step 5, since
 * an <img>/<iframe> tag has no way to attach an Authorization header — the
 * signature + expiry embedded in the URL are the entire access control, so
 * this file specifically exercises that they're actually enforced.
 */
describe("Local storage resolver (live)", () => {
  let app: INestApplication;
  let storage: LocalDiskStorageProvider;

  beforeAll(async () => {
    const localDisk = new LocalDiskStorageProvider();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_PROVIDER)
      .useValue(localDisk)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    storage = localDisk;
  });

  afterAll(async () => {
    await app.close();
  });

  it("streams the object for a valid, freshly-issued signed URL, with no Authorization header at all", async () => {
    const key = `${E2E_PREFIX}/local-storage/${Date.now()}.jpg`;
    await storage.putObject({ key, body: Buffer.from("fake jpeg bytes"), contentType: "image/jpeg" });
    const signedUrl = await storage.getSignedUrl(key);
    const path = signedUrl.replace(/^https?:\/\/[^/]+/, ""); // strip the http://localhost:PORT prefix — supertest hits the test app directly

    const res = await request(app.getHttpServer()).get(path); // deliberately no .set("Authorization", ...)
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.isBuffer(res.body) ? res.body.toString() : res.text).toBe("fake jpeg bytes");

    await storage.deleteObject(key);
  });

  it("streams a key with multiple path segments correctly (real storage keys always have these)", async () => {
    const key = `${E2E_PREFIX}/local-storage/nested/deeper/${Date.now()}.png`;
    await storage.putObject({ key, body: Buffer.from("nested bytes"), contentType: "image/png" });
    const signedUrl = await storage.getSignedUrl(key);
    const path = signedUrl.replace(/^https?:\/\/[^/]+/, "");

    const res = await request(app.getHttpServer()).get(path);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");

    await storage.deleteObject(key);
  });

  it("rejects a tampered signature with 403, not 500", async () => {
    const key = `${E2E_PREFIX}/local-storage/${Date.now()}-tampered.jpg`;
    await storage.putObject({ key, body: Buffer.from("fake jpeg bytes"), contentType: "image/jpeg" });
    const signedUrl = await storage.getSignedUrl(key);
    const path = signedUrl.replace(/^https?:\/\/[^/]+/, "").replace(/sig=[0-9a-f]+/, "sig=deadbeef");

    const res = await request(app.getHttpServer()).get(path);
    expect(res.status).toBe(403);

    await storage.deleteObject(key);
  });

  it("rejects a malformed (wrong-length) signature with 403, not a crash", async () => {
    const key = `${E2E_PREFIX}/local-storage/${Date.now()}-malformed.jpg`;
    await storage.putObject({ key, body: Buffer.from("fake jpeg bytes"), contentType: "image/jpeg" });
    const signedUrl = await storage.getSignedUrl(key);
    const path = signedUrl.replace(/^https?:\/\/[^/]+/, "").replace(/sig=[0-9a-f]+/, "sig=ab"); // crypto.timingSafeEqual would throw on a length mismatch if unguarded

    const res = await request(app.getHttpServer()).get(path);
    expect(res.status).toBe(403);

    await storage.deleteObject(key);
  });

  it("rejects an expired signed URL with 403", async () => {
    const key = `${E2E_PREFIX}/local-storage/${Date.now()}-expired.jpg`;
    await storage.putObject({ key, body: Buffer.from("fake jpeg bytes"), contentType: "image/jpeg" });
    // expiresInSeconds: -1 -> already expired the instant it's issued
    const signedUrl = await storage.getSignedUrl(key, { expiresInSeconds: -1 });
    const path = signedUrl.replace(/^https?:\/\/[^/]+/, "");

    const res = await request(app.getHttpServer()).get(path);
    expect(res.status).toBe(403);

    await storage.deleteObject(key);
  });

  it("rejects a request for a key that was never signed for", async () => {
    const key = `${E2E_PREFIX}/local-storage/${Date.now()}-real.jpg`;
    const otherKey = `${E2E_PREFIX}/local-storage/${Date.now()}-other.jpg`;
    await storage.putObject({ key, body: Buffer.from("real"), contentType: "image/jpeg" });
    await storage.putObject({ key: otherKey, body: Buffer.from("other"), contentType: "image/jpeg" });
    const signedUrl = await storage.getSignedUrl(key);
    const path = signedUrl.replace(/^https?:\/\/[^/]+/, "").replace(key, otherKey);

    const res = await request(app.getHttpServer()).get(path);
    expect(res.status).toBe(403);

    await storage.deleteObject(key);
    await storage.deleteObject(otherKey);
  });
});
