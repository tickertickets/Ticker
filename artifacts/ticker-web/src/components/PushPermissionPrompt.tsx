import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLang } from "@/lib/i18n";
import { isPushSupported, enablePushNotifications, getPushStatus, describePushError } from "@/lib/push";
import { Bell } from "lucide-react";

const STORAGE_KEY = "push_prompt_decided_v1";

function getDecidedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function markDecided(userId: string) {
  const s = getDecidedSet();
  s.add(userId);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(s)));
  } catch { /* ignore */ }
}

export function PushPermissionPrompt() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (!isPushSupported()) return;

    // Browser-level permission already decided → never prompt
    if (Notification.permission !== "default") return;

    // This user already saw the modal in this browser
    if (getDecidedSet().has(user.id)) return;

    // If they're already subscribed on the server (e.g. from another device
    // shared in this browser), don't prompt either.
    let cancelled = false;
    (async () => {
      // If the browser already has notification permission, ALWAYS re-sync
      // the current OS-level subscription endpoint with the server on app
      // open. Chrome on Android silently rotates the FCM endpoint behind
      // an existing PushSubscription (after Doze, network changes, FCM
      // token refresh, or when Chrome is force-stopped before the SW can
      // dispatch `pushsubscriptionchange`). When that happens, the server
      // keeps trying the old endpoint, gets 410 Gone, deletes the row,
      // and notifications go silent forever — even though everything
      // looks fine to the user. Calling enablePushNotifications() is
      // idempotent (upsert by endpoint) and cheap; running it on every
      // mount is the only way to reliably keep the server in sync with
      // what the browser is currently using.
      if (Notification.permission === "granted") {
        try {
          await enablePushNotifications();
        } catch { /* ignore — best-effort sync */ }
        if (!cancelled) markDecided(user.id);
        return;
      }
      // Permission still "default" → check if another browser/device
      // already enabled push for this account; if so, skip the modal.
      const { enabled } = await getPushStatus();
      if (cancelled) return;
      if (enabled) {
        markDecided(user.id);
        return;
      }
      // Small delay so the modal doesn't pop the moment the feed renders
      setTimeout(() => { if (!cancelled) setOpen(true); }, 1200);
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  if (!open || !user) return null;

  const dismiss = () => {
    markDecided(user.id);
    setOpen(false);
  };

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await enablePushNotifications();
      if (!r.ok) {
        // Surface the real reason instead of leaving the modal stuck.
        alert(describePushError(r.reason, lang));
      }
    } finally {
      markDecided(user.id);
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-[420px] bg-background rounded-t-3xl sm:rounded-3xl border-t border-border sm:border p-6 pb-8 shadow-xl animate-in slide-in-from-bottom-4 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-foreground flex items-center justify-center">
            <Bell className="w-7 h-7 text-background" strokeWidth={2.2} />
          </div>
          <h2 className="font-display font-bold text-xl text-foreground">
            {t.pushPromptTitle}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed px-2">
            {t.pushPromptBody}
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="w-full h-12 rounded-full bg-foreground text-background font-semibold text-sm disabled:opacity-60 active:scale-[0.98] transition-transform"
          >
            {t.pushPromptEnable}
          </button>
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="w-full h-12 rounded-full text-muted-foreground font-medium text-sm hover:text-foreground transition-colors"
          >
            {t.pushPromptLater}
          </button>
        </div>
      </div>
    </div>
  );
}
