import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Site } from "@/lib/api/types";
import { ApiError } from "@/lib/api-client";
import { CreateWorkOrderDialog } from "./create-work-order-dialog";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const { createStandaloneWorkOrderMock } = vi.hoisted(() => ({ createStandaloneWorkOrderMock: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, createStandaloneWorkOrder: createStandaloneWorkOrderMock };
});

const sites: Site[] = [
  {
    id: "s1",
    customerId: "c1",
    label: "Main Building",
    addressLine: "1 Main St",
    city: null,
    region: null,
    postalCode: null,
    geoLat: null,
    geoLng: null,
    primaryContactId: null,
    accessNotes: null,
    status: "ACTIVE",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  },
];

describe("CreateWorkOrderDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ accessToken: "token-1", hasPermission: () => true, user: { id: "admin-1", roles: ["Admin/Owner"] } });
  });

  it("requires a site and reason before the form can submit", async () => {
    render(<CreateWorkOrderDialog customerId="c1" sites={sites} onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /new work order/i }));
    await user.click(screen.getByRole("button", { name: /^create work order$/i }));

    expect(createStandaloneWorkOrderMock).not.toHaveBeenCalled();
  });

  it("creates a standalone work order and navigates to its detail page on success", async () => {
    createStandaloneWorkOrderMock.mockResolvedValue({ id: "wo-new" });
    const onCreated = vi.fn();
    render(<CreateWorkOrderDialog customerId="c1" sites={sites} onCreated={onCreated} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /new work order/i }));
    await user.selectOptions(screen.getByLabelText(/site/i), "s1");
    await user.type(screen.getByLabelText(/reason details/i), "No-cooling complaint");
    await user.click(screen.getByRole("button", { name: /^create work order$/i }));

    await waitFor(() =>
      expect(createStandaloneWorkOrderMock).toHaveBeenCalledWith(
        "token-1",
        "c1",
        expect.objectContaining({ siteId: "s1", standaloneReason: "No-cooling complaint", standaloneReasonType: "INTERNAL" }),
      ),
    );
    expect(onCreated).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith("/work-orders/wo-new");
  });

  it("surfaces an error and keeps the dialog open when creation fails", async () => {
    createStandaloneWorkOrderMock.mockRejectedValue(new ApiError(400, "Site does not belong to this customer"));
    render(<CreateWorkOrderDialog customerId="c1" sites={sites} onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /new work order/i }));
    await user.selectOptions(screen.getByLabelText(/site/i), "s1");
    await user.type(screen.getByLabelText(/reason details/i), "Test");
    await user.click(screen.getByRole("button", { name: /^create work order$/i }));

    expect(await screen.findByText(/does not belong to this customer/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("warns a Manager when the new Work Order will be outside their assigned view", async () => {
    useAuthMock.mockReturnValue({
      accessToken: "token-1",
      user: { id: "manager-1", roles: ["Manager"] },
      hasPermission: (module: string, action: string) => module === "work_orders" && action === "read_assigned",
    });
    createStandaloneWorkOrderMock.mockResolvedValue({ id: "wo-new" });
    render(<CreateWorkOrderDialog customerId="c1" sites={sites} onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /new work order/i }));
    expect(screen.getByText(/will not appear in your assigned list/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/site/i), "s1");
    await user.type(screen.getByLabelText(/reason details/i), "Direct service request");
    await user.click(screen.getByRole("button", { name: /^create work order$/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/work-orders?created=outside-scope"));
  });
});
