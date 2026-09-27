import { cn } from "../lib/utils";

export function Card({ className, ...props }) {
  return (
    <div
      className={cn("rounded-3xl border border-line bg-card", className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }) {
  return <div className={cn("p-6 sm:p-8", className)} {...props} />;
}
