import { ArrayMinSize, IsArray, IsString } from "class-validator";

// The complete new ordering, expressed as section IDs in their desired
// order — the server assigns sort_order 0, 10, 20, ... by position, the
// same increment convention already used by every seeded reference table.
export class ReorderSectionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  sectionIds!: string[];
}
