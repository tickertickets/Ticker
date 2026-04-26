import { createContext, useContext, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Holds the performance.now() timestamp of when shimmer-active was applied
 * to the current tab's container. null = shimmer not yet active.
 *
 * NEW cards that mount AFTER shimmer is active read this value ONCE at mount
 * to calculate their --shimmer-delay offset so they appear in sync with cards
 * that started at t=0.
 *
 * EXISTING cards that mounted when startTime was null are never affected by
 * context changes — their effect has empty deps and never re-runs.
 */
export const ShimmerContext = createContext<number | null>(null);

/**
 * ShimmerOverlay — the ONLY correct way to render a shimmer overlay div.
 *
 * Design contract:
 *  - `--shimmer-delay` is set imperatively via DOM ref, ONCE at mount.
 *  - The render output never includes inline styles for --shimmer-delay.
 *  - Therefore React re-renders (from context changes) NEVER update the
 *    CSS variable on existing elements → CSS animation never restarts → no jitter.
 *
 * Sync logic:
 *  - Card mounts while shimmer is NOT active (startTime = null):
 *      delay stays 0ms. When shimmer-active is later added, this card starts
 *      at position 0, same as every other pre-mounted card → synchronized ✓
 *  - Card mounts while shimmer IS active (startTime = T):
 *      elapsed = now - T; delay = -elapsed ms.
 *      The card's animation immediately appears at position `elapsed` ms in
 *      the cycle, matching cards that started at T → synchronized ✓
 */
export function ShimmerOverlay({
  className,
  extraClass,
}: {
  className: string;
  extraClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startTime = useContext(ShimmerContext);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || startTime === null) return;
    const elapsed = Math.round(performance.now() - startTime);
    el.style.setProperty("--shimmer-delay", `${-elapsed}ms`);
  }, []); // ONE-TIME at mount — NEVER re-runs even if context changes

  return (
    <div
      ref={ref}
      className={cn("shimmer-overlay", className, extraClass)}
    />
  );
}
