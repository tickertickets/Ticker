export type Platform =
  | "instagram"
  | "youtube"
  | "tiktok"
  | "x"
  | "facebook"
  | "threads"
  | "line"
  | "generic";

export interface SocialLink {
  id: string;
  url: string;
  platform: Platform;
  label?: string;
  hidden?: boolean;
}

export const PLATFORM_META: Record<
  Platform,
  { name: string; bg: string; fg: string }
> = {
  instagram: { name: "Instagram", bg: "#E1306C", fg: "#fff" },
  youtube:   { name: "YouTube",   bg: "#FF0000", fg: "#fff" },
  tiktok:    { name: "TikTok",    bg: "#010101", fg: "#fff" },
  x:         { name: "X",         bg: "#000000", fg: "#fff" },
  facebook:  { name: "Facebook",  bg: "#1877F2", fg: "#fff" },
  threads:   { name: "Threads",   bg: "#000000", fg: "#fff" },
  line:      { name: "LINE",      bg: "#06C755", fg: "#fff" },
  generic:   { name: "Link",      bg: "#6B7280", fg: "#fff" },
};

export const MAX_LINKS = 5;

export function detectPlatform(rawUrl: string): { platform: Platform; label?: string } {
  const url = rawUrl.trim().toLowerCase().replace(/\/+$/, "");
  let m: RegExpMatchArray | null;

  if ((m = url.match(/instagram\.com\/([^/?#\s]+)/))) {
    const u = m[1]!;
    if (!["p", "reel", "stories", "explore", "tv"].includes(u))
      return { platform: "instagram", label: "@" + u };
    return { platform: "instagram" };
  }
  if ((m = url.match(/youtube\.com\/@?(?:c\/|user\/|channel\/)?([^/?#\s]+)/))) {
    const u = m[1]!;
    if (!["watch", "playlist", "shorts", "results", "feed"].includes(u))
      return { platform: "youtube", label: "@" + u.replace(/^@/, "") };
    return { platform: "youtube" };
  }
  if (/youtu\.be/.test(url)) return { platform: "youtube" };
  if ((m = url.match(/tiktok\.com\/@?([^/?#\s]+)/))) {
    return { platform: "tiktok", label: "@" + m[1]!.replace(/^@/, "") };
  }
  if ((m = url.match(/(?:twitter|x)\.com\/([^/?#\s]+)/))) {
    const u = m[1]!;
    if (!["home", "explore", "notifications", "messages", "search", "i", "settings"].includes(u))
      return { platform: "x", label: "@" + u };
    return { platform: "x" };
  }
  if ((m = url.match(/facebook\.com\/([^/?#\s]+)/))) {
    const u = m[1]!;
    if (!["pages", "groups", "events", "watch", "gaming", "marketplace", "profile.php"].includes(u))
      return { platform: "facebook", label: u };
    return { platform: "facebook" };
  }
  if ((m = url.match(/threads\.net\/@?([^/?#\s]+)/))) {
    return { platform: "threads", label: "@" + m[1]!.replace(/^@/, "") };
  }
  if (/line\.me|lin\.ee/.test(url)) return { platform: "line" };
  return { platform: "generic" };
}

export function normalizeUrl(url: string): string {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  return "https://" + u;
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(normalizeUrl(url));
    return url.trim().length > 0;
  } catch {
    return false;
  }
}
