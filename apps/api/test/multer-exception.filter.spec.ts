import { ArgumentsHost } from "@nestjs/common";
import { MulterError } from "multer";
import { MulterExceptionFilter } from "../src/modules/documents/multer-exception.filter";

// The real 25 MB rejection is enforced by Multer mid-stream, before a file
// object ever reaches DocumentsService — so it isn't practical to exercise
// with an actual 25 MB fixture at the service-test level. This tests the
// same behavior at the layer where it's actually decided: does a raw
// LIMIT_FILE_SIZE error get turned into a clean, controlled HTTP response
// with no internal details leaked, matching what the approved V1 decision
// requires.
function makeHost(jsonSpy: jest.Mock) {
  const statusSpy = jest.fn().mockReturnValue({ json: jsonSpy });
  const response = { status: statusSpy };
  const request = { url: "/documents" };
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost,
    statusSpy,
  };
}

describe("MulterExceptionFilter — approved 25 MB limit, controlled errors only", () => {
  it("maps LIMIT_FILE_SIZE to a 413 with a clean, non-internal message", () => {
    const jsonSpy = jest.fn();
    const { host, statusSpy } = makeHost(jsonSpy);
    const filter = new MulterExceptionFilter();

    const error = new MulterError("LIMIT_FILE_SIZE", "file");
    filter.catch(error, host);

    expect(statusSpy).toHaveBeenCalledWith(413);
    const body = jsonSpy.mock.calls[0][0];
    expect(body.message).toContain("25 MB");
    // Never the raw Multer error text/stack — only our own controlled message.
    expect(JSON.stringify(body)).not.toContain("Multer");
    expect(body.statusCode).toBe(413);
  });

  it("maps any other Multer error code to a controlled 400, not a raw 500", () => {
    const jsonSpy = jest.fn();
    const { host, statusSpy } = makeHost(jsonSpy);
    const filter = new MulterExceptionFilter();

    const error = new MulterError("LIMIT_UNEXPECTED_FILE", "file");
    filter.catch(error, host);

    expect(statusSpy).toHaveBeenCalledWith(400);
    const body = jsonSpy.mock.calls[0][0];
    expect(body.statusCode).toBe(400);
    expect(typeof body.message).toBe("string");
  });
});
