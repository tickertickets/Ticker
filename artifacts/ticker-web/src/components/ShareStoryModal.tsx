import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { X, MessageCircle, Loader2, Link2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/i18n";
import { useModalBackButton } from "@/hooks/use-modal-back-button";
import type { Ticket } from "@workspace/api-client-react";
import {
  getRatingCardStyle,
  PosterCardFront,
  ClassicCardFront,
  CardBackFace,
} from "./CardFaceComponents";

const SEED_W = 190;
const SEED_H = 285;
const PREV_W = 120;
const PREV_H = 180;

async function fetchBlob(url: string): Promise<string | null> {
  for (const src of [
    `/api/storage/proxy-image?url=${encodeURIComponent(url)}`,
    url,
  ]) {
    try {
      const res = await fetch(src);
      if (res.ok) return URL.createObjectURL(await res.blob());
    } catch { /* continue */ }
  }
  return null;
}

async function fetchServerCardPng(
  ticketId: string,
  lang: "th" | "en",
): Promise<Blob> {
  const res = await fetch(
    `/api/tickets/${encodeURIComponent(ticketId)}/export-card.png?lang=${lang}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    throw new Error(`Card export failed (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("Empty card export");
  return blob;
}

function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

interface ShareStoryModalProps {
  ticket: Ticket;
  onClose: () => void;
  onOpenChat?: () => void;
}

export function ShareStoryModal({ ticket, onClose, onOpenChat }: ShareStoryModalProps) {
  const { t, lang } = useLang();
  const tk         = ticket as unknown as Record<string, unknown>;
  const isPoster   = (tk["cardTheme"] as string | undefined) === "poster";
  const ratingType = (tk["ratingType"] as string | undefined) ?? "star";

  const rawImageUrl = isPoster
    ? ((tk["cardBackdropUrl"] as string | null | undefined) ?? ticket.posterUrl ?? null)
    : (ticket.posterUrl ?? null);

  const [imageSrc,   setImageSrc]   = useState<string | null>(null);
  const [visible,    setVisible]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [pressing,   setPressing]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [iosLongPressUrl, setIosLongPressUrl] = useState<string | null>(null);

  useModalBackButton(onClose);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  // Lock background scroll while modal is open (body + html + touchmove for iOS)
  useEffect(() => {
    const html = document.documentElement;
    const prevHtml = html.style.overflow;
    const prevBody = document.body.style.overflow;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const block = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    return () => {
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
      document.removeEventListener("touchmove", block);
    };
  }, []);

  // Pre-fetch poster for the live preview only (server renders the export PNG).
  useEffect(() => {
    if (!rawImageUrl) return;
    let dead = false;
    (async () => {
      const blob = await fetchBlob(rawImageUrl);
      if (dead || !blob) return;
      setImageSrc(prev => { if (prev) URL.revokeObjectURL(prev); return blob; });
    })();
    return () => { dead = true; };
  }, [rawImageUrl]);

  useEffect(() => () => { if (imageSrc) URL.revokeObjectURL(imageSrc); }, [imageSrc]);

  // Track the active iOS long-press URL so we can revoke it on unmount.
  const iosUrlRef = useRef<string | null>(null);
  useEffect(() => { iosUrlRef.current = iosLongPressUrl; }, [iosLongPressUrl]);
  useEffect(() => () => {
    if (iosUrlRef.current) URL.revokeObjectURL(iosUrlRef.current);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const blob     = await fetchServerCardPng(ticket.id, lang);
      const filename = `ticker-${(ticket.movieTitle ?? "card").replace(/\s+/g, "-")}.png`;

      if (isIOS()) {
        // iOS path — show the rendered PNG inline so the user can long-press
        // → "Add to Photos". Direct downloads to Photos aren't allowed by
        // WebKit, and the share sheet exposes confusing extra options, so the
        // long-press menu is the cleanest UX.
        const url = URL.createObjectURL(blob);
        setIosLongPressUrl(url);
        setSaving(false);
        return;
      }

      // Android / desktop — direct download via anchor element.
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5_000);

      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 2_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errSaveCardFailed);
      setSaving(false);
    }
  }, [ticket.id, ticket.movieTitle, lang, onClose, t.errSaveCardFailed]);

  const handleCopyLink = useCallback(async () => {
    const link = `${window.location.origin}/ticket/${ticket.id}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const el = document.createElement("textarea");
      el.value = link;
      el.style.cssText = "position:fixed;top:-9999px;left:-9999px;";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2_500);
  }, [ticket.id]);

  const ratingStyle = getRatingCardStyle(ticket.rating, ratingType);
  const frontBorder: React.CSSProperties =
    ratingStyle.borderColorHex && ratingStyle.borderColorHex !== "transparent"
      ? { borderColor: ratingStyle.borderColorHex }
      : {};

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="bg-background"
        style={{
          position: "fixed",
          bottom: 0,
          left: "50%",
          zIndex: 9999,
          width: "min(100vw, 430px)",
          transform: `translateX(-50%) translateY(${visible ? "0" : "100%"})`,
          transition: "transform 300ms cubic-bezier(0.32, 0.72, 0, 1)",
          borderRadius: "24px 24px 0 0",
          boxShadow: "0 -4px 32px rgba(0,0,0,0.22)",
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag pill */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-4 border-b border-border">
          <h2 className="font-display font-bold text-sm">
            {saved ? t.savedSuccess : t.saveCardToStoryDesc}
          </h2>
          <button
            onPointerDown={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-secondary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-5 pt-5 space-y-4">
          {iosLongPressUrl ? (
            // iOS long-press fallback: show the rendered card image directly
            // inside the sheet. The user long-presses on the image and picks
            // "Add to Photos" from the iOS context menu.
            <div className="flex flex-col items-center gap-4 py-2">
              <img
                src={iosLongPressUrl}
                alt={ticket.movieTitle ?? "Ticker card"}
                style={{
                  maxWidth: "100%",
                  maxHeight: "55vh",
                  borderRadius: 12,
                  boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
                  WebkitTouchCallout: "default",
                  touchAction: "manipulation",
                }}
              />
              <p className="text-center text-xs text-muted-foreground leading-relaxed px-4">
                {t.iosLongPressHint}
              </p>
            </div>
          ) : saved ? (
            <div className="flex flex-col items-center justify-center gap-3 py-6">
              <div className="w-14 h-14 rounded-full bg-green-500/15 flex items-center justify-center text-green-500">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-center text-sm font-semibold">{t.savedToDeviceTitle}</p>
              <p className="text-center text-xs text-muted-foreground leading-relaxed">
                {t.openGalleryHint}
              </p>
            </div>
          ) : (
            <>
              {/* Card previews — real React components */}
              <div className="flex items-start justify-center gap-4">
                <div
                  className={cn("relative", isPoster ? "" : "border")}
                  style={{
                    width: PREV_W, height: PREV_H,
                    borderRadius: isPoster ? 0 : 12,
                    overflow: "hidden", flexShrink: 0,
                    boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
                    ...(!isPoster ? frontBorder : {}),
                  }}
                >
                  <div style={{
                    position: "absolute", top: 0, left: 0,
                    width: SEED_W, height: SEED_H,
                    transformOrigin: "top left",
                    transform: `scale(${PREV_W / SEED_W})`,
                  }}>
                    {isPoster ? (
                      <PosterCardFront ticket={ticket} imageSrc={imageSrc}
                        borderColorHex={ratingStyle.borderColorHex} />
                    ) : (
                      <ClassicCardFront ticket={ticket} imageSrc={imageSrc} />
                    )}
                  </div>
                </div>

                <div style={{
                  width: PREV_W, height: PREV_H,
                  borderRadius: isPoster ? 0 : 12,
                  overflow: "hidden", flexShrink: 0,
                  position: "relative",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
                }}>
                  <div style={{
                    position: "absolute", top: 0, left: 0,
                    width: SEED_W, height: SEED_H,
                    transformOrigin: "top left",
                    transform: `scale(${PREV_W / SEED_W})`,
                  }}>
                    <CardBackFace ticket={ticket} />
                  </div>
                </div>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                {t.saveCardSubdesc}
              </p>

              {error && <p className="text-xs text-center text-destructive">{error}</p>}

              <div className="flex justify-center">
                <button
                  onPointerDown={() => { if (!saving) setPressing(true); }}
                  onPointerUp={() => setPressing(false)}
                  onPointerLeave={() => setPressing(false)}
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 bg-foreground text-background font-semibold text-sm py-3.5 rounded-2xl disabled:opacity-50"
                  style={{
                    transform: pressing ? "scale(0.95)" : "scale(1)",
                    transition: "transform 80ms ease, opacity 150ms",
                  }}
                >
                  {saving
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> {t.savingShort}</>
                    : <>{t.saveBtn}</>}
                </button>
              </div>
            </>
          )}

          {!saved && (
            <div className="flex items-center justify-center gap-3 pb-1">
              <button
                onClick={() => { onClose(); if (onOpenChat) setTimeout(onOpenChat, 150); }}
                className="flex items-center gap-2 border border-border text-foreground text-sm font-medium px-5 py-3 rounded-2xl active:scale-95 hover:bg-secondary transition-all"
              >
                <MessageCircle className="w-4 h-4" />
                {t.sendInChatBtn}
              </button>
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-2 border border-border text-foreground text-sm font-medium px-5 py-3 rounded-2xl active:scale-95 hover:bg-secondary transition-all"
              >
                {linkCopied
                  ? <><Check className="w-4 h-4 text-green-500" /> {t.copiedLabel}</>
                  : <><Link2 className="w-4 h-4" /> {t.copyLinkBtn}</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
