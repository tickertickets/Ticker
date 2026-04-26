import type { Lang } from "@/lib/i18n";

/**
 * Translates the body of a system-generated notification based on its `type`,
 * regardless of what language the backend originally stored. For unknown types
 * (e.g. `admin_message`, which is composed by an admin and intentionally kept
 * verbatim) we fall back to the message stored on the row.
 */
export function getNotifText(type: string, lang: Lang, fallback: string): string {
  const th = lang === "th";
  switch (type) {
    case "follow":
      return th ? "เริ่มติดตามคุณแล้ว" : "started following you";
    case "follow_request":
      return th ? "ส่งคำขอติดตามคุณ" : "requested to follow you";
    case "like":
      return th ? "กดถูกใจตั๋วของคุณ" : "liked your ticket";
    case "comment":
      return th ? "คอมเมนต์ตั๋วของคุณ" : "commented on your ticket";
    case "tag":
      return th ? "แท็กคุณในการ์ด" : "tagged you in a ticket";
    case "ticket_share":
      return th ? "แชร์ตั๋วถึงคุณ" : "shared a ticket with you";
    case "party_invite":
      return th ? "ชวนคุณเข้าร่วมปาร์ตี้ดูหนัง" : "invited you to a movie party";
    case "party_color_unlock":
      return th
        ? "ปลดล็อกสีพิเศษ! ทุกคนในปาร์ตี้ยืนยันแล้ว 🎉"
        : "Party color unlocked! Everyone confirmed 🎉";
    case "party_color_reverted":
      return th
        ? "สีปาร์ตี้ถูกรีเซ็ตกลับสู่สถานะปกติ"
        : "Party color was reverted";
    case "memory_request":
      return th ? "ขอดูความทรงจำส่วนตัวในการ์ดของคุณ" : "requested to read your memory";
    case "memory_approved":
      return th
        ? "อนุมัติคำขอดูความทรงจำแล้ว คุณสามารถอ่านได้ภายใน 7 วัน"
        : "approved your memory request — you can read it within 7 days";
    case "supporter_approved":
      return th
        ? "คำขอ Supporter Badge ของคุณได้รับการอนุมัติแล้ว! ขอบคุณที่สนับสนุน Ticker"
        : "Your Supporter Badge request was approved! Thanks for supporting Ticker";
    case "page_verified_approved":
      return th
        ? "คำขอ Badge ถังป็อปคอร์น (ยืนยันเพจ) ได้รับการอนุมัติแล้ว!"
        : "Your Popcorn Bucket (Page Verification) request was approved!";
    case "chain_continued":
      return th ? `เพิ่มหนังใน Chain "${fallback}"` : `added a movie to your Chain "${fallback}"`;
    case "chain_run_started":
      return th ? `เริ่มดู Chain "${fallback}" แล้ว` : `started running your Chain "${fallback}"`;
    default:
      // admin_message and any future type we don't recognize: keep the
      // server-supplied text as-is (admin types it themselves).
      return fallback;
  }
}
