import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LockReportDialog } from "./lock-report-dialog";

// The trigger button and the dialog's own confirm button share the same
// accessible name ("Lock Report") once the dialog is open — scope queries
// to the dialog itself (Radix portals it, but role="dialog" still finds it)
// to avoid an ambiguous multi-match.

describe("LockReportDialog", () => {
  it("shows a permanent-action warning and does not call onLock until confirmed", async () => {
    const onLock = vi.fn().mockResolvedValue(undefined);
    render(<LockReportDialog onLock={onLock} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^lock report$/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/permanent/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(onLock).not.toHaveBeenCalled();
  });

  it("calls onLock only after the dialog's own confirm button is clicked", async () => {
    const onLock = vi.fn().mockResolvedValue(undefined);
    render(<LockReportDialog onLock={onLock} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^lock report$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^lock report$/i }));

    await waitFor(() => expect(onLock).toHaveBeenCalledTimes(1));
  });

  it("cancel closes the dialog without calling onLock", async () => {
    const onLock = vi.fn();
    render(<LockReportDialog onLock={onLock} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^lock report$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(onLock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("surfaces an error message when locking fails", async () => {
    const onLock = vi.fn().mockRejectedValue(new Error("This Service Report is no longer CONFIRMED"));
    render(<LockReportDialog onLock={onLock} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^lock report$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^lock report$/i }));

    expect(await screen.findByText(/no longer CONFIRMED/i)).toBeInTheDocument();
  });
});
