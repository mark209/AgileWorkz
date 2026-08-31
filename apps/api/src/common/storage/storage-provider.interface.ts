export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface SignedUrlOptions {
  /** Seconds until the signed URL expires. Kept short — these are private documents. */
  expiresInSeconds?: number;
}

/**
 * Contract every storage backend implements. Deliberately has no
 * "getPublicUrl" method anywhere in this interface — there is no code path
 * to make an uploaded Service Report (or any other object) publicly
 * reachable, by construction, regardless of which adapter is active.
 *
 * Phase 1 ships a LocalDiskStorageProvider for development. An S3-compatible
 * adapter (MinIO locally, a real bucket in production) is a drop-in later
 * behind this same interface — no other module needs to change.
 */
export interface StorageProvider {
  putObject(input: PutObjectInput): Promise<{ key: string }>;
  getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  objectExists(key: string): Promise<boolean>;
  deleteObject(key: string): Promise<void>;
  /**
   * Raw bytes for server-side use only (e.g. the extraction queue processor
   * feeding a document to an AI provider) — never exposed to a browser
   * client, which always goes through getSignedUrl instead. Throws if the
   * object does not exist, matching getSignedUrl's existing behavior.
   */
  getObject(key: string): Promise<Buffer>;
}

export const STORAGE_PROVIDER = Symbol("STORAGE_PROVIDER");
