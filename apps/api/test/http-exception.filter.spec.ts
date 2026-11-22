import { ArgumentsHost, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { AllExceptionsFilter } from "../src/common/filters/http-exception.filter";

function filterResponse(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => ({ url: "/auth/login" }) }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status, payload: json.mock.calls[0][0] };
}

describe("AllExceptionsFilter HTTP error metadata", () => {
  it("labels a real rate-limit response as Too Many Requests without changing its status or message", () => {
    const exception = new ThrottlerException();
    const { status, payload } = filterResponse(exception);
    expect(status).toHaveBeenCalledWith(429);
    expect(payload).toMatchObject({ statusCode: 429, error: "Too Many Requests", message: exception.getResponse(), path: "/auth/login" });
  });

  it.each([
    [new UnauthorizedException("Invalid credentials"), 401, "Unauthorized", "Invalid credentials"],
    [new ForbiddenException("Missing permission"), 403, "Forbidden", "Missing permission"],
  ])("preserves existing HTTP error messages and labels", (exception, status, error, message) => {
    expect(filterResponse(exception).payload).toMatchObject({ statusCode: status, error, message });
  });
});
