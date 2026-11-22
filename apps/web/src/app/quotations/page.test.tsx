import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Quotation } from "@/lib/api/types";
import QuotationsListPage from "./page";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { useSearchParamsMock } = vi.hoisted(() => ({ useSearchParamsMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: useSearchParamsMock,
}));

const { listQuotationsMock } = vi.hoisted(() => ({ listQuotationsMock: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listQuotations: listQuotationsMock };
});

function quotation(overrides: Partial<Quotation> = {}): Quotation {
  return {
    id: "q1",
    inquiryId: null,
    customerId: "c1",
    siteId: "s1",
    quotationNumber: "QT-2026-08-00001",
    quotationType: "REPAIR",
    primaryTradeCode: "HVAC",
    customerReferenceNo: null,
    status: "DRAFT",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("QuotationsListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true, isLoading: false });
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
  });

  it("shows an access-denied message when the caller lacks quotations.read", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => false, isLoading: false });
    render(<QuotationsListPage />);
    expect(await screen.findByText(/do not have permission to view quotations/i)).toBeInTheDocument();
    expect(listQuotationsMock).not.toHaveBeenCalled();
  });

  it("loads with no status filter by default", async () => {
    listQuotationsMock.mockResolvedValue([quotation()]);
    render(<QuotationsListPage />);
    expect(await screen.findByRole("link", { name: "QT-2026-08-00001" })).toBeInTheDocument();
    expect(listQuotationsMock).toHaveBeenCalledWith("token-1", undefined);
  });

  it("passes the ?status= query param straight through to the API call", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("status=PENDING_APPROVAL"));
    listQuotationsMock.mockResolvedValue([quotation({ status: "PENDING_APPROVAL" })]);
    render(<QuotationsListPage />);
    await screen.findByRole("link", { name: "QT-2026-08-00001" });
    expect(listQuotationsMock).toHaveBeenCalledWith("token-1", "PENDING_APPROVAL");
  });

  it("shows an empty state when no quotations match", async () => {
    listQuotationsMock.mockResolvedValue([]);
    render(<QuotationsListPage />);
    expect(await screen.findByText(/no quotations found/i)).toBeInTheDocument();
  });

  it("links each row to its detail page", async () => {
    listQuotationsMock.mockResolvedValue([quotation()]);
    render(<QuotationsListPage />);
    const link = await screen.findByRole("link", { name: /view →/i });
    expect(link).toHaveAttribute("href", "/quotations/q1");
  });

  it("shows and searches the customer name", async () => {
    listQuotationsMock.mockResolvedValue([quotation({ customer: { name: "Role Access" } })]);
    render(<QuotationsListPage />);
    expect(await screen.findByText("Role Access")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search quotations" }), { target: { value: "Role Access" } });
    expect(screen.getByRole("link", { name: "QT-2026-08-00001" })).toBeInTheDocument();
  });

  it("hides previous rows while a new status filter loads", async () => {
    listQuotationsMock.mockResolvedValueOnce([quotation({ status: "PENDING_APPROVAL" })]);
    const view = render(<QuotationsListPage />);
    expect(await screen.findByRole("link", { name: "QT-2026-08-00001" })).toBeInTheDocument();

    listQuotationsMock.mockReturnValueOnce(new Promise(() => {}));
    useSearchParamsMock.mockReturnValue(new URLSearchParams("status=SENT"));
    view.rerender(<QuotationsListPage />);
    await waitFor(() => expect(listQuotationsMock).toHaveBeenCalledWith("token-1", "SENT"));
    expect(screen.queryByRole("link", { name: "QT-2026-08-00001" })).not.toBeInTheDocument();
  });
});
