import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Compass, Search, Plus, Home, User, Ticket, Link2 } from "lucide-react";
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
        style={{ paddingBottom: "var(--sab, env(safe-area-inset-bottom, 0px))", transform: "translateZ(0)" }}
      >
        <div className="flex items-center justify-around px-2 py-2">
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
        <div className="pb-2" />
      </div>
    </>
  );
}

export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  if (!user) return <GuestBottomNav />;

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
        style={{ paddingBottom: "var(--sab, env(safe-area-inset-bottom, 0px))", transform: "translateZ(0)" }}
      >
        <div className="flex items-center justify-around px-2 py-2">
          {navItems.map((item, idx) => {
            if (item === null) {
              return (
                <button
                  key="create"
                  onClick={() => setCreateOpen(v => !v)}
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
    </>
  );
}
