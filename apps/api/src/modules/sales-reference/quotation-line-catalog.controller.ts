import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, MinLength, Min } from "class-validator";
import { ReferenceStatus, TaxTreatment } from "@prisma/client";
import { Request } from "express";
import { Permissions } from "../../common/guards/permissions.decorator";
import { QuotationLineCatalogService } from "./quotation-line-catalog.service";

class CreateCatalogItemDto {
  @IsString() @MinLength(1) @MaxLength(255) description!: string;
  @IsOptional() @IsString() specification?: string;
  @IsOptional() @IsString() @MaxLength(100) brand?: string;
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsString() @MinLength(1) @MaxLength(30) unit!: string;
  @IsNumber() @Min(0) unitPriceBeforeVat!: number;
  @IsEnum(TaxTreatment) taxTreatment!: TaxTreatment;
}
class CatalogStatusDto { @IsEnum(ReferenceStatus) status!: ReferenceStatus; }

@Controller("quotation-line-catalog")
export class QuotationLineCatalogController {
  constructor(private readonly catalog: QuotationLineCatalogService) {}

  @Permissions({ module: "quotations", action: "read" })
  @Get()
  list() { return this.catalog.list(true); }

  @Permissions({ module: "system_settings", action: "manage" })
  @Get("all")
  listAll() { return this.catalog.list(false); }

  @Permissions({ module: "system_settings", action: "manage" })
  @Post()
  create(@Body() dto: CreateCatalogItemDto, @Req() req: Request & { user: { userId: string } }) {
    return this.catalog.create(dto, req.user.userId);
  }

  @Permissions({ module: "system_settings", action: "manage" })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: CreateCatalogItemDto, @Req() req: Request & { user: { userId: string } }) {
    return this.catalog.update(id, dto, req.user.userId);
  }

  @Permissions({ module: "system_settings", action: "manage" })
  @Patch(":id/status")
  status(@Param("id") id: string, @Body() dto: CatalogStatusDto, @Req() req: Request & { user: { userId: string } }) {
    return this.catalog.setStatus(id, dto.status, req.user.userId);
  }
}
