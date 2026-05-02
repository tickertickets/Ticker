import { useState } from "react";
import { cn } from "@/lib/utils";
import { type SocialLink, PLATFORM_META, MAX_LINKS } from "@/lib/socialLinks";
import { SocialLinkPlatformIcon } from "./SocialLinkPlatformIcon";
import { Link2 } from "lucide-react";
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
  const hasHidden = isOwner && links.some(l => l.hidden);

  if (visible.length === 0 && !isOwner) return null;

  const pillH = size === "md" ? "h-8" : "h-7";
  const pillPx = size === "md" ? "px-2.5" : "px-2";
  const iconSize = size === "md" ? 17 : 15;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {visible.map(link => {
        const meta = PLATFORM_META[link.platform as keyof typeof PLATFORM_META] ?? PLATFORM_META.generic;
        const isHidden = !!link.hidden;
        return (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-transparent",
              "transition-opacity active:scale-95 select-none",
              pillH, pillPx,
              isHidden && "opacity-40",
            )}
            style={{ backgroundColor: meta.bg, color: meta.fg }}
            title={link.label ? `${meta.name} ${link.label}` : meta.name}
          >
            <SocialLinkPlatformIcon platform={link.platform as any} size={iconSize} />
            {link.label && (
              <span className="text-[11px] font-semibold leading-none max-w-[100px] truncate">
                {link.label}
              </span>
            )}
          </a>
        );
      })}

      {isOwner && links.length < MAX_LINKS && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onManage?.(); }}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed border-border",
            "text-muted-foreground hover:text-foreground hover:border-foreground/40",
            "transition-colors",
            pillH, pillPx,
          )}
          title={t.addLink}
        >
          <Link2 className="w-3.5 h-3.5" />
          {links.length === 0 && (
            <span className="text-[11px] font-medium leading-none">{t.addLink}</span>
          )}
        </button>
      )}

      {isOwner && links.length >= MAX_LINKS && onManage && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onManage?.(); }}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed border-border",
            "text-muted-foreground hover:text-foreground hover:border-foreground/40",
            "transition-colors",
            pillH, pillPx,
          )}
          title={t.manageLinks}
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
