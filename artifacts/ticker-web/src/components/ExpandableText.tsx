import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn, renderWithLinks } from "@/lib/utils";
import { useLang } from "@/lib/i18n";

type Props = {
  text: string;
  className?: string;
  align?: "left" | "center" | "right" | null;
  clampLines?: number;
};

// Inline expandable text. The "Read more / Less" toggle only appears
// when the text *actually* overflows the clamp at the current width
// (measured from the DOM, not guessed from character count).
export function ExpandableText({
  text,
  className,
  align = "left",
  clampLines = 4,
}: Props) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const prev = el.style.cssText;
      el.style.display = "-webkit-box";
      el.style.webkitLineClamp = String(clampLines);
      (el.style as unknown as { webkitBoxOrient: string }).webkitBoxOrient = "vertical";
      el.style.overflow = "hidden";
      const clamped = el.scrollHeight > el.clientHeight + 1;
      el.style.cssText = prev;
      setOverflows(clamped);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, clampLines]);

  if (!text) return null;

  const alignClass =
    align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";

  const clampStyle = !expanded && overflows
    ? ({
        display: "-webkit-box",
        WebkitLineClamp: clampLines,
        WebkitBoxOrient: "vertical" as const,
        overflow: "hidden",
      })
    : undefined;

  return (
    <div className={cn("w-full", alignClass)}>
      <p
        ref={ref}
        className={cn("whitespace-pre-wrap break-words", className)}
        style={{ overflowWrap: "break-word", wordBreak: "break-word", ...clampStyle }}
      >
        {renderWithLinks(text, true)}
      </p>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? t.collapse : t.readMore}
        </button>
      )}
    </div>
  );
}
