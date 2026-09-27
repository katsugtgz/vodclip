import { cn } from "../lib/utils";

export function Badge({ className, ...props }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-white/5 px-3 py-1 text-xs font-medium text-muted",
        className
      )}
      {...props}
    />
  );
}
