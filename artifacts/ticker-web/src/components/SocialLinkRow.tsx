import { useState } from "react";
import { cn } from "@/lib/utils";
import { type SocialLink, MAX_LINKS, getPlatformName } from "@/lib/socialLinks";
import { SocialLinkPlatformIcon } from "./SocialLinkPlatformIcon";
import { Globe } from "lucide-react";
import { useLang } from "@/lib/i18n";

interface Props {
  links: SocialLink[];
  isOwner?: boolean;
  showHidden?: boolean;
  onManage?: () => void;
  className?: string;
  size?: "sm" | "md";
}

export function SocialLinkRow({ links, isOwner, showHidden, onManage, className, size = "sm" }: Props) {
  const { t } = useLang();
  const [expandedLinkId, setExpandedLinkId] = useState<string | null>(null);
  const visible = links.filter(l => showHidden || !l.hidden);

  if (visible.length === 0 && !isOwner) return null;

  const iconSize = size === "md" ? 18 : 16;
  const labelCls = size === "md" ? "text-xs" : "text-[11px]";

  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-x-3 gap-y-2 w-full", className)}>
      {visible.map(link => {
        const isHidden = !!link.hidden;
        const isExpanded = expandedLinkId === link.id;
        const label = link.label?.trim() || getPlatformName(link.platform);
        return (
          <div
            key={link.id}
            className={cn(
              "inline-flex shrink-0 items-center overflow-hidden rounded-full bg-secondary transition-opacity",
              isHidden && "opacity-40",
            )}
            style={{
              width: "max-content",
              maxWidth: isExpanded ? "min(184px, calc(100vw - 48px))" : 36,
              transition: "max-width 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease",
            }}
          >
            <button
              type="button"
              aria-label={label}
              aria-expanded={isExpanded}
              title={label}
              onClick={() => setExpandedLinkId(current => current === link.id ? null : link.id)}
              className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition-transform active:scale-95"
            >
              <SocialLinkPlatformIcon
                platform={link.platform as any}
                size={iconSize}
                className="flex-shrink-0 text-foreground"
              />
            </button>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-hidden={!isExpanded}
              tabIndex={isExpanded ? 0 : -1}
              onClick={e => e.stopPropagation()}
              className={cn(
                "shrink-0 overflow-hidden pr-3 font-semibold leading-none text-foreground whitespace-nowrap transition-opacity duration-200",
                labelCls,
                isExpanded ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            >
              <span className="block max-w-[132px] truncate">{label}</span>
            </a>
          </div>
        );
      })}

      {isOwner && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onManage?.(); }}
          className={cn(
            "inline-flex items-center justify-center gap-1 text-muted-foreground",
            "hover:text-foreground transition-colors",
            links.length === 0 ? "gap-1.5" : "",
          )}
          title={links.length < MAX_LINKS ? t.addLink : t.manageLinks}
        >
          <Globe className="w-4 h-4 flex-shrink-0" />
          {links.length === 0 && (
            <span className="text-[11px] font-medium leading-none whitespace-nowrap">{t.addLink}</span>
          )}
        </button>
      )}
    </div>
  );
}
