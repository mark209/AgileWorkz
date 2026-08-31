import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard shadcn/ui helper: merges conditional class lists (clsx) and then
// resolves conflicting Tailwind utility classes (twMerge) so the last one
// wins predictably instead of both landing in the DOM.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
