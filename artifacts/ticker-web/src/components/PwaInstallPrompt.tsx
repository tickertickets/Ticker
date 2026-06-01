import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { Download, X } from "lucide-react";

const STORAGE_KEY = "pwa_install_dismissed_v1";

function isDismissed(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}
function setDismissed() {
  try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
}
function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

export function PwaInstallPrompt() {
  const { t } = useLang();
  const [prompt, setPrompt] = useState<Event | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone() || isDismissed()) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!show || !prompt) return null;

  const handleInstall = async () => {
    const p = prompt as any;
    p.prompt?.();
    const result = await p.userChoice?.catch?.(() => null);
    if (result?.outcome === "accepted" || !result) setDismissed();
    setShow(false);
  };

  const handleDismiss = () => {
    setDismissed();
    setShow(false);
  };

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-[390px] animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-background border border-border rounded-2xl shadow-xl p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-foreground flex items-center justify-center flex-shrink-0">
          <span className="font-display font-bold text-background text-sm">T</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground leading-tight">{t.pwaInstallTitle}</p>
          <p className="text-xs text-muted-foreground leading-snug mt-0.5">{t.pwaInstallBody}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleInstall}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-foreground text-background text-xs font-bold active:opacity-70 transition-opacity"
          >
            <Download className="w-3 h-3" />
            {t.pwaInstallBtn}
          </button>
          <button
            onClick={handleDismiss}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground active:opacity-70 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
