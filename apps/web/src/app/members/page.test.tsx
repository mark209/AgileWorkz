import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MembersPage from "./page";

const { useAuthMock, listMembersMock, listRolesMock, listPendingMock, createMock, assignMock, revokeMock, statusMock, approveMock, declineMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(), listMembersMock: vi.fn(), listRolesMock: vi.fn(), listPendingMock: vi.fn(),
  createMock: vi.fn(), assignMock: vi.fn(), revokeMock: vi.fn(), statusMock: vi.fn(), approveMock: vi.fn(), declineMock: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/api", () => ({
  listMembers: listMembersMock, listMemberRoles: listRolesMock, listPendingRegistrations: listPendingMock,
  approveRegistration: approveMock, declineRegistration: declineMock, createMember: createMock,
  assignMemberRole: assignMock, revokeMemberRole: revokeMock, setMemberStatus: statusMock,
}));

const owner = { id: "owner-1", fullName: "Alex Owner", email: "alex@example.com", phone: null, status: "ACTIVE", userRoles: [{ role: { id: "owner-role", name: "Admin/Owner" } }] };
const manager = { id: "manager-1", fullName: "Blair Manager", email: "blair@example.com", phone: null, status: "INACTIVE", userRoles: [{ role: { id: "manager-role", name: "Manager" } }] };

describe("member management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      user: { roles: ["Admin/Owner"] }, accessToken: "admin-token", isLoading: false,
      hasPermission: (module: string, action: string) => module === "users" && action === "manage",
    });
    listMembersMock.mockResolvedValue([]);
    listRolesMock.mockResolvedValue([{ id: "owner-role", name: "Admin/Owner" }, { id: "manager-role", name: "Manager" }, { id: "tech-role", name: "Technician" }]);
    listPendingMock.mockResolvedValue([{ id: "request-1", fullName: "Alex Santos", email: "santos@example.com", phone: null, createdAt: "2026-10-16T00:00:00Z", requestedRole: { id: "manager-role", name: "Manager" } }]);
    createMock.mockResolvedValue({ id: "new-1" });
    assignMock.mockResolvedValue({ assigned: true });
    revokeMock.mockResolvedValue({ revoked: true });
    statusMock.mockResolvedValue({ ...owner, status: "INACTIVE" });
    approveMock.mockResolvedValue({ id: "new-1" });
    declineMock.mockResolvedValue({ declined: true });
  });

  it("searches names and email, filters roles and status, and shows multiple roles", async () => {
    listMembersMock.mockResolvedValue([owner, { ...manager, userRoles: [...manager.userRoles, { role: { id: "tech-role", name: "Technician" } }] }]);
    render(<MembersPage />);
    expect(await screen.findByText("Alex Owner")).toBeInTheDocument();
    expect(screen.getByText("Blair Manager")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search members by name or email" }), { target: { value: "blair@" } });
    expect(screen.queryByText("Alex Owner")).not.toBeInTheDocument();
    expect(screen.getByText("Blair Manager")).toBeInTheDocument();
    expect(within(screen.getByText("Blair Manager").closest("tr")!).getByText("Technician")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search members by name or email" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by role" }), { target: { value: "tech-role" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by account status" }), { target: { value: "INACTIVE" } });
    expect(screen.getByText("Blair Manager")).toBeInTheDocument();
    expect(screen.queryByText("Alex Owner")).not.toBeInTheDocument();
  });

  it("keeps Add Member open on an API error and closes after successful creation", async () => {
    createMock.mockRejectedValueOnce(new Error("unavailable"));
    const user = userEvent.setup();
    render(<MembersPage />);
    await user.click(screen.getByRole("button", { name: "Add Member" }));
    const dialog = screen.getByRole("dialog", { name: "Add member" });
    await user.type(within(dialog).getByLabelText("Full Name"), "Casey New");
    await user.type(within(dialog).getByLabelText("Email"), "casey@example.com");
    await user.type(within(dialog).getByLabelText("Temporary Password"), "securepass123");
    await user.click(within(dialog).getByRole("button", { name: "Create member" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Failed to create member.");
    expect(screen.getByRole("dialog", { name: "Add member" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create member" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add member" })).not.toBeInTheDocument());
    expect(createMock).toHaveBeenCalledWith("admin-token", { fullName: "Casey New", email: "casey@example.com", phone: undefined, password: "securepass123" });
    expect(listMembersMock).toHaveBeenCalledTimes(2);
  });

  it("assigns an additional role and confirms removal in Manage Access", async () => {
    listMembersMock.mockResolvedValueOnce([owner]).mockResolvedValueOnce([{ ...owner, userRoles: [...owner.userRoles, { role: { id: "manager-role", name: "Manager" } }] }]).mockResolvedValue([owner]);
    const user = userEvent.setup();
    render(<MembersPage />);
    await screen.findByText("Alex Owner");
    await user.click(screen.getByRole("button", { name: "Actions for Alex Owner" }));
    await user.click(screen.getByRole("button", { name: "Manage access" }));
    const dialog = screen.getByRole("dialog", { name: "Manage access" });
    await user.selectOptions(within(dialog).getByLabelText("Assign another role"), "manager-role");
    await user.click(within(dialog).getByRole("button", { name: "Assign role" }));
    expect(assignMock).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog", { name: "Assign Manager to Alex Owner?" })).getByRole("button", { name: "Assign role" }));
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("admin-token", "owner-1", "manager-role"));
    await user.click(within(dialog).getAllByRole("button", { name: "Remove" })[1]);
    const confirm = screen.getByRole("dialog", { name: "Remove Manager from Alex Owner?" });
    expect(revokeMock).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Remove role" }));
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith("admin-token", "owner-1", "manager-role"));
  });

  it("requires confirmation before changing account status", async () => {
    listMembersMock.mockResolvedValue([owner]);
    const user = userEvent.setup();
    render(<MembersPage />);
    await screen.findByText("Alex Owner");
    await user.click(screen.getByRole("button", { name: "Actions for Alex Owner" }));
    await user.click(screen.getByRole("button", { name: "Deactivate account" }));
    expect(statusMock).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog", { name: "Deactivate Alex Owner's account?" })).getByRole("button", { name: "Deactivate account" }));
    await waitFor(() => expect(statusMock).toHaveBeenCalledWith("admin-token", "owner-1", "INACTIVE"));
  });

  it("closes the member actions menu with Escape and restores focus", async () => {
    listMembersMock.mockResolvedValue([owner]);
    const user = userEvent.setup();
    render(<MembersPage />);
    const actions = await screen.findByRole("button", { name: "Actions for Alex Owner" });
    await user.click(actions);
    expect(screen.getByRole("button", { name: "Manage access" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Manage access" })).not.toBeInTheDocument();
    expect(actions).toHaveFocus();
  });

  it("requires Admin to choose a final role before approving registration", async () => {
    render(<MembersPage />);
    await userEvent.setup().click(screen.getByRole("tab", { name: /Registration Requests/ }));
    expect(await screen.findByText("Alex Santos")).toBeInTheDocument();
    const approveButton = screen.getByRole("button", { name: "Approve" });
    expect(approveButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Final role"), { target: { value: "tech-role" } });
    expect(approveButton).toBeEnabled();
    fireEvent.click(approveButton);
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith("admin-token", "request-1", "tech-role"));
  });

  it("keeps registration decline behind confirmation", async () => {
    const user = userEvent.setup();
    render(<MembersPage />);
    await user.click(screen.getByRole("tab", { name: /Registration Requests/ }));
    await screen.findByText("Alex Santos");
    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(declineMock).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog", { name: "Decline Alex Santos's request?" })).getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(declineMock).toHaveBeenCalledWith("admin-token", "request-1"));
  });

  it("does not fetch requests for a non-Admin account", () => {
    useAuthMock.mockReturnValue({ user: { roles: ["Manager"] }, accessToken: "manager-token", isLoading: false, hasPermission: () => true });
    render(<MembersPage />);
    expect(screen.getByText(/do not have permission to manage members/i)).toBeInTheDocument();
    expect(listPendingMock).not.toHaveBeenCalled();
  });
});
