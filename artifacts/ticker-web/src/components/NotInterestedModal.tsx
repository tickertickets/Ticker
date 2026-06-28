import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface NotInterestedModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function NotInterestedModal({ open, onClose, onConfirm }: NotInterestedModalProps) {
  const { t } = useLang();
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    } else {
      setVisible(false);
      const tid = setTimeout(() => setMounted(false), 350);
      return () => clearTimeout(tid);
    }
  }, [open]);

  if (!mounted) return null;

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[80] flex items-end",
        "transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
      )}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className={cn(
          "relative w-full bg-background rounded-t-3xl px-6 pt-5 shadow-xl",
          "transition-transform duration-300 ease-out",
          visible ? "translate-y-0" : "translate-y-full",
        )}
        style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-12 h-1 bg-muted rounded-full mx-auto mb-5" />
        <p className="font-bold text-base text-foreground mb-1">{t.notInterestedModalTitle}</p>
        <p className="text-sm text-muted-foreground mb-6">{t.notInterestedModalDesc}</p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl bg-secondary font-semibold text-sm text-muted-foreground"
          >
            {t.cancelBtn}
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-3 rounded-2xl bg-foreground font-semibold text-sm text-background"
          >
            {t.notInterestedHide}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
