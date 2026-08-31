import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, PayloadTooLargeException } from "@nestjs/common";
import { MulterError } from "multer";
import { AllExceptionsFilter } from "../../common/filters/http-exception.filter";
import { MAX_UPLOAD_BYTES } from "./documents.service";

// Multer's own `limits.fileSize` (see DocumentsController) rejects an
// oversized upload mid-stream, before the file is fully buffered — a real
// resource-safety measure, not just a post-hoc check. That rejection surfaces
// as a raw MulterError, which would otherwise reach AllExceptionsFilter as an
// unrecognized Error and become a generic, unhelpful 500. This filter is
// method-scoped to the upload route only (see @UseFilters on
// DocumentsController.upload) and translates the specific Multer error codes
// worth distinguishing into proper HttpExceptions, then delegates to
// AllExceptionsFilter for the actual response formatting — one consistent
// error shape across the whole API, not a second bespoke one.
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  private readonly delegate = new AllExceptionsFilter();

  catch(exception: MulterError, host: ArgumentsHost): void {
    const mapped =
      exception.code === "LIMIT_FILE_SIZE"
        ? new PayloadTooLargeException(
            `File exceeds the maximum upload size of ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`,
          )
        : new BadRequestException(`Upload rejected: ${exception.code}`);

    this.delegate.catch(mapped, host);
  }
}
