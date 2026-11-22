import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuotationRevision } from "@/lib/api/types";
import { LifecycleActionBar } from "./lifecycle-action-bar";
import { ApiError } from "@/lib/api-client";

const { showOutcomeMock, transitionMock, nextMock } = vi.hoisted(() => ({ showOutcomeMock: vi.fn(), transitionMock: vi.fn(), nextMock: vi.fn() }));
vi.mock("@/components/shared/outcome-provider", () => ({ useOutcome: () => ({ showOutcome: showOutcomeMock }) }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), submitRevision: transitionMock, approveRevision: transitionMock, rejectRevision: transitionMock, markRevisionSent: transitionMock, recordRevisionDecision: transitionMock, createNextRevision: nextMock }));

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

describe("LifecycleActionBar", () => {
  beforeEach(() => { vi.clearAllMocks(); useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true }); });
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

  it.each([
    ["DRAFT", "Submit for Approval", "Submit for approval", "PENDING_APPROVAL", "Quotation submitted for approval", /Manager/],
    ["PENDING_APPROVAL", "Approve internal review", "Approve review", "PENDING_OWNER_APPROVAL", "Manager review recorded", /Owner approval is still required/],
    ["PENDING_APPROVAL", "Approve internal review", "Approve review", "APPROVED", "Quotation internally approved", /send.*outside the system/],
    ["PENDING_OWNER_APPROVAL", "Give final approval", "Give final approval", "APPROVED", "Quotation internally approved", /internal approval is complete/],
    ["APPROVED", "Mark as sent", "Mark as sent", "SENT", "Quotation marked as sent", /does not email/],
    ["SENT", "Customer Accepted", "Confirm Accepted", "ACCEPTED", "Customer acceptance recorded", /commercially final/],
    ["PENDING_APPROVAL", "Reject", "Reject", "REJECTED", "Quotation internally rejected", /internal review/],
    ["SENT", "Customer Declined", "Confirm Declined", "DECLINED", "Customer decline recorded", /customer.*declined/i],
  ])("describes the actual %s to %s transition outcome", async (status, button, confirm, returnedStatus, title, description) => {
    transitionMock.mockResolvedValue({ id: "r1", status: returnedStatus });
    const onChanged = vi.fn();
    render(<LifecycleActionBar quotationId="q1" quotationNumber="QT-TEST-1" revision={{ id: "r1", status, termsAndConditions: null } as QuotationRevision} lineItemCount={1} onChanged={onChanged} onConflict={vi.fn()} onNextRevisionCreated={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: button }));
    if (returnedStatus === "REJECTED") await user.type(within(screen.getByRole("dialog")).getByRole("textbox"), "Needs revision");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: confirm }));
    expect(showOutcomeMock).toHaveBeenCalledWith(expect.objectContaining({ title, description: expect.stringMatching(description), reference: "QT-TEST-1" }));
    expect(showOutcomeMock.mock.invocationCallOrder[0]).toBeLessThan(onChanged.mock.invocationCallOrder[0]);
  });

  it("does not report success for a stale approval", async () => {
    transitionMock.mockRejectedValue(new ApiError(409, "Another user acted first"));
    const onConflict = vi.fn();
    render(<LifecycleActionBar quotationId="q1" revision={{ id: "r1", status: "PENDING_APPROVAL" } as QuotationRevision} lineItemCount={1} onChanged={vi.fn()} onConflict={onConflict} onNextRevisionCreated={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Approve internal review" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve review" }));
    expect(onConflict).toHaveBeenCalled();
    expect(showOutcomeMock).not.toHaveBeenCalled();
  });

  it("does not show a major-action outcome for a new draft revision", async () => {
    nextMock.mockResolvedValue({ id: "r2" });
    const onCreated = vi.fn();
    render(<LifecycleActionBar quotationId="q1" revision={{ id: "r1", status: "REJECTED" } as QuotationRevision} lineItemCount={1} onChanged={vi.fn()} onConflict={vi.fn()} onNextRevisionCreated={onCreated} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create New Revision" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create new revision" }));
    expect(onCreated).toHaveBeenCalledWith("r2");
    expect(showOutcomeMock).not.toHaveBeenCalled();
  });
});
