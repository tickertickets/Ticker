import { cn } from "@/lib/utils";
import { type SocialLink, MAX_LINKS } from "@/lib/socialLinks";
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
  const visible = links.filter(l => showHidden || !l.hidden);

  if (visible.length === 0 && !isOwner) return null;

  const iconBox = size === "md" ? "w-8 h-8 rounded-xl" : "w-7 h-7 rounded-xl";
  const iconSize = size === "md" ? 17 : 15;
  const labelCls = size === "md" ? "text-xs" : "text-[11px]";

  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-2 w-full", className)}>
      {visible.map(link => {
        const isHidden = !!link.hidden;
        return (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className={cn(
              "inline-flex items-center gap-1.5 transition-opacity active:scale-95 select-none",
              isHidden && "opacity-40",
            )}
            title={link.label ? `${link.label}` : link.platform}
          >
            <span className={cn(
              "flex items-center justify-center flex-shrink-0 bg-foreground text-background",
              iconBox,
            )}>
              <SocialLinkPlatformIcon platform={link.platform as any} size={iconSize} />
            </span>
            {link.label && (
              <span className={cn("font-semibold leading-none text-foreground max-w-[90px] truncate", labelCls)}>
                {link.label}
              </span>
            )}
          </a>
        );
      })}

      {isOwner && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onManage?.(); }}
          className={cn(
            "inline-flex items-center justify-center gap-1 bg-secondary text-muted-foreground",
            "hover:text-foreground hover:bg-secondary/80 transition-colors rounded-xl",
            links.length === 0 ? "px-3 h-7 gap-1.5" : iconBox,
          )}
          title={links.length < MAX_LINKS ? t.addLink : t.manageLinks}
        >
          <Globe className="w-3.5 h-3.5 flex-shrink-0" />
          {links.length === 0 && (
            <span className="text-[11px] font-medium leading-none whitespace-nowrap">{t.addLink}</span>
          )}
        </button>
      )}
    </div>
  );
}
