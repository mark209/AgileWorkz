import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MainNavigation } from "./main-navigation";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("@/lib/auth-context", () => ({ useAuth: useAuthMock }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/quotations",
  useRouter: () => ({ push: vi.fn() }),
}));

describe("MainNavigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthMock.mockReturnValue({
      user: { fullName: "Office User" },
      hasPermission: (module: string, action: string) => ["customers.read", "quotations.read"].includes(`${module}.${action}`),
      logout: vi.fn(),
    });
  });

  it("shows only permitted destinations and keeps the active page visible when collapsed", () => {
    render(<MainNavigation><main>Quotation list</main></MainNavigation>);
    const desktopNav = screen.getAllByRole("navigation", { name: "Main navigation" })[0];
    expect(desktopNav.querySelector('a[href="/quotations"]')).toHaveAttribute("aria-current", "page");
    expect(desktopNav.querySelector('a[href="/work-orders"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(desktopNav.querySelector('a[href="/quotations"]')).toHaveAttribute("aria-label", "Quotations");
    expect(window.localStorage.getItem("agileworks-sidebar-collapsed")).toBe("true");
  });

  it("opens the mobile drawer and closes it after a destination is selected", () => {
    render(<MainNavigation><main>Quotation list</main></MainNavigation>);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = screen.getByRole("dialog", { name: "Main menu" });
    expect(drawer).toBeInTheDocument();
    const customerLink = drawer.querySelector('a[href="/customers"]')!;
    customerLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(customerLink);
    expect(screen.queryByRole("dialog", { name: "Main menu" })).not.toBeInTheDocument();
  });
});
