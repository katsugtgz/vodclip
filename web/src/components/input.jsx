import { cn } from "../lib/utils";

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        "h-12 w-full rounded-xl border border-line bg-white/5 px-4 text-base text-fg placeholder:text-muted/60 transition-colors duration-[150ms] focus:border-accent/60 focus:outline-none",
        className
      )}
      {...props}
    />
  );
}
