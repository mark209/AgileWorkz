import { envValidationSchema } from "../src/config/env.validation";

const REQUIRED_BASE = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  JWT_ACCESS_SECRET: "a-secret-at-least-16-chars",
  JWT_REFRESH_SECRET: "another-secret-at-least-16",
  OCR_WORKER_DATABASE_URL: "postgresql://ocr:pass@localhost:5432/db",
};

function validate(env: Record<string, string>) {
  return envValidationSchema.validate({ ...REQUIRED_BASE, ...env }, { allowUnknown: true, abortEarly: false });
}

/**
 * Phase 7 P0 — closes the gap where STORAGE_PROVIDER=s3 could boot with
 * missing S3 credentials (silently falling back to empty strings inside
 * S3StorageProvider) instead of failing fast, unlike the equivalent,
 * already-conditional Vertex AI validation this mirrors.
 */
describe("envValidationSchema — S3 conditional requirement", () => {
  it("STORAGE_PROVIDER=local (the default): no S3 vars required at all", () => {
    const { error } = validate({});
    expect(error).toBeUndefined();
  });

  it("STORAGE_PROVIDER=s3 with no S3 vars set: fails validation", () => {
    const { error } = validate({ STORAGE_PROVIDER: "s3" });
    expect(error).toBeDefined();
    const missing = error!.details.map((d) => d.path[0]);
    expect(missing).toEqual(expect.arrayContaining(["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]));
  });

  it("STORAGE_PROVIDER=s3 with a partial set (missing the secret key): still fails", () => {
    const { error } = validate({
      STORAGE_PROVIDER: "s3",
      S3_ENDPOINT: "https://s3.example.com",
      S3_REGION: "ap-southeast-1",
      S3_BUCKET: "my-bucket",
      S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
    });
    expect(error).toBeDefined();
    expect(error!.details.map((d) => d.path[0])).toEqual(["S3_SECRET_ACCESS_KEY"]);
  });

  it("STORAGE_PROVIDER=s3 with every required S3 var set: passes", () => {
    const { error } = validate({
      STORAGE_PROVIDER: "s3",
      S3_ENDPOINT: "https://s3.example.com",
      S3_REGION: "ap-southeast-1",
      S3_BUCKET: "my-bucket",
      S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
      S3_SECRET_ACCESS_KEY: "supersecret",
    });
    expect(error).toBeUndefined();
  });
});
