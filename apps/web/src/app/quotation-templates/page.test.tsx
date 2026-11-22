import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuotationTemplatesPage from "./page";

const { useAuthMock, listTemplatesMock, createTemplateMock } = vi.hoisted(() => ({ useAuthMock: vi.fn(), listTemplatesMock: vi.fn(), createTemplateMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, listQuotationTemplates: listTemplatesMock, createQuotationTemplate: createTemplateMock };
});

describe("QuotationTemplatesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ user: { id: "u1" }, accessToken: "token", hasPermission: () => true, isLoading: false });
  });

  it("waits for templates before warning that the official default is missing", async () => {
    let resolveTemplates!: (value: unknown[]) => void;
    listTemplatesMock.mockReturnValue(new Promise((resolve) => { resolveTemplates = resolve; }));
    render(<QuotationTemplatesPage />);
    expect(screen.getByText("Loading templates…")).toBeInTheDocument();
    expect(screen.queryByText(/No official default has been saved yet/)).not.toBeInTheDocument();
    resolveTemplates([{ id: "t1", name: "Default", body: "Approved terms", status: "ACTIVE", isDefault: true, quotationType: null, tradeCode: null }]);
    expect(await screen.findByText("Default")).toBeInTheDocument();
    expect(screen.queryByText(/No official default has been saved yet/)).not.toBeInTheDocument();
  });

  it("offers a retry when templates fail to load", async () => {
    listTemplatesMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    render(<QuotationTemplatesPage />);
    expect(await screen.findByText("Could not load templates.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No templates available.")).toBeInTheDocument();
  });

  it("keeps the refreshed list when the initial request finishes late", async () => {
    let resolveInitial!: (rows: unknown[]) => void;
    listTemplatesMock.mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValueOnce([{ id: "new", name: "New terms", body: "Approved terms", status: "ACTIVE", isDefault: true, quotationType: null, tradeCode: null }]);
    createTemplateMock.mockResolvedValue({});
    render(<QuotationTemplatesPage />);
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "New terms" } });
    fireEvent.change(screen.getByLabelText("Terms & Conditions"), { target: { value: "Approved terms" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as official default" }));
    expect(await screen.findByText("New terms")).toBeInTheDocument();
    await act(async () => { resolveInitial([]); });
    expect(screen.getByText("New terms")).toBeInTheDocument();
    expect(screen.queryByText("No templates available.")).not.toBeInTheDocument();
  });
});
