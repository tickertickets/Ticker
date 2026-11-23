export type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
};

export async function sendDiscordWebhook(content: string, embeds?: DiscordEmbed[]) {
  const webhookUrl = process.env["DISCORD_WEBHOOK_URL"]?.trim();
  if (!webhookUrl) {
    console.warn("[Discord] DISCORD_WEBHOOK_URL is not set — skipping webhook");
    return;
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, embeds }),
    });
    if (!res.ok) {
      console.warn(`[Discord] Webhook returned ${res.status}:`, await res.text());
    }
  } catch (err) {
    console.warn("[Discord] Webhook fetch failed:", err);
  }
}

export async function notifyReport({
  type,
  reason,
  details,
  reporterUsername,
  targetUsername,
  targetId,
  extraLabel,
}: {
  type: "ticket" | "user" | "comment" | "contact";
  reason: string;
  details?: string | null;
  reporterUsername?: string;
  targetUsername?: string;
  targetId?: string;
  extraLabel?: string;
}) {
  const colors: Record<string, number> = {
    ticket: 0xFF4444,
    user: 0xFF8800,
    comment: 0xFFCC00,
    contact: 0x5865F2,
  };

  const typeLabel: Record<string, string> = {
    ticket: "🎬 รายงาน Ticket",
    user: "👤 รายงาน User",
    comment: "💬 รายงาน Comment",
    contact: "📬 ติดต่อ Ticker",
  };

  const fields: DiscordEmbed["fields"] = [];

  if (reporterUsername) fields.push({ name: "ผู้รายงาน", value: `@${reporterUsername}`, inline: true });
  if (targetUsername) fields.push({ name: "เป้าหมาย", value: `@${targetUsername}`, inline: true });
  if (targetId) fields.push({ name: "ID", value: targetId, inline: true });
  if (extraLabel) fields.push({ name: "รายละเอียด", value: extraLabel, inline: false });

  const reasonMap: Record<string, string> = {
    spam: "สแปม",
    inappropriate: "เนื้อหาไม่เหมาะสม",
    harassment: "การคุกคาม",
    impersonation: "แอบอ้างตัวตน",
    other: "อื่นๆ",
    bug: "พบบั๊ก",
    feature: "ขอฟีเจอร์",
    account: "ปัญหาบัญชี",
    content: "ปัญหาเนื้อหา",
    general: "สอบถามทั่วไป",
  };

  fields.push({ name: "เหตุผล", value: reasonMap[reason] ?? reason, inline: true });
  if (details) fields.push({ name: "รายละเอียดเพิ่มเติม", value: details.slice(0, 400), inline: false });

  await sendDiscordWebhook("", [
    {
      title: typeLabel[type] ?? "📩 แจ้งเตือน",
      color: colors[type] ?? 0x888888,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: "Ticker Report System" },
    },
  ]);
}

export async function notifyStats(stats: {
  totalUsers: number;
  totalTickets: number;
  newUsersToday: number;
  newTicketsToday: number;
  activeUsersToday: number;
}) {
  await sendDiscordWebhook("", [
    {
      title: "📊 Ticker Daily Stats",
      color: 0x57F287,
      fields: [
        { name: "👥 Users ทั้งหมด", value: stats.totalUsers.toLocaleString(), inline: true },
        { name: "🎬 Tickets ทั้งหมด", value: stats.totalTickets.toLocaleString(), inline: true },
        { name: "✨ Users ใหม่วันนี้", value: stats.newUsersToday.toLocaleString(), inline: true },
        { name: "🎟️ Tickets ใหม่วันนี้", value: stats.newTicketsToday.toLocaleString(), inline: true },
        { name: "🔥 Active Users วันนี้", value: stats.activeUsersToday.toLocaleString(), inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: "Ticker Stats • ส่งทุกวันเที่ยงคืน" },
    },
  ]);
}
