import { fireEvent, render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { OutcomeProvider, useOutcome } from "./outcome-provider";

function Action() {
  const { showOutcome } = useOutcome();
  return <button onClick={() => showOutcome({ title: "Report uploaded", reference: "SR-123", description: "Supervisor review is next." })}>Upload</button>;
}

it("keeps a completed outcome visible when its originating page unmounts, and dismisses it", () => {
  const view = render(<OutcomeProvider><Action /></OutcomeProvider>);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  view.rerender(<OutcomeProvider><p>Next page</p></OutcomeProvider>);
  expect(screen.getByRole("dialog", { name: "Report uploaded" })).toHaveTextContent("SR-123");
  expect(screen.getByText("Supervisor review is next.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
