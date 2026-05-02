import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ReactNode } from "react";
import { createElement } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000)         return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function formatDate(dateString: string | null | undefined) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+|www\.[^\s<>"{}|\\^`[\]]+/g;

/**
 * Split `text` into an array of strings and <a> elements for any URLs found.
 * Pass `stopPropagation=true` when the text is inside a clickable card so
 * tapping a link doesn't also navigate to the card.
 */
export function renderWithLinks(text: string, stopPropagation = false): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const raw = m[0].replace(/[.,!?;:)>]+$/, "");
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const href = raw.startsWith("http") ? raw : `https://${raw}`;
    nodes.push(
      createElement(
        "a",
        {
          key: m.index,
          href,
          target: "_blank",
          rel: "noopener noreferrer",
          className: "underline underline-offset-2 text-foreground/80 hover:text-foreground transition-colors break-all",
          onClick: stopPropagation ? (e: MouseEvent) => e.stopPropagation() : undefined,
        },
        raw,
      ),
    );
    last = m.index + raw.length;
    URL_RE.lastIndex = last;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : [text];
}
