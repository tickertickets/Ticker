import { useState } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

// Uses Simple Icons CDN (simpleicons.org) — supports 3,000+ brand icons automatically.
// Falls back to a Globe icon for unknown platforms.
// CSS: grayscale + brightness-0 = pure black; dark:invert = white in dark mode.

export function SocialLinkPlatformIcon({
  platform,
  size = 18,
  className,
}: {
  platform: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!platform || platform === "generic" || failed) {
    return (
      <Globe
        width={size}
        height={size}
        className={cn("flex-shrink-0", className)}
      />
    );
  }

  return (
    <img
      src={`https://cdn.simpleicons.org/${encodeURIComponent(platform)}`}
      width={size}
      height={size}
      alt={platform}
      className={cn(
        "flex-shrink-0 grayscale brightness-0 dark:invert",
        className,
      )}
      onError={() => setFailed(true)}
    />
  );
}
