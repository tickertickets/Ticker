import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Link, useLocation } from "wouter";
import { Compass, Search, Plus, Home, User, Ticket, Link2, Disc3, ListMusic } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useLang } from "@/lib/i18n";

function GuestAuthMenu({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const { t } = useLang();
  return (
    <>
      <div
        className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="fixed z-[100] bottom-[68px] bg-background rounded-3xl border border-border shadow-2xl overflow-hidden"
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(calc(100% - 32px), 398px)",
        }}
      >
        <div className="pt-2" />
        <button
          onClick={() => { onClose(); navigate("/join"); }}
          className="w-full flex items-center gap-4 px-4 py-4 transition-all active:scale-[0.97] active:bg-secondary"
        >
          <div className="w-12 h-12 rounded-2xl bg-secondary border border-border flex items-center justify-center flex-shrink-0 shadow-sm">
            <User className="w-6 h-6 text-foreground" />
          </div>
          <div className="text-left">
            <p className="font-bold text-sm text-foreground">{t.signupMenuTitle}</p>
            <p className="text-xs text-muted-foreground">{t.signupMenuDesc}</p>
          </div>
        </button>
        <div className="mx-4 h-px bg-border" />
        <button
          onClick={() => { onClose(); navigate("/login"); }}
          className="w-full flex items-center gap-4 px-4 py-4 transition-all active:scale-[0.97] active:bg-secondary"
        >
          <div className="w-12 h-12 rounded-2xl bg-secondary border border-border flex items-center justify-center flex-shrink-0 shadow-sm">
            <Compass className="w-6 h-6 text-foreground" />
          </div>
          <div className="text-left">
            <p className="font-bold text-sm text-foreground">{t.loginMenuTitle}</p>
            <p className="text-xs text-muted-foreground">{t.loginMenuDesc}</p>
          </div>
        </button>
        <div className="pb-2" />
      </div>
    </>
  );
}

function GuestBottomNav() {
  const [location] = useLocation();
  const [authOpen, setAuthOpen] = useState(false);
  return (
    <>
      {authOpen && <GuestAuthMenu onClose={() => setAuthOpen(false)} />}
      <div
        className="shrink-0 bg-background border-t border-border"
        style={{ paddingBottom: "max(var(--sai-bottom), 8px)", transform: "translateZ(0)" }}
      >
        <div className="flex items-center justify-around px-2 pt-2">
          {[{ href: "/", icon: Home }, { href: "/search", icon: Search }].map(item => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="outline-none flex-1 flex justify-center"
                onClick={(e) => {
                  if (isActive) {
                    e.preventDefault();
                    window.dispatchEvent(new CustomEvent("nav-refresh", { detail: { href: item.href } }));
                  }
                }}
              >
                <div className="flex items-center justify-center p-3">
                  <item.icon
                    className={cn("w-6 h-6 transition-all", isActive ? "text-foreground" : "text-muted-foreground")}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                </div>
              </Link>
            );
          })}
          <button
            onClick={() => setAuthOpen(v => !v)}
            className="outline-none flex-1 flex justify-center"
          >
            <div className={cn(
              "w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm transition-all duration-200",
              authOpen ? "bg-zinc-700 rotate-45" : "bg-foreground"
            )}>
              <Plus className="w-5 h-5 text-background" strokeWidth={2.5} />
            </div>
          </button>
          {[Compass, User].map((Icon, i) => (
            <div key={i} className="flex-1 flex justify-center pointer-events-none select-none">
              <div className="flex items-center justify-center p-3">
                <Icon className="w-6 h-6 text-muted-foreground/25" strokeWidth={2} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function CreateMenu({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const { t, lang } = useLang();
  return (
    <>
      <div
        className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="fixed z-[100] bottom-[68px] bg-background rounded-3xl border border-border shadow-2xl overflow-hidden"
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(calc(100% - 32px), 398px)",
        }}
      >
        <div className="pt-2" />
        <button
          onClick={() => { onClose(); navigate("/ticket/new"); }}
          className="w-full flex items-center gap-4 px-4 py-4 transition-all active:scale-[0.97] active:bg-secondary"
        >
          <div className="w-12 h-12 rounded-2xl bg-secondary border border-border flex items-center justify-center flex-shrink-0 shadow-sm">
            <Ticket className="w-6 h-6 text-foreground" />
          </div>
          <div className="text-left">
            <p className="font-bold text-sm text-foreground">{t.postTicketBtn}</p>
            <p className="text-xs text-muted-foreground">{t.createTicketMenuDesc}</p>
          </div>
        </button>
        <div className="mx-4 h-px bg-border" />
        <button
          onClick={() => { onClose(); navigate("/chain/new"); }}
          className="w-full flex items-center gap-4 px-4 py-4 transition-all active:scale-[0.97] active:bg-secondary"
        >
          <div className="w-12 h-12 rounded-2xl bg-secondary border border-border flex items-center justify-center flex-shrink-0 shadow-sm">
            <Link2 className="w-6 h-6 text-foreground" />
          </div>
          <div className="text-left">
            <p className="font-bold text-sm text-foreground">{t.createChainTitle}</p>
            <p className="text-xs text-muted-foreground">{t.createChainMenuDesc}</p>
          </div>
        </button>
        <div className="mx-4 h-px bg-border" />
        <button
          onClick={() => { onClose(); navigate("/vinyl/new"); }}
          className="w-full flex items-center gap-4 px-4 py-4 transition-all active:scale-[0.97] active:bg-secondary"
        >
          <div className="w-12 h-12 rounded-full bg-secondary border border-border flex items-center justify-center flex-shrink-0 shadow-sm">
            <Disc3 className="w-6 h-6 text-foreground" />
          </div>
          <div className="text-left">
            <p className="font-bold text-sm text-foreground">{lang === "th" ? "โพสต์ Vinyl" : "Post a Vinyl"}</p>
            <p className="text-xs text-muted-foreground">{lang === "th" ? "บันทึกเพลงที่คุณฟัง" : "Save a song you love"}</p>
          </div>
        </button>
        <div className="mx-4 h-px bg-border" />
        <button
          onClick={() => { onClose(); navigate("/playlist/new"); }}
          className="w-full flex items-center gap-4 px-4 py-4 transition-all active:scale-[0.97] active:bg-secondary"
        >
          <div className="w-12 h-12 rounded-2xl bg-secondary border border-border flex items-center justify-center flex-shrink-0 shadow-sm">
            <ListMusic className="w-6 h-6 text-foreground" />
          </div>
          <div className="text-left">
            <p className="font-bold text-sm text-foreground">{lang === "th" ? "สร้าง Playlist" : "Create a Playlist"}</p>
            <p className="text-xs text-muted-foreground">{lang === "th" ? "รวมเพลงที่ชอบไว้ด้วยกัน" : "Collect songs together"}</p>
          </div>
        </button>
        <div className="pb-2" />
      </div>
    </>
  );
}

export function BottomNav() {
  const [location, navigate] = useLocation();
  const { user } = useAuth();
  const { lang } = useLang();
  const [createOpen, setCreateOpen] = useState(false);
  const [dragPreview, setDragPreview] = useState<{
    x: number;
    y: number;
    overProfile: boolean;
    frame: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const gestureRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);

  const movieMatch = location.split("?")[0]?.match(/^\/movie\/(.+)\/?$/);
  let movieId: string | null = null;
  if (movieMatch?.[1]) {
    try { movieId = decodeURIComponent(movieMatch[1].replace(/\/$/, "")); }
    catch { movieId = movieMatch[1].replace(/\/$/, ""); }
  }
  const musicMatch = location.split("?")[0]?.match(/^\/music\/song\/([^/]+)\/?$/);
  let musicTrackId: string | null = null;
  if (musicMatch?.[1]) {
    try { musicTrackId = decodeURIComponent(musicMatch[1].replace(/\/$/, "")); }
    catch { musicTrackId = musicMatch[1].replace(/\/$/, ""); }
  }

  useEffect(() => () => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
  }, []);

  if (!user) return <GuestBottomNav />;

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const getDragFrame = () => {
    const app = document.querySelector<HTMLElement>("[data-app-drag-bounds]");
    const rect = app?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  };

  const constrainDragPoint = (x: number, y: number, frame: { left: number; top: number; width: number; height: number }) => {
    // Keep the entire 56px drag affordance inside the app shell, including
    // when the pointer moves into the letterboxed area around the 430px app.
    const inset = 32;
    return {
      x: Math.min(Math.max(x, frame.left + inset), frame.left + frame.width - inset),
      y: Math.min(Math.max(y, frame.top + inset), frame.top + frame.height - inset),
    };
  };

  const handlePlusPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!movieId && !musicTrackId) return;
    clearHoldTimer();
    gestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
    const startX = event.clientX;
    const startY = event.clientY;
    holdTimerRef.current = window.setTimeout(() => {
      if (!gestureRef.current || gestureRef.current.moved) return;
      draggingRef.current = true;
      const frame = getDragFrame();
      const point = constrainDragPoint(startX, startY, frame);
      setDragPreview({ ...point, frame, overProfile: false });
    }, 450);
  };

  const handlePlusPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!draggingRef.current) {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) {
        gesture.moved = true;
        clearHoldTimer();
      }
      return;
    }
    event.preventDefault();
    const frame = getDragFrame();
    const point = constrainDragPoint(event.clientX, event.clientY, frame);
    const target = document.elementFromPoint(point.x, point.y);
    setDragPreview({
      ...point,
      frame,
      overProfile: !!target?.closest("[data-movie-profile-dropzone], [data-music-profile-dropzone]"),
    });
  };

  const handlePlusPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    clearHoldTimer();
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;

    if (!draggingRef.current) return;
    draggingRef.current = false;
    suppressClickRef.current = true;
    const frame = getDragFrame();
    const point = constrainDragPoint(event.clientX, event.clientY, frame);
    const target = document.elementFromPoint(point.x, point.y);
    const droppedOnMovie = !!target?.closest("[data-movie-profile-dropzone]");
    const droppedOnMusic = !!target?.closest("[data-music-profile-dropzone]");
    setDragPreview(null);
    if (droppedOnMovie && movieId) {
      setCreateOpen(false);
      navigate(`/ticket/new?movieId=${encodeURIComponent(movieId)}`);
    } else if (droppedOnMusic && musicTrackId) {
      setCreateOpen(false);
      navigate(`/vinyl/new?track=${encodeURIComponent(musicTrackId)}`);
    }
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  };

  const handlePlusPointerCancel = () => {
    clearHoldTimer();
    gestureRef.current = null;
    draggingRef.current = false;
    setDragPreview(null);
  };

  const navItems = [
    { href: "/", icon: Home },
    { href: "/search", icon: Search },
    null,
    { href: "/following", icon: Compass },
    { href: user ? `/profile/${user.username}` : "/", icon: User },
  ];

  return (
    <>
      {createOpen && <CreateMenu onClose={() => setCreateOpen(false)} />}
      <nav
        className="shrink-0 bg-background border-t border-border"
        style={{ paddingBottom: "max(var(--sai-bottom), 8px)", transform: "translateZ(0)" }}
      >
        <div className="flex items-center justify-around px-2 pt-2">
          {navItems.map((item, idx) => {
            if (item === null) {
              return (
                <button
                  key="create"
                  onClick={(event) => {
                    if (suppressClickRef.current) {
                      event.preventDefault();
                      suppressClickRef.current = false;
                      return;
                    }
                    setCreateOpen(v => !v);
                  }}
                  onPointerDown={handlePlusPointerDown}
                  onPointerMove={handlePlusPointerMove}
                  onPointerUp={handlePlusPointerUp}
                  onPointerCancel={handlePlusPointerCancel}
                   style={{ touchAction: movieId || musicTrackId ? "none" : "auto" }}
                  className="outline-none flex-1 flex justify-center"
                >
                  <div className={cn(
                    "w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm transition-all duration-200",
                    createOpen ? "bg-zinc-700 rotate-45" : "bg-foreground"
                  )}>
                    <Plus className="w-5 h-5 text-background" strokeWidth={2.5} />
                  </div>
                </button>
              );
            }

            const isActive =
              location === item.href ||
              (item.href !== "/" && location.startsWith(item.href));

            return (
              <Link
                key={idx}
                href={item.href}
                className="outline-none flex-1 flex justify-center"
                onClick={(e) => {
                  if (isActive) {
                    e.preventDefault();
                    window.dispatchEvent(new CustomEvent("nav-refresh", { detail: { href: item.href } }));
                  }
                }}
              >
                <div className="flex items-center justify-center p-3">
                  <item.icon
                    className={cn(
                      "w-6 h-6 transition-all duration-200",
                      isActive ? "text-foreground" : "text-muted-foreground"
                    )}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </nav>
      {dragPreview && createPortal(
        <div className="fixed inset-0 z-[200] pointer-events-none" aria-live="polite">
          <div
            className="fixed flex flex-col items-center"
            style={{ left: dragPreview.x, top: dragPreview.y, transform: "translate(-50%, -50%)" }}
          >
            <div className={cn(
              "w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl ring-4 transition-colors",
              dragPreview.overProfile
                ? "bg-foreground text-background ring-foreground/20"
                : "bg-zinc-700 text-white ring-white/20"
            )}>
              <Plus className="w-6 h-6" strokeWidth={2.5} />
            </div>
          </div>
          <div
            className="fixed pointer-events-none px-4"
            style={{
              left: dragPreview.frame.left + dragPreview.frame.width / 2,
              top: dragPreview.frame.top + 12,
              width: Math.max(0, dragPreview.frame.width - 32),
              transform: "translateX(-50%)",
            }}
          >
            <span className="block rounded-full bg-black/80 px-3 py-1 text-center text-xs font-semibold text-white">
              {movieId
                ? (lang === "th" ? "ปล่อยเพื่อสร้าง Ticket" : "Release to create a Ticket")
                : (lang === "th" ? "ปล่อยเพื่อสร้าง Vinyl" : "Release to create a Vinyl")}
            </span>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
