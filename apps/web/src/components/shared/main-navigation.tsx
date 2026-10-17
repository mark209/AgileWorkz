"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BriefcaseBusiness, ChevronLeft, ChevronRight, ClipboardList, FileText, LayoutDashboard, LogOut, Menu, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface NavigationItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission?: readonly [module: string, action: string];
}

const navigationGroups: { label: string; items: NavigationItem[] }[] = [
  { label: "Overview", items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }] },
  { label: "Customers", items: [{ label: "Customer Data", href: "/customers", icon: Users, permission: ["customers", "read"] }] },
  { label: "Sales", items: [{ label: "Quotations", href: "/quotations", icon: FileText, permission: ["quotations", "read"] }] },
  {
    label: "Operations",
    items: [
      { label: "Work Orders", href: "/work-orders", icon: BriefcaseBusiness },
      { label: "Service Reports", href: "/service-reports", icon: ClipboardList },
    ],
  },
  { label: "Administration", items: [{ label: "Member Management", href: "/members", icon: Users, permission: ["users", "manage"] }] },
];

export function MainNavigation({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, hasPermission, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [tabletWidth, setTabletWidth] = useState(false);
  const [tabletExpanded, setTabletExpanded] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem("agileworks-sidebar-collapsed") === "true");
    if (!window.matchMedia) return;
    const tablet = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
    const updateTabletWidth = () => {
      setTabletWidth(tablet.matches);
      if (!tablet.matches) setTabletExpanded(false);
    };
    updateTabletWidth();
    tablet.addEventListener("change", updateTabletWidth);
    return () => tablet.removeEventListener("change", updateTabletWidth);
  }, []);

  if (!user || pathname === "/login") return <>{children}</>;
  const userName = user.fullName;
  const sidebarCollapsed = collapsed || (tabletWidth && !tabletExpanded);

  const groups = navigationGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.href === "/work-orders"
      ? hasPermission("work_orders", "read") || hasPermission("work_orders", "read_assigned") || hasPermission("work_orders", "read_own")
      : item.href === "/members"
        ? user.roles?.includes("Admin/Owner") && hasPermission("users", "manage")
        : item.href === "/service-reports"
          ? hasPermission("service_reports", "read") || hasPermission("service_reports", "read_assigned")
        : !item.permission || hasPermission(item.permission[0], item.permission[1])),
  })).filter((group) => group.items.length > 0);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function toggleCollapsed() {
    if (tabletWidth) {
      if (collapsed) {
        setCollapsed(false);
        window.localStorage.setItem("agileworks-sidebar-collapsed", "false");
        setTabletExpanded(true);
      } else {
        setTabletExpanded((current) => !current);
      }
      return;
    }
    setCollapsed((current) => {
      window.localStorage.setItem("agileworks-sidebar-collapsed", String(!current));
      return !current;
    });
  }

  async function signOut() {
    setMobileMenuOpen(false);
    await logout();
    router.push("/login");
  }

  function navigationContent(isCollapsed: boolean, onNavigate?: () => void) {
    return (
      <>
        <div className={`flex h-16 items-center border-b px-4 ${isCollapsed ? "justify-center" : "justify-between"}`}>
          <Link href="/dashboard" onClick={onNavigate} className="min-w-0 font-semibold leading-tight tracking-tight focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="AgileWorks HVAC ERP — Dashboard" title={isCollapsed ? "AgileWorks HVAC ERP" : undefined}>
            {isCollapsed ? "AW" : <span>AgileWorks<br /><span className="text-xs font-medium text-muted-foreground">HVAC ERP</span></span>}
          </Link>
          {!onNavigate && !isCollapsed && <Button variant="ghost" size="icon" onClick={toggleCollapsed} aria-label="Collapse sidebar" aria-expanded="true" title="Collapse sidebar"><ChevronLeft className="h-4 w-4" /></Button>}
        </div>
        <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
          {groups.map((group) => (
            <div key={group.label}>
              {!isCollapsed && <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return <Link key={item.href} id={onNavigate && item.href === "/dashboard" ? "mobile-navigation-first" : undefined} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} aria-label={isCollapsed ? item.label : undefined} title={isCollapsed ? item.label : undefined} className={`flex min-h-10 items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary bg-accent text-foreground" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"} ${isCollapsed ? "justify-center px-2" : ""}`}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{!isCollapsed && <span>{item.label}</span>}</Link>;
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          {isCollapsed && <Button variant="ghost" size="icon" onClick={toggleCollapsed} aria-label="Expand sidebar" aria-expanded="false" title="Expand sidebar" className="mb-2 w-full"><ChevronRight className="h-4 w-4" /></Button>}
          {!isCollapsed && <p className="truncate px-3 pb-2 text-xs text-muted-foreground" title={userName}>{userName}</p>}
          <Button variant="ghost" className={`w-full ${isCollapsed ? "justify-center px-2" : "justify-start"}`} onClick={signOut} aria-label={isCollapsed ? "Sign out" : undefined} title={isCollapsed ? "Sign out" : undefined}><LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />{!isCollapsed && <span className="ml-3">Sign out</span>}</Button>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-background md:flex ${sidebarCollapsed ? "w-[72px]" : "w-60"}`}>
        {navigationContent(sidebarCollapsed)}
      </aside>
      <div className="min-w-0 flex-1">
        <div className="flex h-14 items-center gap-3 border-b px-4 md:hidden">
          <Dialog open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <DialogTrigger asChild><Button variant="outline" size="icon" aria-label="Open menu"><Menu className="h-5 w-5" /></Button></DialogTrigger>
            <DialogContent className="left-0 top-0 flex h-full w-[min(20rem,85vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0" aria-describedby="mobile-menu-description" onOpenAutoFocus={(event: Event) => { event.preventDefault(); document.getElementById("mobile-navigation-first")?.focus(); }}>
              <DialogTitle className="sr-only">Main menu</DialogTitle>
              <DialogDescription id="mobile-menu-description" className="sr-only">Navigate AgileWorks HVAC ERP</DialogDescription>
              {navigationContent(false, () => setMobileMenuOpen(false))}
            </DialogContent>
          </Dialog>
          <span className="font-semibold">AgileWorks HVAC ERP</span>
        </div>
        {children}
      </div>
    </div>
  );
}
