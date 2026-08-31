import { Module } from "@nestjs/common";
import { STORAGE_PROVIDER } from "./storage-provider.interface";
import { LocalDiskStorageProvider } from "./local-disk-storage.provider";
import { S3StorageProvider } from "./s3-storage.provider";
import { LocalStorageController } from "./local-storage.controller";

// STORAGE_PROVIDER env var selects the adapter: "local" (default, dev) or
// "s3" (MinIO locally, a real bucket in production) — no other module
// changes when switching, since both implement the same StorageProvider.
// LocalStorageController/LocalDiskStorageProvider are always registered
// (harmless when STORAGE_PROVIDER=s3 — nothing ever generates a URL
// pointing at this route in that mode, since S3's own getSignedUrl points
// at S3 directly), which keeps this module's shape simple rather than
// conditionally wiring controllers in and out by env var.
@Module({
  controllers: [LocalStorageController],
  providers: [
    LocalDiskStorageProvider,
    {
      provide: STORAGE_PROVIDER,
      useFactory: () =>
        process.env.STORAGE_PROVIDER === "s3" ? new S3StorageProvider() : new LocalDiskStorageProvider(),
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
