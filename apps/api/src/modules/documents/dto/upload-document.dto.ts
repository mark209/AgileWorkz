import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { DocumentRelatedType, DocumentType } from "@prisma/client";

// The binary file itself arrives via @UploadedFile(), not this DTO — these
// are the multipart/form-data text fields sent alongside it.
export class UploadDocumentDto {
  @IsEnum(DocumentRelatedType)
  relatedType!: DocumentRelatedType;

  @IsString()
  @MinLength(1)
  relatedId!: string;

  @IsEnum(DocumentType)
  documentType!: DocumentType;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
