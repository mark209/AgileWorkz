import { Injectable, NotFoundException } from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { PutObjectInput, SignedUrlOptions, StorageProvider } from "./storage-provider.interface";

/**
 * Development-only adapter: writes to a local directory and issues a
 * short-lived, HMAC-signed token in place of a real signed URL. Nothing here
 * is exposed as a public path — retrieval always goes through the app,
 * which validates the token before streaming the file.
 *
 * Not intended for production use; the S3-compatible adapter is the
 * production target and implements the same interface.
 */
@Injectable()
export class LocalDiskStorageProvider implements StorageProvider {
  private readonly root: string;
  private readonly secret: string;

  constructor() {
    this.root = path.resolve(process.env.STORAGE_LOCAL_ROOT ?? "./storage-local");
    this.secret = process.env.JWT_ACCESS_SECRET ?? "dev-only-local-storage-secret";
  }

  async putObject(input: PutObjectInput): Promise<{ key: string }> {
    const fullPath = this.resolveSafe(input.key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, input.body);
    return { key: input.key };
  }

  // Phase 5 Step 5 — returns a real, browser-fetchable URL pointing at
  // LocalStorageController (same module), which validates this exact
  // token via verifySignedToken() below before streaming the file. Not a
  // production concern: the S3 adapter's own getSignedUrl already returns
  // a directly-fetchable, provider-signed HTTPS URL, so this dev-only
  // resolver route is never involved when STORAGE_PROVIDER=s3.
  async getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string> {
    const exists = await this.objectExists(key);
    if (!exists) {
      throw new NotFoundException(`Object not found: ${key}`);
    }
    const expiresInSeconds = options?.expiresInSeconds ?? 300;
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    const token = this.sign(key, expiresAt);
    const base = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3001}`;
    // Encode each path segment separately (never the whole key as one
    // encodeURIComponent call) — an encoded slash (%2F) inside a single
    // path segment gets decoded ahead of Express's router in a way that
    // breaks matching against a single-segment :param, turning every
    // request into a 404. Real "/" separators plus a wildcard route
    // (LocalStorageController) avoid that pitfall entirely.
    const encodedPath = key.split("/").map(encodeURIComponent).join("/");
    return `${base}/storage/local/${encodedPath}?expires=${expiresAt}&sig=${token}`;
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveSafe(key));
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await fs.rm(this.resolveSafe(key), { force: true });
  }

  async getObject(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.resolveSafe(key));
    } catch {
      throw new NotFoundException(`Object not found: ${key}`);
    }
  }

  verifySignedToken(key: string, expiresAt: number, token: string): boolean {
    if (Date.now() > expiresAt) return false;
    const expected = this.sign(key, expiresAt);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  }

  private sign(key: string, expiresAt: number): string {
    return crypto.createHmac("sha256", this.secret).update(`${key}:${expiresAt}`).digest("hex");
  }

  private resolveSafe(key: string): string {
    // Reject path traversal outside the storage root.
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return target;
  }
}
