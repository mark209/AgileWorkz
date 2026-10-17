import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SignupPage from "./page";

const { listDesignationsMock, submitMock } = vi.hoisted(() => ({ listDesignationsMock: vi.fn(), submitMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ listRequestableDesignations: listDesignationsMock, submitRegistration: submitMock }));

describe("field sign up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDesignationsMock.mockResolvedValue([{ id: "tech-id", name: "Technician" }]);
    submitMock.mockResolvedValue({ message: "Registration received" });
  });

  it("submits a Technician request and waits for Super Admin approval", async () => {
    render(<SignupPage />);
    await screen.findByRole("option", { name: "Technician" });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Alex Santos" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "alex@example.com" } });
    fireEvent.change(screen.getByLabelText("Requested designation"), { target: { value: "tech-id" } });
    fireEvent.change(screen.getByLabelText("Password (at least 12 characters)"), { target: { value: "a-long-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a-long-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Submit request" }).closest("form")!);

    await waitFor(() => expect(submitMock).toHaveBeenCalledWith(expect.objectContaining({ requestedRoleId: "tech-id" })));
    expect(await screen.findByRole("status")).toHaveTextContent(/after the super admin approves/i);
  });
});
