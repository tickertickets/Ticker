import { cn } from "@/lib/utils"

/**
 * Instagram-style skeleton shimmer.
 * Uses a CSS-variable-aware gradient so it works in both light and dark mode
 * without any extra JS — the shimmer sweeps left-to-right at 1.4 s cadence.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton-shimmer rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
