import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { useLang } from "@/lib/i18n";

interface CommunityGuidelinesSheetProps {
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  confirmLabel: string;
}

export function CommunityGuidelinesSheet({
  onClose,
  onConfirm,
  isSubmitting,
  confirmLabel,
}: CommunityGuidelinesSheetProps) {
  const { t, lang } = useLang();
  const lines = t.communityRulesBody.split("\n");

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="fixed bottom-0 z-[9999] flex flex-col overflow-hidden bg-background rounded-t-3xl border-t border-border"
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(100vw, 430px)",
          maxHeight: "92dvh",
          paddingBottom: "max(var(--sai-bottom), 20px)",
          boxShadow: "0 -4px 32px rgba(0,0,0,0.22)",
        }}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        <div className="px-5 pt-3 pb-4 shrink-0">
          <h2 className="font-display font-bold text-base text-foreground mb-2 text-center">
            {t.communityRulesTitle}
          </h2>
          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            {t.communityRulesSubtitle}
          </p>
        </div>

        <div className="mx-5 mb-4 max-h-[40dvh] overflow-y-auto overscroll-contain bg-secondary rounded-2xl px-4 py-3">
          <div>
            {lines.map((line, index) => {
              const trimmed = line.trim();
              if (!trimmed) {
                return <div key={`space-${index}`} className="h-2" aria-hidden="true" />;
              }

              if (/^\d+\.\s/.test(trimmed)) {
                return (
                  <p key={index} className="mt-2 text-center text-sm font-bold leading-snug text-foreground">
                    {trimmed}
                  </p>
                );
              }

              const colonAt = trimmed.indexOf(":");
              if (colonAt > 0 && colonAt < 70) {
                return (
                  <p key={index} className="mt-1.5 text-left text-sm leading-snug text-foreground/80">
                    <span className="font-semibold text-primary">{trimmed.slice(0, colonAt + 1)}</span>
                    {" "}
                    {trimmed.slice(colonAt + 1)}
                  </p>
                );
              }

              return (
                <p key={index} className="mt-1.5 text-left text-sm leading-snug text-foreground/80">
                  {trimmed}
                </p>
              );
            })}
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            {t.communityRulesFootnote}
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {lang === "th"
              ? "ความคิดเห็น การรีวิว และการให้คะแนนเป็นของผู้ใช้แต่ละคน Ticker ขอไม่รับผิดชอบต่อเนื้อหาที่ผู้ใช้สร้างขึ้น"
              : "All reviews, ratings, and opinions are solely those of the users. Ticker is not responsible for user-generated content."}
          </p>
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            {lang === "th"
              ? "⚠️ ภาพโปสเตอร์และภาพประกอบที่เลือกอาจอยู่ภายใต้ลิขสิทธิ์ของบุคคลที่สาม Ticker ไม่ได้เป็นเจ้าของหรืออ้างสิทธิ์ในภาพดังกล่าว และไม่รับผิดชอบต่อการเลือกใช้ภาพของผู้ใช้ หากเจ้าของสิทธิ์ยื่นคำร้อง DMCA Takedown ที่มีมูล ภาพในโพสต์ของคุณอาจถูกนำออกโดยไม่แจ้งล่วงหน้า การกดโพสต์ถือว่าคุณรับทราบและยอมรับเงื่อนไขนี้"
              : "⚠️ Posters and artwork you select may be protected by third-party copyright. Ticker does not own or claim rights to these images and is not responsible for users' choices. If a rights holder submits a valid DMCA takedown, images in your post may be removed without prior notice. By posting, you acknowledge and accept this condition."}
          </p>
        </div>

        <div className="flex gap-2 px-5 shrink-0">
          <button
            onClick={onClose}
            className="flex-1 h-12 rounded-2xl border border-border text-foreground text-sm font-bold"
          >
            {t.communityRulesCancel}
          </button>
          <button
            onClick={() => {
              onClose();
              onConfirm();
            }}
            disabled={isSubmitting}
            className="flex-1 h-12 rounded-2xl bg-foreground text-background text-sm font-bold disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : confirmLabel}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
