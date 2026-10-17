import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SignupPage from "./page";

const { listDesignationsMock, submitMock } = vi.hoisted(() => ({ listDesignationsMock: vi.fn(), submitMock: vi.fn() }));
vi.mock("@/lib/api", () => ({ listRequestableDesignations: listDesignationsMock, submitRegistration: submitMock }));

describe("web sign up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDesignationsMock.mockResolvedValue([{ id: "manager-id", name: "Manager" }, { id: "tech-id", name: "Technician" }]);
    submitMock.mockResolvedValue({ message: "Registration received" });
  });

  it("shows only requestable designations and explains Admin approval", async () => {
    render(<SignupPage />);
    expect(await screen.findByRole("option", { name: "Technician" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Admin/Owner" })).not.toBeInTheDocument();
    expect(screen.getByText(/super admin makes the final decision/i)).toBeInTheDocument();
  });

  it("submits a request without signing the applicant in", async () => {
    render(<SignupPage />);
    await screen.findByRole("option", { name: "Manager" });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Alex Santos" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "alex@example.com" } });
    fireEvent.change(screen.getByLabelText("Requested designation"), { target: { value: "manager-id" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-long-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a-long-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Submit request" }).closest("form")!);

    await waitFor(() => expect(submitMock).toHaveBeenCalledWith(expect.objectContaining({ requestedRoleId: "manager-id", email: "alex@example.com" })));
    expect(await screen.findByRole("status")).toHaveTextContent(/after the super admin approves/i);
  });

  it("does not send mismatched passwords", async () => {
    render(<SignupPage />);
    await screen.findByRole("option", { name: "Manager" });
    fireEvent.change(screen.getByLabelText("Requested designation"), { target: { value: "manager-id" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-long-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different-long-password" } });
    fireEvent.submit(screen.getByRole("button", { name: "Submit request" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(submitMock).not.toHaveBeenCalled();
  });
});
