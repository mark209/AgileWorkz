import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, vi, it, expect } from "vitest";
import { OutcomeProvider, useOutcome } from "./outcome-provider";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
});
function Action() {
  const { showOutcome } = useOutcome();
  return <button onClick={() => showOutcome({ title: "Report uploaded", reference: "SR-123", description: "Supervisor review is next." })}>Upload</button>;
}
it("shows the actual result across page changes and supports dismissal", () => {
  const view = render(<OutcomeProvider><Action /></OutcomeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  view.rerender(<OutcomeProvider><p>Next page</p></OutcomeProvider>);
  expect(screen.getByRole("dialog", { name: "Report uploaded" })).toHaveTextContent("SR-123");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("dismisses on Escape without losing the original page", () => {
  render(<OutcomeProvider><Action /></OutcomeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Upload" })).toBeInTheDocument();
});
