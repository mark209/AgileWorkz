import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { LocalDiskStorageProvider } from "../src/common/storage/local-disk-storage.provider";

describe("LocalDiskStorageProvider — real filesystem round trip (no live DB/Redis needed)", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agileworks-storage-test-"));
    process.env.STORAGE_LOCAL_ROOT = tmpRoot;
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("writes an object and reports it exists", async () => {
    const provider = new LocalDiskStorageProvider();
    await provider.putObject({ key: "reports/sample.pdf", body: Buffer.from("hello"), contentType: "application/pdf" });

    await expect(provider.objectExists("reports/sample.pdf")).resolves.toBe(true);
    await expect(provider.objectExists("reports/does-not-exist.pdf")).resolves.toBe(false);
  });

  it("issues a signed URL only for an object that exists, and the signature verifies", async () => {
    const provider = new LocalDiskStorageProvider();
    await provider.putObject({ key: "reports/sample.pdf", body: Buffer.from("hello"), contentType: "application/pdf" });

    const url = await provider.getSignedUrl("reports/sample.pdf", { expiresInSeconds: 60 });
    const parsed = new URL(url);
    const expires = Number(parsed.searchParams.get("expires"));
    const sig = parsed.searchParams.get("sig")!;

    expect(provider.verifySignedToken("reports/sample.pdf", expires, sig)).toBe(true);
    expect(provider.verifySignedToken("reports/other.pdf", expires, sig)).toBe(false);
  });

  it("throws for a signed-URL request on a missing object", async () => {
    const provider = new LocalDiskStorageProvider();
    await expect(provider.getSignedUrl("nope.pdf")).rejects.toThrow();
  });

  it("rejects path traversal attempts in the object key", async () => {
    const provider = new LocalDiskStorageProvider();
    await expect(
      provider.putObject({ key: "../../escape.txt", body: Buffer.from("x"), contentType: "text/plain" }),
    ).rejects.toThrow(/Invalid storage key/);
  });

  it("returns the exact bytes written for getObject", async () => {
    const provider = new LocalDiskStorageProvider();
    await provider.putObject({ key: "reports/sample.pdf", body: Buffer.from("hello world"), contentType: "application/pdf" });

    const bytes = await provider.getObject("reports/sample.pdf");
    expect(bytes.toString("utf8")).toBe("hello world");
  });

  it("rejects getObject for a missing object with the same NotFoundException as getSignedUrl", async () => {
    const provider = new LocalDiskStorageProvider();
    await expect(provider.getObject("nope.pdf")).rejects.toThrow(/not found/i);
  });

  it("deletes an object, after which it no longer exists (delete is idempotent)", async () => {
    const provider = new LocalDiskStorageProvider();
    await provider.putObject({ key: "reports/to-delete.pdf", body: Buffer.from("hello"), contentType: "application/pdf" });
    await expect(provider.objectExists("reports/to-delete.pdf")).resolves.toBe(true);

    await provider.deleteObject("reports/to-delete.pdf");
    await expect(provider.objectExists("reports/to-delete.pdf")).resolves.toBe(false);

    // Deleting again must not throw — mirrors S3 DeleteObject semantics.
    await expect(provider.deleteObject("reports/to-delete.pdf")).resolves.toBeUndefined();
  });
});
