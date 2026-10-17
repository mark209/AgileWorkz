import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MembersPage from "./page";

const { useAuthMock, listMembersMock, listRolesMock, listPendingMock, approveMock, declineMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(), listMembersMock: vi.fn(), listRolesMock: vi.fn(), listPendingMock: vi.fn(), approveMock: vi.fn(), declineMock: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/api", () => ({
  listMembers: listMembersMock, listMemberRoles: listRolesMock, listPendingRegistrations: listPendingMock,
  approveRegistration: approveMock, declineRegistration: declineMock,
  createMember: vi.fn(), assignMemberRole: vi.fn(), revokeMemberRole: vi.fn(), setMemberStatus: vi.fn(),
}));

describe("registration review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      user: { roles: ["Admin/Owner"] }, accessToken: "admin-token", isLoading: false,
      hasPermission: (module: string, action: string) => module === "users" && action === "manage",
    });
    listMembersMock.mockResolvedValue([]);
    listRolesMock.mockResolvedValue([{ id: "manager-id", name: "Manager" }, { id: "tech-id", name: "Technician" }]);
    listPendingMock.mockResolvedValue([{ id: "request-1", fullName: "Alex Santos", email: "alex@example.com", phone: null, createdAt: "2026-10-16T00:00:00Z", requestedRole: { id: "manager-id", name: "Manager" } }]);
    approveMock.mockResolvedValue({ id: "user-1" });
    declineMock.mockResolvedValue({ declined: true });
  });

  it("requires Admin to choose a final role before approval", async () => {
    render(<MembersPage />);
    expect(await screen.findByText("Alex Santos")).toBeInTheDocument();
    const approveButton = screen.getByRole("button", { name: "Approve" });
    expect(approveButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Final role"), { target: { value: "tech-id" } });
    expect(approveButton).toBeEnabled();
    fireEvent.click(approveButton);
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith("admin-token", "request-1", "tech-id"));
  });

  it("does not fetch requests for a non-Admin account", () => {
    useAuthMock.mockReturnValue({
      user: { roles: ["Manager"] }, accessToken: "manager-token", isLoading: false,
      hasPermission: () => true,
    });
    render(<MembersPage />);
    expect(screen.getByText(/do not have permission to manage members/i)).toBeInTheDocument();
    expect(listPendingMock).not.toHaveBeenCalled();
  });
});
