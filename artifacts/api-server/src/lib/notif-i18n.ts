import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

export type Lang = "th" | "en";

function normalize(v: string | null | undefined): Lang {
  return v === "th" ? "th" : "en";
}

export async function getUserLang(userId: string): Promise<Lang> {
  try {
    const [row] = await db
      .select({ lang: usersTable.preferredLang })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    return normalize(row?.lang);
  } catch {
    return "en";
  }
}

export async function getUserLangs(userIds: string[]): Promise<Map<string, Lang>> {
  const out = new Map<string, Lang>();
  if (userIds.length === 0) return out;
  try {
    const rows = await db
      .select({ id: usersTable.id, lang: usersTable.preferredLang })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));
    for (const r of rows) out.set(r.id, normalize(r.lang));
  } catch { /* ignore */ }
  for (const id of userIds) if (!out.has(id)) out.set(id, "en");
  return out;
}

/** Sender-name-aware push titles, translated by recipient lang. */
export function pushTitleFor(opts: { lang: Lang; type: string; senderName: string }): string {
  const { lang, type, senderName: name } = opts;
  const th = lang === "th";
  switch (type) {
    case "like":              return th ? `${name} ถูกใจตั๋วของคุณ` : `${name} liked your ticket`;
    case "comment":           return th ? `${name} คอมเมนต์ตั๋วของคุณ` : `${name} commented on your ticket`;
    case "follow":            return th ? `${name} เริ่มติดตามคุณ` : `${name} started following you`;
    case "follow_request":    return th ? `${name} ส่งคำขอติดตาม` : `${name} requested to follow you`;
    case "tag":               return th ? `${name} แท็กคุณ` : `${name} tagged you`;
    case "ticket_share":      return th ? `${name} แชร์ตั๋วถึงคุณ` : `${name} shared a ticket with you`;
    case "party_invite":      return th ? `${name} ส่งคำเชิญปาร์ตี้` : `${name} sent a party invite`;
    case "party_color_unlock":   return th ? "ปลดล็อกสีปาร์ตี้!" : "Party color unlocked!";
    case "party_color_reverted": return th ? "สีปาร์ตี้ถูกรีเซ็ต" : "Party color was reverted";
    case "memory_request":    return th ? `${name} ขอดูความทรงจำ` : `${name} wants to read your memory`;
    case "memory_approved":   return th ? `${name} อนุมัติคำขอแล้ว` : `${name} approved your memory request`;
    case "supporter_approved":return th ? "Supporter Badge อนุมัติแล้ว" : "Supporter Badge approved";
    case "chain_continued":   return th ? `${name} ต่อ Chain ของคุณ` : `${name} added to your Chain`;
    case "chain_run_started": return th ? `${name} เริ่มรัน Chain ของคุณ` : `${name} started your Chain`;
    case "admin_message":     return "Ticker";
    default:                  return "Ticker";
  }
}

/** Translated push body (used when we don't want to send raw DB prose). */
export function pushBodyFor(opts: { lang: Lang; type: string }): string | null {
  const th = opts.lang === "th";
  switch (opts.type) {
    case "like":              return th ? "กดถูกใจตั๋วของคุณ" : "liked your ticket";
    case "comment":           return th ? "คอมเมนต์ตั๋วของคุณ" : "commented on your ticket";
    case "follow":            return th ? "เริ่มติดตามคุณแล้ว" : "started following you";
    case "follow_request":    return th ? "ส่งคำขอติดตามคุณ" : "requested to follow you";
    case "tag":               return th ? "แท็กคุณในการ์ด" : "tagged you in a ticket";
    case "ticket_share":      return th ? "แชร์ตั๋วถึงคุณ" : "shared a ticket with you";
    case "party_invite":      return th ? "ชวนคุณเข้าร่วมปาร์ตี้ดูหนัง" : "invited you to a movie party";
    case "party_color_unlock":   return th ? "ทุกคนในปาร์ตี้ยืนยันแล้ว 🎉" : "Everyone in the party confirmed 🎉";
    case "party_color_reverted": return th ? "กลับสู่สถานะปกติ" : "Reverted to normal";
    case "memory_request":    return th ? "ขอดูความทรงจำส่วนตัวของคุณ" : "requested to read your memory";
    case "memory_approved":   return th ? "อ่านได้ภายใน 7 วัน" : "you can read it within 7 days";
    case "supporter_approved":return th
      ? "ขอบคุณที่สนับสนุน Ticker"
      : "Thanks for supporting Ticker";
    case "chain_continued":   return th ? "เพิ่มหนังใน Chain ของคุณ" : "added a movie to your Chain";
    case "chain_run_started": return th ? "เริ่มดู Chain ของคุณแล้ว" : "started running your Chain";
    default: return null; // caller falls back to DB prose (admin_message etc.)
  }
}

/** Push title+body for "user posted a new ticket / chain" */
export function newPostPushFor(opts: {
  lang: Lang;
  kind: "ticket" | "chain";
  senderName: string;
  movieTitle?: string | null;
  chainTitle?: string | null;
}): { title: string; body: string } {
  const th = opts.lang === "th";
  if (opts.kind === "ticket") {
    return {
      title: th ? `${opts.senderName} โพสต์ตั๋วใหม่` : `${opts.senderName} posted a new ticket`,
      body: opts.movieTitle
        ? (th ? `ดูเรื่อง "${opts.movieTitle}"` : `Watched "${opts.movieTitle}"`)
        : (th ? "เปิดดูในแอปได้เลย" : "Open the app to see it"),
    };
  }
  return {
    title: th ? `${opts.senderName} สร้าง Chain ใหม่` : `${opts.senderName} created a new Chain`,
    body: opts.chainTitle
      ? `"${opts.chainTitle}"`
      : (th ? "เปิดดูในแอปได้เลย" : "Open the app to see it"),
  };
}

/** Slot push for the timed recommendations job */
export function timedRecPushFor(opts: {
  lang: Lang;
  hour: 0 | 12;
  featuredMovie: string | null;
}): { title: string; body: string } {
  const th = opts.lang === "th";
  const titles: Record<0 | 12, string> = th
    ? { 0: "นอนไม่หลับ?", 12: "พักเที่ยง ดูอะไรดี?" }
    : { 0: "Can't sleep?", 12: "Lunch break — what to watch?" };
  const prefixes: Record<0 | 12, string> = {
    0:  "2 AM Deep Talk",
    12: "Brain Rot",
  };
  const body = opts.featuredMovie
    ? (th ? `${prefixes[opts.hour]} — ลอง "${opts.featuredMovie}"` : `${prefixes[opts.hour]} — try "${opts.featuredMovie}"`)
    : (th ? `${prefixes[opts.hour]} — มาเลือกหนังกัน` : `${prefixes[opts.hour]} — pick a movie`);
  return { title: `Ticker · ${titles[opts.hour]}`, body };
}
