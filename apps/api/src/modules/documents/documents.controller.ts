import { Body, Controller, Delete, Get, Param, Post, Query, Req, UploadedFile, UseFilters, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Request } from "express";
import { DocumentsService, MAX_UPLOAD_BYTES } from "./documents.service";
import { UploadDocumentDto } from "./dto/upload-document.dto";
import { ListDocumentsQueryDto } from "./dto/list-documents-query.dto";
import { MulterExceptionFilter } from "./multer-exception.filter";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) — see customers.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("documents")
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // MAX_UPLOAD_BYTES (25 MB, approved V1 decision — see documents.service.ts)
  // is enforced here at the Multer stream level, not just checked after the
  // fact — an oversized upload is rejected before it's fully buffered.
  // MulterExceptionFilter turns that rejection into a clean 413 instead of a
  // raw 500; MIME-type rejection is a normal HttpException from the service,
  // already handled by the global AllExceptionsFilter with no special casing.
  @Permissions({ module: "customer_documents", action: "upload" })
  @Post()
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
    @Req() req: AuthedRequest,
  ) {
    return this.documentsService.upload(file, dto, actorFrom(req));
  }

  @Permissions({ module: "customer_documents", action: "read" })
  @Get()
  async list(@Query() query: ListDocumentsQueryDto, @Req() req: AuthedRequest) {
    return this.documentsService.list(query.relatedType, query.relatedId, req.user.userId);
  }

  @Permissions({ module: "customer_documents", action: "read" })
  @Get(":id/signed-url")
  async getSignedUrl(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.documentsService.getSignedUrl(id, req.user.userId);
  }

  @Permissions({ module: "customer_documents", action: "delete" })
  @Delete(":id")
  async remove(@Param("id") id: string, @Req() req: AuthedRequest) {
    await this.documentsService.remove(id, actorFrom(req));
    return { deleted: true };
  }
}
