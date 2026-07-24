import React from "react";

/**
 * Parses comment text for URLs and renders them as clickable links
 * that open in the browser. Non-URL text is rendered as plain text.
 */
export function renderCommentContent(text: string): React.ReactNode {
  const urlRegex = /https?:\/\/[^\s]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const url = match[0];
    parts.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline break-all"
        onClick={e => e.stopPropagation()}
      >
        {url}
      </a>
    );
    last = match.index + url.length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
