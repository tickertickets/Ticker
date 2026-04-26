import { useRef, useState, useCallback, useEffect } from "react";
import { Heart } from "lucide-react";
import { cn, fmtCount } from "@/lib/utils";

interface HeartProps {
  myReactions: Record<string, number>;
  reactionBreakdown: Record<string, number>;
  hideLikes?: boolean;
  onReact: (reactions: Record<string, number>) => void;
  disabled?: boolean;
  iconSize?: number;
  pendingHighlight?: boolean;
}

export function ReactionButton({
  myReactions,
  reactionBreakdown,
  hideLikes,
  onReact,
  disabled,
  iconSize = 20,
  pendingHighlight,
}: HeartProps) {
  const [popped, setPopped] = useState(false);
  const [pressed, setPressed] = useState(false);
  const wasHearted = useRef((myReactions?.["heart"] ?? 0) > 0);
  const lastTouchTime = useRef(0);

  const isHearted = (myReactions?.["heart"] ?? 0) > 0;
  const breakdownCount = reactionBreakdown?.["heart"] ?? 0;

  useEffect(() => {
    if (isHearted && !wasHearted.current) {
      setPopped(true);
      const t = setTimeout(() => setPopped(false), 400);
      return () => clearTimeout(t);
    }
    wasHearted.current = isHearted;
  }, [isHearted]);

  const toggle = useCallback(() => {
    if (disabled) return;
    onReact({ heart: isHearted ? 0 : 1 });
  }, [disabled, isHearted, onReact]);

  const onTouchStart = () => setPressed(true);
  const onTouchEnd = (e: React.TouchEvent) => {
    e.preventDefault();
    lastTouchTime.current = Date.now();
    toggle();
    setTimeout(() => setPressed(false), 150);
  };
  const onTouchCancel = () => setPressed(false);
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - lastTouchTime.current < 600) return;
    toggle();
  };

  const heartColor = isHearted
    ? "fill-foreground text-foreground"
    : pendingHighlight
      ? "text-foreground"
      : "text-muted-foreground/60";

  const countColor = isHearted || pendingHighlight
    ? "text-foreground"
    : "text-muted-foreground/60";

  return (
    <button
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1 select-none touch-none transition-all duration-100 outline-none focus:outline-none focus-visible:outline-none",
        disabled && "opacity-40 cursor-not-allowed",
      )}
      style={{
        WebkitUserSelect: "none",
        WebkitTapHighlightColor: "transparent",
        outline: "none",
        transform: pressed ? "scale(0.75)" : undefined,
        opacity: pressed ? 0.5 : undefined,
      }}
    >
      <span className={cn("inline-flex -translate-y-[1px] transition-transform", popped && "animate-like-pop")}>
        <Heart
          style={{ width: iconSize, height: iconSize }}
          className={cn("transition-all duration-200", heartColor)}
        />
      </span>
      {!hideLikes && breakdownCount > 0 && (
        <span className={cn("text-xs font-bold tabular-nums leading-5", countColor)}>
          {fmtCount(breakdownCount)}
        </span>
      )}
    </button>
  );
}
