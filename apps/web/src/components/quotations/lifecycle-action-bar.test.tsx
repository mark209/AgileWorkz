import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuotationRevision } from "@/lib/api/types";
import { LifecycleActionBar } from "./lifecycle-action-bar";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

describe("LifecycleActionBar", () => {
  it("asks for confirmation before approving an internal review", async () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    render(
      <LifecycleActionBar
        quotationId="q1"
        revision={{ id: "r1", status: "PENDING_APPROVAL", termsAndConditions: null } as QuotationRevision}
        lineItemCount={1}
        onChanged={vi.fn()}
        onConflict={vi.fn()}
        onNextRevisionCreated={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Approve internal review" }));
    expect(screen.getByRole("dialog", { name: "Approve internal review?" })).toBeInTheDocument();
  });

  it("holds draft submission while details have unsaved edits", () => {
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true });
    render(
      <LifecycleActionBar
        quotationId="q1"
        revision={{ id: "r1", status: "DRAFT", termsAndConditions: null } as QuotationRevision}
        lineItemCount={1}
        hasUnsavedDetails
        onChanged={vi.fn()}
        onConflict={vi.fn()}
        onNextRevisionCreated={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Submit for Approval" })).toBeDisabled();
    expect(screen.getByText("Wait for details and commercial terms to save before submitting.")).toBeInTheDocument();
  });

  it("explains why an approved revision with placeholder terms cannot be marked as sent", () => {
    useAuthMock.mockReturnValue({
      accessToken: "token-1",
      hasPermission: () => true,
    });
    const revision = {
      id: "r1",
      status: "APPROVED",
      termsAndConditions: "[PLACEHOLDER] Replace before sending",
    } as QuotationRevision;

    render(
      <LifecycleActionBar
        quotationId="q1"
        revision={revision}
        lineItemCount={1}
        onChanged={vi.fn()}
        onConflict={vi.fn()}
        onNextRevisionCreated={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeDisabled();
    expect(screen.getByText(/create a new revision.*replace the placeholder.*approve it again/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create New Revision" })).toBeEnabled();
  });
});
