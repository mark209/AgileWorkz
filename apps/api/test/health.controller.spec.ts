import { Queue } from "bullmq";
import { HealthController } from "../src/health/health.controller";
import { PrismaService } from "../src/prisma/prisma.service";
import { StorageProvider } from "../src/common/storage/storage-provider.interface";
import { mockOf } from "./test-utils";

describe("HealthController", () => {
  afterEach(() => jest.useRealTimers());

  it("returns an unhealthy queue result instead of hanging when Redis is unavailable", async () => {
    jest.useFakeTimers();
    const prisma = mockOf<PrismaService>({ $queryRaw: jest.fn().mockResolvedValue([{ one: 1 }]) });
    const queue = mockOf<Queue>({ client: new Promise(() => undefined) });
    const storage = mockOf<StorageProvider>({
      putObject: jest.fn().mockResolvedValue(undefined),
      objectExists: jest.fn().mockResolvedValue(true),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    });
    const resultPromise = new HealthController(prisma, queue, storage).check();

    await jest.advanceTimersByTimeAsync(3000);

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({
      ok: false,
      database: { ok: true },
      queue: { ok: false, error: "Redis health check timed out" },
      storage: { ok: true },
    }));
  });
});
