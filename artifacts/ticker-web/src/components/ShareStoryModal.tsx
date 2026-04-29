import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import html2canvas from "html2canvas";
import { X, MessageCircle, Loader2, Link2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang, LangProvider } from "@/lib/i18n";
import { useModalBackButton } from "@/hooks/use-modal-back-button";
import type { Ticket } from "@workspace/api-client-react";
import {
  getRatingCardStyle,
  PosterCardFront,
  ClassicCardFront,
  CardBackFace,
} from "./CardFaceComponents";

// ── Sizes ──────────────────────────────────────────────────────────────────────
const SEED_W = 190;   // card DOM width (px) — matches create-ticket preview seed
const SEED_H = 285;   // card DOM height (px)
const S      = 3;     // html2canvas scale → 480×720 per card
const GAP_W  = 16;    // gap between cards in DOM px (=C_GAP/S rounded)
const PAD_W  = 20;    // outer padding in DOM px

// Preview size inside modal
const PREV_W = 120;
const PREV_H = 180;

// ── Fetch poster as same-origin blob URL ──────────────────────────────────────
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

// ── Convert blob URL → data URL (base64) ─────────────────────────────────────
// html2canvas supports data URLs for both <img> src AND css background-image.
// Blob URLs work for <img> but NOT for css background-image inside html2canvas.
async function blobToDataUrl(blobUrl: string): Promise<string | null> {
  try {
    const res  = await fetch(blobUrl);
    const blob = await res.blob();
    return await new Promise<string>(resolve => {
      const reader    = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ── Capture the actual React components with html2canvas ─────────────────────
async function buildCombinedPng(
  ticket: Ticket,
  dataUrl: string | null,   // base64 data URL of the poster image
  ratingType: string,
): Promise<Blob> {
  const t        = ticket as unknown as Record<string, unknown>;
  const isPoster = (t["cardTheme"] as string | undefined) === "poster";
  const rStyle   = getRatingCardStyle(ticket.rating, ratingType);
  const radius   = isPoster ? 0 : 12;

  // Hidden wrapper: positioned AT the viewport (top:0,left:0) but behind all content
  // z-index:-1 hides it from the user while html2canvas can still capture it.
  // Keeping it IN the viewport is critical — elements outside the viewport cause
  // html2canvas to mis-compute layout (overflow clips, absolute positions, etc.)
  const wrap = document.createElement("div");
  wrap.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "z-index:-1",
    "pointer-events:none",
    `padding:${PAD_W}px`,
    `gap:${GAP_W}px`,
    "display:flex",
    "align-items:flex-start",
    "background:transparent",
  ].join(";");
  document.body.appendChild(wrap);

  const root = createRoot(wrap);
  root.render(
    <LangProvider>
      {/* Front face */}
      <div style={{
        width: SEED_W, height: SEED_H, flexShrink: 0,
        overflow: "hidden", borderRadius: radius,
        position: "relative",
      }}>
        {isPoster ? (
          <PosterCardFront
            ticket={ticket}
            imageSrc={dataUrl}
            borderColorHex={rStyle.borderColorHex}
          />
        ) : (
          <ClassicCardFront ticket={ticket} imageSrc={dataUrl} />
        )}
      </div>

      {/* Back face */}
      <div style={{
        width: SEED_W, height: SEED_H, flexShrink: 0,
        overflow: "hidden", borderRadius: radius,
        position: "relative",
      }}>
        <CardBackFace ticket={ticket} />
      </div>
    </LangProvider>,
  );

  // Wait for React to commit + all <img> to load/decode + fonts.
  await new Promise<void>(r => setTimeout(r, 80));
  const imgs = Array.from(wrap.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise<void>(r => {
      const done = () => r();
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
      setTimeout(done, 2_500);
    });
  }));
  await Promise.all(imgs.map(img => img.decode?.().catch(() => undefined)));
  await document.fonts.ready;
  await new Promise<void>(r => requestAnimationFrame(() => r()));

  // ── Capture ──────────────────────────────────────────────────────────────
  // Two html2canvas modes:
  //
  //   • foreignObjectRendering: true  → uses <foreignObject> in SVG. Renders
  //     text/CSS perfectly on Android/Chrome but iOS WebKit refuses to paint
  //     <img> / background-image inside foreignObject (transparent image area).
  //
  //   • foreignObjectRendering: false → uses html2canvas's own DOM-walking
  //     rasterizer. Paints images correctly on every browser including iOS,
  //     and respects the actual rendered borders / radii / outlines pixel-
  //     perfectly (no compositing math required).
  //
  // We use the rasterizer on iOS so the image ALWAYS sits inside the rendered
  // frame, and foreignObject elsewhere so text rendering stays crisp.
  //
  // The rasterizer mis-handles `display: -webkit-box` + `-webkit-line-clamp`
  // on iOS (clips at half-letter height), so we pre-rewrite line-clamp into
  // an explicit `max-height` block — the rasterizer renders that correctly.
  if (isIOS()) {
    const neutralizeLineClamp = (el: HTMLElement) => {
      const cs = el.style;
      const lineClampStr = cs.webkitLineClamp;
      if (cs.display !== "-webkit-box" && !lineClampStr) return;

      const lines = Math.max(1, parseInt(lineClampStr || "1", 10) || 1);
      const computed = window.getComputedStyle(el);
      const fontSize = parseFloat(computed.fontSize) || 16;
      const lhRaw    = computed.lineHeight;
      const lineHeight =
        !lhRaw || lhRaw === "normal" ? fontSize * 1.2 : parseFloat(lhRaw);

      cs.display         = "block";
      cs.webkitLineClamp = "";
      cs.webkitBoxOrient = "";
      cs.maxHeight       = `${Math.ceil(lineHeight * lines) + 2}px`;
      cs.overflow        = "hidden";
    };

    for (const el of Array.from(wrap.querySelectorAll<HTMLElement>("*"))) {
      neutralizeLineClamp(el);
    }
  }

  const canvas = await html2canvas(wrap, {
    scale: S,
    useCORS: true,
    allowTaint: true,
    backgroundColor: null,
    logging: false,
    foreignObjectRendering: !isIOS(),
  });

  root.unmount();
  document.body.removeChild(wrap);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/png",
    );
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
interface ShareStoryModalProps {
  ticket: Ticket;
  onClose: () => void;
  onOpenChat?: () => void;
}

export function ShareStoryModal({ ticket, onClose, onOpenChat }: ShareStoryModalProps) {
  const { t } = useLang();
  const tk         = ticket as unknown as Record<string, unknown>;
  const isPoster   = (tk["cardTheme"] as string | undefined) === "poster";
  const ratingType = (tk["ratingType"] as string | undefined) ?? "star";

  const rawImageUrl = isPoster
    ? ((tk["cardBackdropUrl"] as string | null | undefined) ?? ticket.posterUrl ?? null)
    : (ticket.posterUrl ?? null);

  const [imageSrc,   setImageSrc]   = useState<string | null>(null);
  const [dataUrl,    setDataUrl]    = useState<string | null>(null);
  const [visible,    setVisible]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [pressing,   setPressing]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  useModalBackButton(onClose);

  const dataUrlRef = useRef<string | null>(null);
  useEffect(() => { dataUrlRef.current = dataUrl; }, [dataUrl]);

  // Slide-in animation
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

  // Pre-fetch image:
  //   1. blob URL → used instantly for the live preview in the modal
  //   2. convert to data URL → used at save time (works with html2canvas)
  useEffect(() => {
    if (!rawImageUrl) return;
    let dead = false;
    (async () => {
      const blob = await fetchBlob(rawImageUrl);
      if (dead || !blob) return;
      setImageSrc(prev => { if (prev) URL.revokeObjectURL(prev); return blob; });

      const data = await blobToDataUrl(blob);
      if (dead || !data) return;
      setDataUrl(data);
    })();
    return () => { dead = true; };
  }, [rawImageUrl]);

  useEffect(() => () => { if (imageSrc) URL.revokeObjectURL(imageSrc); }, [imageSrc]);

  // iOS-only fallback: open the rendered image in a new tab so the user can
  // long-press → "Save to Photos". Apple's WebKit forbids direct downloads to
  // Photos from the web, so this is the only reliable path on older iOS that
  // can't share Files via navigator.share.
  const [iosLongPressUrl, setIosLongPressUrl] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Use already-prepared data URL; if not ready yet, build it now
      let du = dataUrlRef.current;
      if (!du && rawImageUrl) {
        const blob = await fetchBlob(rawImageUrl);
        if (blob) du = await blobToDataUrl(blob);
      }

      const blob     = await buildCombinedPng(ticket, du, ratingType);
      const filename = `ticker-${(ticket.movieTitle ?? "card").replace(/\s+/g, "-")}.png`;

      if (isIOS()) {
        // iOS path — ALWAYS show the rendered image inline so the user can
        // long-press → "Add to Photos". We deliberately do NOT call
        // navigator.share here, because the iOS share sheet exposes
        // unwanted "Copy / Save File / Delete File" options that confuse
        // users. Long-press on the inline image gives the cleanest UX:
        // a single "Add to Photos" / "Save Image" choice.
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
  }, [ticket, onClose, rawImageUrl, ratingType, t.errSaveCardFailed]);

  // Cleanup the long-press blob URL when the modal closes
  useEffect(() => () => {
    if (iosLongPressUrl) URL.revokeObjectURL(iosLongPressUrl);
  }, [iosLongPressUrl]);

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
            // "Add to Photos" from the iOS context menu. This is the only way
            // to save to Photos on older iOS Safari versions that don't support
            // navigator.share with files.
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
