import * as React from "react";
import { cn } from "@/lib/utils";

// Plain, dependency-free progress bar — a real Radix Progress primitive adds
// no meaningful accessibility benefit here over a correctly-labeled div
// (single short-lived upload, not a complex composite widget), so it isn't
// pulled in just for this.
export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(({ className, value, ...props }, ref) => (
  <div
    ref={ref}
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(value)}
    className={cn("h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
    {...props}
  >
    <div
      className="h-full bg-primary transition-all duration-150"
      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
    />
  </div>
));
Progress.displayName = "Progress";

export { Progress };
