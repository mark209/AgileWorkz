import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReferenceSuggestionsPage from "./page";

const { useAuthMock, listSuggestionsMock } = vi.hoisted(() => ({ useAuthMock: vi.fn(), listSuggestionsMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listPendingReferenceSuggestions: listSuggestionsMock };
});

describe("ReferenceSuggestionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ user: { id: "u1" }, accessToken: "token", hasPermission: () => true, isLoading: false });
  });

  it("offers a retry when shared choices fail to load", async () => {
    listSuggestionsMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    render(<ReferenceSuggestionsPage />);
    expect(await screen.findByText("Could not load suggestions.")).toBeInTheDocument();
    expect(screen.queryByText("No choices await review.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No choices await review.")).toBeInTheDocument();
  });
});
