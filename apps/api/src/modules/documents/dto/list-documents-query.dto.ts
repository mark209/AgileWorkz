import { IsEnum, IsString, MinLength } from "class-validator";
import { DocumentRelatedType } from "@prisma/client";

// Matches the approved API surface exactly: GET /documents?relatedType=&relatedId=
// — always scoped to one related entity, no unscoped "list every document" mode.
export class ListDocumentsQueryDto {
  @IsEnum(DocumentRelatedType)
  relatedType!: DocumentRelatedType;

  @IsString()
  @MinLength(1)
  relatedId!: string;
}
