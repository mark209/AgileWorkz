import * as Joi from "joi";

// Fails fast at boot if a required secret/config value is missing, instead
// of surfacing a confusing runtime error later (e.g. a silently-undefined
// JWT secret).
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  PORT: Joi.number().default(3001),
  DATABASE_URL: Joi.string().uri().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.string().default("15m"),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_TTL: Joi.string().default("7d"),
  REDIS_URL: Joi.string().uri().default("redis://localhost:6379"),
  STORAGE_PROVIDER: Joi.string().valid("local", "s3").default("local"),
  STORAGE_LOCAL_ROOT: Joi.string().default("./storage-local"),
  // Phase 7 P0 — required only when STORAGE_PROVIDER=s3, same conditional
  // pattern already used for the Vertex AI vars below. Before this, a
  // deploy with STORAGE_PROVIDER=s3 and a missing credential booted
  // "successfully" (S3StorageProvider falls back to an empty string) and
  // only failed at the first real upload, with a cryptic AWS SDK auth
  // error instead of a clear boot-time failure.
  S3_ENDPOINT: Joi.string().uri().when("STORAGE_PROVIDER", { is: "s3", then: Joi.required(), otherwise: Joi.optional() }),
  S3_REGION: Joi.string().when("STORAGE_PROVIDER", { is: "s3", then: Joi.required(), otherwise: Joi.optional() }),
  S3_BUCKET: Joi.string().when("STORAGE_PROVIDER", { is: "s3", then: Joi.required(), otherwise: Joi.optional() }),
  S3_ACCESS_KEY_ID: Joi.string().when("STORAGE_PROVIDER", { is: "s3", then: Joi.required(), otherwise: Joi.optional() }),
  S3_SECRET_ACCESS_KEY: Joi.string().when("STORAGE_PROVIDER", {
    is: "s3",
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  EXTRACTION_PROVIDER: Joi.string().valid("stub", "vertex-gemini").default("stub"),
  // Required only when EXTRACTION_PROVIDER=vertex-gemini. Presence/shape
  // only — the "must be a locational, not global, endpoint" rule and the
  // "model ID is never defaulted" rule live in extraction-config.ts
  // (loadVertexGeminiConfig), which the provider factory calls at boot.
  VERTEX_AI_PROJECT_ID: Joi.string().when("EXTRACTION_PROVIDER", {
    is: "vertex-gemini",
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  VERTEX_AI_REGION: Joi.string()
    .invalid("global")
    .when("EXTRACTION_PROVIDER", { is: "vertex-gemini", then: Joi.required(), otherwise: Joi.optional() }),
  VERTEX_AI_MODEL_ID: Joi.string().when("EXTRACTION_PROVIDER", {
    is: "vertex-gemini",
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  // The ocr_worker-credentialed connection used only by the extraction
  // queue processor's staging writes (docs/architecture/ocr-worker-db-
  // isolation.md). Required unconditionally, not gated on EXTRACTION_
  // PROVIDER — the queue processor and its Prisma client are wired up
  // regardless of which provider adapter is active.
  OCR_WORKER_DATABASE_URL: Joi.string().uri().required(),
  WEB_APP_ORIGIN: Joi.string().uri().default("http://localhost:3000"),
  FIELD_APP_ORIGIN: Joi.string().uri().default("http://localhost:3002"),
}).unknown(true);
