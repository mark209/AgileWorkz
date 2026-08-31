import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthenticatedUser } from "@agileworks/shared-types";
import { AuthProvider, useAuth } from "./auth-context";
import { apiRequest } from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-client")>();
  return { ...actual, apiRequest: vi.fn() };
});

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: "u1",
    fullName: "Jordan Lee",
    email: "jordan@example.com",
    status: "ACTIVE",
    roles: ["Technician"],
    permissions: [
      { module: "work_orders", action: "read_own" },
      { module: "work_orders", action: "start_own" },
    ],
    ...overrides,
  };
}

function Probe() {
  const { user: current, hasPermission, login } = useAuth();
  return (
    <div>
      <button onClick={() => login("jordan@example.com", "pw")}>login</button>
      <span data-testid="user">{current?.fullName ?? "none"}</span>
      <span data-testid="start-own">{String(hasPermission("work_orders", "start_own"))}</span>
      <span data-testid="assign">{String(hasPermission("work_orders", "assign"))}</span>
    </div>
  );
}

describe("hasPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false for every permission before login (no user yet)", () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("start-own").textContent).toBe("false");
    expect(screen.getByTestId("assign").textContent).toBe("false");
  });

  it("reflects the logged-in user's own permissions exactly — true for a held grant, false for one not granted", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ accessToken: "token-1", refreshToken: "refresh-1", user: user() });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    const clickUser = userEvent.setup();
    await clickUser.click(screen.getByText("login"));

    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("Jordan Lee"));
    expect(screen.getByTestId("start-own").textContent).toBe("true");
    expect(screen.getByTestId("assign").textContent).toBe("false");
  });
});
