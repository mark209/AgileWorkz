import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex min-w-0 items-center overflow-hidden text-sm text-muted-foreground">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className={`min-w-0 items-center ${index > 0 && !isLast ? "hidden sm:flex" : "flex"}`}>
            {index > 0 && <ChevronRight className="mx-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            {item.href && !isLast ? (
              <Link href={item.href} className="truncate hover:text-foreground hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "truncate font-medium text-foreground" : "truncate"} title={item.label}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
