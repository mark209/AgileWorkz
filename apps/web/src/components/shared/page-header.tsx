import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row", className)}>
      <div className="min-w-0 max-w-3xl">
        <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
