import { Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import * as crypto from "node:crypto";
import { PutObjectInput, SignedUrlOptions, StorageProvider } from "./storage-provider.interface";

/**
 * S3-compatible adapter — works against MinIO locally (STORAGE_PROVIDER=s3,
 * S3_ENDPOINT pointing at MinIO) and against a real bucket in production
 * with no code change, only env config. Implements the exact same
 * StorageProvider contract as LocalDiskStorageProvider; no consumer of the
 * interface needs to know which adapter is active.
 *
 * Still no "getPublicUrl" method anywhere — signed URLs only.
 */
@Injectable()
export class S3StorageProvider implements StorageProvider, OnModuleInit {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? "agileworks-documents";
    this.client = new S3Client({
      region: process.env.S3_REGION ?? "ap-southeast-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true, // required for MinIO; harmless against real S3
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }

  async onModuleInit(): Promise<void> {
    // Dev convenience only: MinIO doesn't auto-create buckets. A real
    // production bucket is provisioned out-of-band, not by the app; this
    // is a no-op there (CreateBucket on an existing bucket you own is
    // treated as success/ignored below).
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created bucket "${this.bucket}"`);
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") {
        return;
      }
      this.logger.warn(`Could not ensure bucket "${this.bucket}" exists: ${(e as Error).message}`);
    }
  }

  async putObject(input: PutObjectInput): Promise<{ key: string }> {
    const checksumSha256 = crypto.createHash("sha256").update(input.body).digest("hex");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: { "sha256-checksum": checksumSha256 },
      }),
    );
    return { key: input.key };
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string> {
    const exists = await this.objectExists(key);
    if (!exists) {
      throw new NotFoundException(`Object not found: ${key}`);
    }
    return presign(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: options?.expiresInSeconds ?? 300,
    });
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /** Exposed for the verification procedure — not part of the StorageProvider interface. */
  async getObjectChecksum(key: string): Promise<string | undefined> {
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return head.Metadata?.["sha256-checksum"];
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async getObject(key: string): Promise<Buffer> {
    const exists = await this.objectExists(key);
    if (!exists) {
      throw new NotFoundException(`Object not found: ${key}`);
    }
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
}
