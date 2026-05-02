import { useState, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { type SocialLink, type Platform, detectPlatform, normalizeUrl, isValidUrl, PLATFORM_META, MAX_LINKS } from "@/lib/socialLinks";
import { SocialLinkPlatformIcon } from "./SocialLinkPlatformIcon";
import { Trash2, EyeOff, Eye, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type EntityType = "caption" | "chain" | "bio";

interface Props {
  open: boolean;
  onClose: () => void;
  links: SocialLink[];
  entityType: EntityType;
  entityId: string;
  onSaved: (links: SocialLink[]) => void;
}

function apiPath(entityType: EntityType, entityId: string) {
  if (entityType === "caption") return `/api/tickets/${entityId}/caption-links`;
  if (entityType === "chain") return `/api/chains/${entityId}/description-links`;
  return `/api/users/me/bio-links`;
}

export function AddLinkSheet({ open, onClose, links: initialLinks, entityType, entityId, onSaved }: Props) {
  const { t } = useLang();
  const { toast } = useToast();

  const [links, setLinks] = useState<SocialLink[]>(initialLinks);
  const [urlInput, setUrlInput] = useState("");
  const [saving, setSaving] = useState(false);

  const preview = urlInput.trim() ? (isValidUrl(urlInput.trim()) ? detectPlatform(urlInput.trim()) : null) : null;

  const handleAdd = useCallback(() => {
    const raw = urlInput.trim();
    if (!raw) return;
    if (!isValidUrl(raw)) {
      toast({ title: t.invalidUrl, duration: 1800 });
      return;
    }
    if (links.length >= MAX_LINKS) {
      toast({ title: t.maxLinksReached, duration: 1800 });
      return;
    }
    const { platform, label } = detectPlatform(raw);
    const newLink: SocialLink = {
      id: crypto.randomUUID().slice(0, 10),
      url: normalizeUrl(raw),
      platform,
      label,
      hidden: false,
    };
    setLinks(prev => [...prev, newLink]);
    setUrlInput("");
  }, [urlInput, links.length, t, toast]);

  const handleDelete = (id: string) => {
    setLinks(prev => prev.filter(l => l.id !== id));
  };

  const handleToggleHidden = (id: string) => {
    setLinks(prev => prev.map(l => l.id === id ? { ...l, hidden: !l.hidden } : l));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(apiPath(entityType, entityId), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links }),
      });
      if (!res.ok) throw new Error("save failed");
      const data = await res.json() as { links: SocialLink[] };
      onSaved(data.links ?? links);
      onClose();
    } catch {
      toast({ title: t.errGenericRetry, duration: 2000 });
    } finally {
      setSaving(false);
    }
  };

  const previewMeta = preview ? (PLATFORM_META[preview.platform as Platform] ?? PLATFORM_META.generic) : null;

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85dvh] flex flex-col pb-safe">
        <SheetHeader className="shrink-0 pb-2">
          <SheetTitle className="text-base">{t.manageLinks}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pb-2">
          {links.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">{t.noLinksYet}</p>
          )}
          {links.map(link => {
            const meta = PLATFORM_META[link.platform as Platform] ?? PLATFORM_META.generic;
            return (
              <div
                key={link.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl bg-secondary/60",
                  link.hidden && "opacity-60",
                )}
              >
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: meta.bg, color: meta.fg }}
                >
                  <SocialLinkPlatformIcon platform={link.platform as Platform} size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {link.label ?? meta.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">{link.url}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {entityType === "bio" && (
                    <button
                      type="button"
                      onClick={() => handleToggleHidden(link.id)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/60 transition-colors"
                      title={link.hidden ? t.showLink : t.hideLink}
                    >
                      {link.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(link.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-background/60 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {links.length < MAX_LINKS && (
          <div className="shrink-0 pt-2 border-t border-border">
            <div className="flex gap-2 items-center">
              {previewMeta && (
                <span
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: previewMeta.bg, color: previewMeta.fg }}
                >
                  <SocialLinkPlatformIcon platform={preview!.platform as Platform} size={16} />
                </span>
              )}
              <Input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                placeholder={t.addLinkPlaceholder}
                className="flex-1 h-9 text-sm"
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <Button
                type="button"
                size="icon"
                variant="default"
                className="h-9 w-9 shrink-0"
                onClick={handleAdd}
                disabled={!urlInput.trim()}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {urlInput.trim() && !isValidUrl(urlInput.trim()) && (
              <p className="text-[11px] text-destructive mt-1 ml-1">{t.invalidUrl}</p>
            )}
          </div>
        )}

        <div className="shrink-0 pt-2">
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {saving ? "..." : t.manageLinks}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
