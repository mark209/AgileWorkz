import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, PayloadTooLargeException } from "@nestjs/common";
import { MulterError } from "multer";
import { AllExceptionsFilter } from "../../common/filters/http-exception.filter";
import { MAX_UPLOAD_BYTES } from "./service-reports.service";

// Same rationale as documents/multer-exception.filter.ts: Multer's own
// limits.fileSize (see ServiceReportsController) rejects an oversized
// upload mid-stream, before the file is fully buffered. Without this
// filter, that rejection would surface as a raw MulterError and become a
// generic, unhelpful 500 via AllExceptionsFilter. Method-scoped to the
// upload route only.
@Catch(MulterError)
export class ServiceReportMulterExceptionFilter implements ExceptionFilter {
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
