import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LoginPage from "./page";
import { ApiError } from "@/lib/api-client";

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ login: loginMock, isLoading: false }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("LoginPage error messages", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [429, "ThrottlerException: Too Many Requests", "Too many sign-in attempts. Please wait a moment and try again."],
    [401, "Invalid credentials", "Invalid credentials"],
    [403, "This account is not approved yet.", "This account is not approved yet."],
  ])("shows the appropriate message for HTTP %s", async (status, message, expected) => {
    loginMock.mockRejectedValue(new ApiError(status, message));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "qa.office@agileworks.local" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "LocalTestPassword!" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
  });
});
