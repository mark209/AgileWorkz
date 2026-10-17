import { Controller, Get, Inject } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { STORAGE_PROVIDER, StorageProvider } from "../common/storage/storage-provider.interface";
import { Public } from "../common/guards/public.decorator";

interface ComponentStatus {
  ok: boolean;
  error?: string;
}

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("health-check") private readonly healthQueue: Queue,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  @Public()
  @Get()
  async check() {
    const [database, queue, storage] = await Promise.all([
      this.checkDatabase(),
      this.checkQueue(),
      this.checkStorage(),
    ]);

    const ok = database.ok && queue.ok && storage.ok;
    return { ok, database, queue, storage, timestamp: new Date().toISOString() };
  }

  private async checkDatabase(): Promise<ComponentStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async checkQueue(): Promise<ComponentStatus> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          // BullMQ's client type doesn't surface ioredis's `ping`.
          const client = (await this.healthQueue.client) as unknown as { ping(): Promise<string> };
          await client.ping();
        })(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Redis health check timed out")), 3000);
        }),
      ]);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async checkStorage(): Promise<ComponentStatus> {
    const probeKey = `__health__/${Date.now()}.txt`;
    try {
      await this.storage.putObject({ key: probeKey, body: Buffer.from("ok"), contentType: "text/plain" });
      const exists = await this.storage.objectExists(probeKey);
      return { ok: exists };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    } finally {
      await this.storage.deleteObject(probeKey).catch(() => undefined);
    }
  }
}
