import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { useLang } from "@/lib/i18n";

export default function PrivacyPage() {
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
          <h1 className="font-black text-[17px] text-[#111]">{tr("นโยบายความเป็นส่วนตัว", "Privacy Policy")}</h1>
        </div>

        {/* Content */}
        <div className="flex-1 px-5 py-6 overflow-y-auto text-[14px] text-[#444] leading-relaxed space-y-5">
          <p className="text-[12px] text-[#aaa]">{tr("อัปเดตล่าสุด: 5 เมษายน 2568", "Last updated: April 5, 2025")}</p>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("1. ข้อมูลที่เรารวบรวม", "1. Information we collect")}</h2>
            <p>{tr("เราเก็บข้อมูลที่คุณให้โดยตรง ได้แก่:", "We collect the information you give us directly, including:")}</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>{tr("ชื่อผู้ใช้ ชื่อที่แสดง และอีเมล", "Username, display name, and email")}</li>
              <li>{tr("วันเกิด (เพื่อยืนยันอายุ)", "Date of birth (for age verification)")}</li>
              <li>{tr("เนื้อหาที่คุณโพสต์ เช่น รีวิว คะแนน และความคิดเห็น", "Content you post, such as reviews, ratings, and comments")}</li>
              <li>{tr("ข้อมูลการใช้งาน เช่น ภาพยนตร์ที่ดูและบันทึก", "Usage data, such as the movies you watch and save")}</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("2. การใช้ข้อมูล", "2. How we use your information")}</h2>
            <p>{tr("เราใช้ข้อมูลของคุณเพื่อ:", "We use your information to:")}</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>{tr("ให้บริการและปรับปรุงแพลตฟอร์ม", "Provide and improve the platform")}</li>
              <li>{tr("แสดงเนื้อหาที่ตรงกับความสนใจ", "Show content that matches your interests")}</li>
              <li>{tr("ติดต่อคุณเกี่ยวกับบัญชีหรือการอัปเดต", "Contact you about your account or updates")}</li>
              <li>{tr("ป้องกันการละเมิดและการฉ้อโกง", "Prevent abuse and fraud")}</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("3. การแชร์ข้อมูล", "3. Sharing your information")}</h2>
            <p>
              {tr(
                "เราไม่ขายข้อมูลส่วนตัวของคุณ เราอาจแชร์ข้อมูลกับผู้ให้บริการที่ช่วยเราดำเนินการแพลตฟอร์ม ซึ่งมีข้อผูกมัดในการปกป้องข้อมูลของคุณ",
                "We do not sell your personal information. We may share data with service providers that help us operate the platform, who are obligated to protect your information."
              )}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("4. ความปลอดภัยของข้อมูล", "4. Data security")}</h2>
            <p>
              {tr(
                "เราใช้มาตรการรักษาความปลอดภัยมาตรฐานอุตสาหกรรมเพื่อปกป้องข้อมูลของคุณ แม้เราจะพยายามอย่างเต็มที่ แต่ไม่มีระบบใดที่ปลอดภัย 100%",
                "We use industry-standard security measures to protect your data. While we do our best, no system is ever 100% secure."
              )}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("5. ข้อมูลวันเกิด", "5. Date of birth")}</h2>
            <p>
              {tr(
                "วันเกิดของคุณใช้เพื่อยืนยันว่าคุณมีอายุครบ 13 ปีเท่านั้น เราจะไม่เปิดเผยข้อมูลนี้แก่บุคคลภายนอก",
                "Your date of birth is used only to confirm that you are at least 13 years old. We will not share it with any third party."
              )}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("6. สิทธิ์ของคุณ", "6. Your rights")}</h2>
            <p>{tr("คุณมีสิทธิ์:", "You have the right to:")}</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>{tr("เข้าถึงและแก้ไขข้อมูลส่วนตัว", "Access and update your personal information")}</li>
              <li>{tr("ขอลบบัญชีและข้อมูลของคุณ", "Request deletion of your account and data")}</li>
              <li>{tr("ปฏิเสธการรับการแจ้งเตือน", "Opt out of notifications")}</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-[15px] text-[#111]">{tr("7. การเปลี่ยนแปลงนโยบาย", "7. Changes to this policy")}</h2>
            <p>
              {tr(
                "เราอาจอัปเดตนโยบายความเป็นส่วนตัวนี้ การใช้งานต่อไปหลังจากการอัปเดตถือว่าคุณยอมรับนโยบายที่แก้ไขแล้ว",
                "We may update this Privacy Policy. Continued use of the service after an update means you accept the revised policy."
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
