import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { useLang } from "@/lib/i18n";

export default function TermsPage() {
  const [, navigate] = useLocation();
  const { lang } = useLang();
  const tr = (th: string, en: string) => (lang === "en" ? en : th);

  return (
    <div className="flex justify-center" style={{ minHeight: "100dvh", background: "var(--app-chrome)" }}>
      <div className="relative w-full max-w-[430px] bg-background flex flex-col" style={{ minHeight: "100dvh" }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pb-4 border-b border-[#f0f0f0] flex-shrink-0" style={{ paddingTop: "max(env(safe-area-inset-top), 12px)" }}>
          <button
            onClick={() => navigate("/")}
            className="w-9 h-9 rounded-full flex items-center justify-center active:opacity-60"
            style={{ background: "#f2f2f7" }}
          >
            <ArrowLeft className="w-4 h-4 text-[#111]" />
          </button>
          <h1 className="font-black text-[17px] text-[#111]">{tr("ข้อกำหนดการให้บริการ", "Terms of Service")}</h1>
        </div>

        {/* Content */}
        <div className="flex-1 px-5 py-6 overflow-y-auto text-[14px] text-[#444] leading-relaxed space-y-5">
          <p className="text-[12px] text-[#aaa]">{tr("อัปเดตล่าสุด: 5 เมษายน 2568", "Last updated: April 5, 2025")}</p>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("1. การยอมรับข้อตกลง", "1. Acceptance of terms")}</h2>
            <p>
              {tr(
                "การใช้งาน Ticker ถือว่าคุณได้อ่านและยอมรับข้อกำหนดการให้บริการฉบับนี้ทุกประการ หากคุณไม่เห็นด้วยกับข้อกำหนดใดๆ โปรดหยุดใช้งานบริการ",
                "By using Ticker, you confirm that you have read and accepted these Terms of Service in full. If you do not agree with any part of the terms, please stop using the service."
              )}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("2. เงื่อนไขการใช้งาน", "2. Conditions of use")}</h2>
            <p>{tr("คุณต้องมีอายุอย่างน้อย 13 ปีบริบูรณ์เพื่อใช้งาน Ticker", "You must be at least 13 years old to use Ticker.")}</p>
            <p>{tr("คุณรับผิดชอบต่อเนื้อหาที่โพสต์และกิจกรรมทั้งหมดในบัญชีของคุณ", "You are responsible for the content you post and all activity in your account.")}</p>
            <p>{tr("ห้ามใช้งานบริการเพื่อวัตถุประสงค์ที่ผิดกฎหมายหรือเป็นอันตราย", "You may not use the service for any unlawful or harmful purpose.")}</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("3. เนื้อหาของผู้ใช้", "3. User content")}</h2>
            <p>
              {tr(
                "เนื้อหาที่คุณโพสต์บน Ticker ยังคงเป็นสิทธิ์ของคุณ แต่คุณมอบสิทธิ์การใช้งานแก่ Ticker เพื่อแสดงและเผยแพร่เนื้อหาภายในบริการ",
                "Content you post on Ticker remains yours, but you grant Ticker a license to display and distribute that content within the service."
              )}
            </p>
            <p>
              {tr(
                "Ticker ขอสงวนสิทธิ์ในการลบเนื้อหาที่ละเมิดข้อกำหนดหรือกฎหมายที่เกี่ยวข้อง",
                "Ticker reserves the right to remove any content that violates these terms or applicable laws."
              )}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("4. ทรัพย์สินทางปัญญา", "4. Intellectual property")}</h2>
            <p>
              {tr(
                "แบรนด์ โลโก้ และซอฟต์แวร์ของ Ticker เป็นทรัพย์สินทางปัญญาของเรา ห้ามทำซ้ำหรือดัดแปลงโดยไม่ได้รับอนุญาต",
                "The Ticker brand, logo, and software are our intellectual property. You may not copy or modify them without permission."
              )}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("5. การระงับบัญชี", "5. Account suspension")}</h2>
            <p>
              {tr(
                "Ticker ขอสงวนสิทธิ์ระงับหรือยกเลิกบัญชีของผู้ใช้ที่ละเมิดข้อกำหนดการให้บริการ โดยไม่จำเป็นต้องแจ้งล่วงหน้า",
                "Ticker may suspend or terminate any account that violates these Terms of Service, without prior notice."
              )}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("6. ข้อจำกัดความรับผิด", "6. Limitation of liability")}</h2>
            <p>
              {tr(
                "Ticker ให้บริการ \"ตามสภาพ\" โดยไม่มีการรับประกันใดๆ เราจะไม่รับผิดชอบต่อความเสียหายที่เกิดจากการใช้งานบริการ",
                "Ticker is provided \"as is\" without any warranty. We are not liable for any damages arising from your use of the service."
              )}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("7. การเปลี่ยนแปลงข้อกำหนด", "7. Changes to the terms")}</h2>
            <p>
              {tr(
                "เราอาจแก้ไขข้อกำหนดการให้บริการนี้ได้ตลอดเวลา การใช้งานต่อไปถือว่าคุณยอมรับข้อกำหนดฉบับที่แก้ไขแล้ว",
                "We may revise these Terms of Service at any time. Continued use of the service means you accept the revised terms."
              )}
            </p>
          </section>

        </div>

        {/* Close button */}
        <div className="px-5 pt-3 pb-5 flex-shrink-0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}>
          <button
            onClick={() => navigate("/")}
            className="w-full h-[52px] rounded-full bg-[#111] text-white font-bold text-[15px] active:opacity-80"
          >
            {tr("ปิด", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
