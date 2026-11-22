import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ActionConfirmDialog } from "./action-confirm-dialog";

describe("ActionConfirmDialog", () => {
  it("clears a submitted reason when its parent closes the dialog", () => {
    const props = { open: true, onOpenChange: vi.fn(), title: "Reject quotation", description: "Record the reason.", reasonMode: "required" as const, confirmLabel: "Reject", submitting: false, error: null, onConfirm: vi.fn() };
    const { rerender } = render(<ActionConfirmDialog {...props} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "Wrong price" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(props.onConfirm).toHaveBeenCalledWith("Wrong price");

    rerender(<ActionConfirmDialog {...props} open={false} />);
    rerender(<ActionConfirmDialog {...props} />);
    expect(screen.getByRole("textbox", { name: "Reason" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });
});
