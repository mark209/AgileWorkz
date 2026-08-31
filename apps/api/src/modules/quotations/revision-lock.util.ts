import { BadRequestException } from "@nestjs/common";
import { QuotationRevisionStatus } from "@prisma/client";

/**
 * Approved plan §05 / Decision 2: a revision is editable — sections, line
 * items, maintenance details, T&C items, and the revision's own free-text
 * fields — only while its own status is DRAFT. Shared by every Step 6
 * service that mutates revision content, so the rule is enforced identically
 * everywhere rather than re-implemented per entity.
 */
export function assertRevisionEditable(revision: { status: QuotationRevisionStatus }): void {
  if (revision.status !== QuotationRevisionStatus.DRAFT) {
    throw new BadRequestException(
      `This revision is ${revision.status}, not DRAFT — its content is locked. Create a new revision to make further changes.`,
    );
  }
}
