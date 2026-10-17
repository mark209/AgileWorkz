import { Module } from "@nestjs/common";
import { DocumentsService } from "./documents.service";
import { DocumentsController } from "./documents.controller";
import { AuditModule } from "../audit/audit.module";
import { StorageModule } from "../../common/storage/storage.module";
import { IdentityModule } from "../identity/identity.module";

@Module({
  imports: [AuditModule, StorageModule, IdentityModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
