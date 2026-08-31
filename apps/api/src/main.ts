import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Never log request/response bodies at the framework level — Service
    // Report documents and credentials could end up in logs otherwise.
    logger: ["log", "warn", "error"],
  });

  app.use(helmet());

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
