import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuotationLineCatalogPage from "./page";

const { useAuthMock, listItemsMock, createItemMock } = vi.hoisted(() => ({ useAuthMock: vi.fn(), listItemsMock: vi.fn(), createItemMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listQuotationLineCatalog: listItemsMock, createQuotationLineCatalogItem: createItemMock };
});

describe("QuotationLineCatalogPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ user: { id: "u1" }, accessToken: "token", hasPermission: () => true, isLoading: false });
  });

  it("shows a retry instead of an empty list when loading fails", async () => {
    listItemsMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    render(<QuotationLineCatalogPage />);
    expect(await screen.findByText("Could not load saved line items.")).toBeInTheDocument();
    expect(screen.queryByText("No saved line items yet.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No saved line items yet.")).toBeInTheDocument();
  });

  it("keeps the saved item when an older list request finishes late", async () => {
    let resolveInitial!: (rows: unknown[]) => void;
    listItemsMock.mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValueOnce([{ id: "new", description: "New line", unit: "each", unitPriceBeforeVat: "100", taxTreatment: "VAT_INCLUSIVE", status: "ACTIVE" }]);
    createItemMock.mockResolvedValue({});
    render(<QuotationLineCatalogPage />);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "New line" } });
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "each" } });
    fireEvent.change(screen.getByLabelText("Unit selling price"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Save line item" }));
    expect(await screen.findByText("New line")).toBeInTheDocument();
    await act(async () => { resolveInitial([]); });
    expect(screen.getByText("New line")).toBeInTheDocument();
    expect(screen.queryByText("No saved line items yet.")).not.toBeInTheDocument();
  });
});
