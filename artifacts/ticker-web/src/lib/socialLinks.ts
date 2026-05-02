// platform is now a free-form Simple Icons slug (e.g. "instagram", "github", "spotify")
// No hardcoded list — any URL is supported via domain detection.
export type Platform = string;

export interface SocialLink {
  id: string;
  url: string;
  platform: Platform;
  label?: string;
  hidden?: boolean;
}

// Human-readable names for well-known slugs (fallback: capitalize the slug)
const KNOWN_NAMES: Record<string, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
  facebook: "Facebook",
  threads: "Threads",
  discord: "Discord",
  github: "GitHub",
  linkedin: "LinkedIn",
  twitch: "Twitch",
  spotify: "Spotify",
  behance: "Behance",
  dribbble: "Dribbble",
  patreon: "Patreon",
  substack: "Substack",
  medium: "Medium",
  reddit: "Reddit",
  pinterest: "Pinterest",
  snapchat: "Snapchat",
  line: "LINE",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  vimeo: "Vimeo",
  soundcloud: "SoundCloud",
};

export function getPlatformName(slug: string): string {
  return KNOWN_NAMES[slug] ?? (slug.charAt(0).toUpperCase() + slug.slice(1));
}

// Legacy export kept for any existing imports
export const PLATFORM_META: Record<string, { name: string; bg: string; fg: string }> = {};

export const MAX_LINKS = 5;

// Domain → Simple Icons slug overrides (where domain part ≠ slug)
const DOMAIN_SLUG: Record<string, string> = {
  "twitter.com": "x",
  "t.co": "x",
  "youtu.be": "youtube",
  "fb.com": "facebook",
  "fb.me": "facebook",
  "discordapp.com": "discord",
  "discord.gg": "discord",
  "vm.tiktok.com": "tiktok",
  "open.spotify.com": "spotify",
  "music.apple.com": "applemusic",
  "lin.ee": "line",
  "line.me": "line",
  "t.me": "telegram",
  "wa.me": "whatsapp",
};

// Domains where we can extract a @username label
const USERNAME_PATTERNS: { pattern: RegExp; slug: string; skip?: string[] }[] = [
  { pattern: /instagram\.com\/([^/?#\s]+)/, slug: "instagram", skip: ["p", "reel", "stories", "explore", "tv"] },
  { pattern: /youtube\.com\/@?(?:c\/|user\/|channel\/)?([^/?#\s]+)/, slug: "youtube", skip: ["watch", "playlist", "shorts", "results", "feed"] },
  { pattern: /tiktok\.com\/@?([^/?#\s]+)/, slug: "tiktok" },
  { pattern: /(?:twitter|x)\.com\/([^/?#\s]+)/, slug: "x", skip: ["home", "explore", "notifications", "messages", "search", "i", "settings"] },
  { pattern: /threads\.net\/@?([^/?#\s]+)/, slug: "threads" },
  { pattern: /facebook\.com\/([^/?#\s]+)/, slug: "facebook", skip: ["pages", "groups", "events", "watch", "gaming", "marketplace", "profile.php"] },
  { pattern: /discord\.(?:gg|com\/invite|com\/channels)\/([^/?#\s]+)/, slug: "discord" },
  { pattern: /github\.com\/([^/?#\s]+)/, slug: "github", skip: ["orgs", "topics", "trending", "explore"] },
  { pattern: /linkedin\.com\/in\/([^/?#\s]+)/, slug: "linkedin" },
  { pattern: /twitch\.tv\/([^/?#\s]+)/, slug: "twitch", skip: ["directory", "subscriptions", "videos"] },
];

export function detectPlatform(rawUrl: string): { platform: Platform; label?: string } {
  const url = rawUrl.trim().toLowerCase().replace(/\/+$/, "");

  // Try username extraction for known patterns first
  for (const { pattern, slug, skip } of USERNAME_PATTERNS) {
    const m = url.match(pattern);
    if (m) {
      const u = m[1]!.replace(/^@/, "");
      const label = skip && skip.includes(u) ? undefined : "@" + u;
      return { platform: slug, label };
    }
  }

  // Extract slug from domain
  try {
    const { hostname } = new URL(normalizeUrl(rawUrl));
    const domain = hostname.replace(/^www\./, "");

    // Check override map first
    if (DOMAIN_SLUG[domain]) return { platform: DOMAIN_SLUG[domain] };

    // Derive slug from first part of domain (e.g. "spotify" from "spotify.com")
    const slug = domain.split(".")[0]!;
    return { platform: slug };
  } catch {
    return { platform: "generic" };
  }
}

export function normalizeUrl(url: string): string {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  return "https://" + u;
}

export function isValidUrl(url: string): boolean {
  try {
    const normalized = normalizeUrl(url);
    const parsed = new URL(normalized);

    // Only allow http / https
    if (!["http:", "https:"].includes(parsed.protocol)) return false;

    const h = parsed.hostname.toLowerCase();

    // Must have a dot — bare hostnames ("localhost", "intranet") are invalid
    if (!h.includes(".")) return false;

    // Block loopback / localhost
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(h)) return false;

    // Block private IPv4 ranges: 10.x, 172.16–31.x, 192.168.x
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(h)) return false;

    // Block reserved / internal TLDs
    if (/\.(local|internal|test|example|invalid|localhost|corp|home|lan)$/.test(h)) return false;

    // Hostname must look like a real domain (alphanumeric + hyphens/dots)
    if (!/^[a-z0-9][a-z0-9\-.]*\.[a-z]{2,}$/.test(h)) return false;

    return url.trim().length > 0;
  } catch {
    return false;
  }
}
