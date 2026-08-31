import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(await screen.findByText("QT-2026-08-00001")).toBeInTheDocument();
    expect(listQuotationsMock).toHaveBeenCalledWith("token-1", undefined);
  });

  it("passes the ?status= query param straight through to the API call", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("status=PENDING_APPROVAL"));
    listQuotationsMock.mockResolvedValue([quotation({ status: "PENDING_APPROVAL" })]);
    render(<QuotationsListPage />);
    await screen.findByText("QT-2026-08-00001");
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
});
