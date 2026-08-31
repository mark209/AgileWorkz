import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  // NestExpressApplication (not the generic INestApplication) so
  // app.set("trust proxy", ...) below is a typed, real Express passthrough.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Never log request/response bodies at the framework level — Service
    // Report documents and credentials could end up in logs otherwise.
    logger: ["log", "warn", "error"],
  });

  app.use(helmet());

  // Phase 7 P0 — trust exactly N reverse-proxy hops (0 = trust none, the
  // Express default, correct with no proxy in front). Deliberately a hop
  // COUNT, not `true` (which would trust an attacker-supplied
  // X-Forwarded-For chain of any length from any direct caller, letting
  // them spoof req.ip merely by sending the header). With
  // TRUST_PROXY_HOPS=1 (the expected single-reverse-proxy pilot/
  // production topology), Express uses the IP the trusted proxy itself
  // appended, ignoring anything a client tried to prepend before that —
  // this is what makes both the login rate limiter (keyed on req.ip) and
  // every audit log's recorded IP correct once actually deployed behind a
  // proxy, instead of every request appearing to share the proxy's own
  // address.
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 0));

  const webOrigin = process.env.WEB_APP_ORIGIN ?? "http://localhost:3000";
  const fieldOrigin = process.env.FIELD_APP_ORIGIN ?? "http://localhost:3002";
  app.enableCors({
    origin: [webOrigin, fieldOrigin],
    credentials: true,
  });

  // Global validation: unknown properties are rejected outright, not silently dropped.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`AgileWorks API listening on :${port}`);
}

bootstrap();
