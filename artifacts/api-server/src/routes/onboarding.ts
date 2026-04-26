import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, count } from "drizzle-orm";
import { sanitize } from "../lib/sanitize";
import { buildUserProfile } from "./users";
import { sendDiscordWebhook } from "../lib/discord";

const router: IRouter = Router();

router.post("/", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const { username, displayName, birthdate, agreedToTerms } = req.body;

  if (!username || !birthdate || !agreedToTerms) {
    res.status(400).json({ error: "bad_request", message: "Missing required fields" });
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    res.status(400).json({ error: "invalid_username", message: "Username must be 3-30 alphanumeric characters or underscores" });
    return;
  }

  const birthDate = new Date(birthdate);
  const ageDiff = Date.now() - birthDate.getTime();
  const ageDate = new Date(ageDiff);
  const age = Math.abs(ageDate.getUTCFullYear() - 1970);
  if (age < 13) {
    res.status(400).json({ error: "age_restriction", message: "You must be at least 13 years old" });
    return;
  }

  try {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, username))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "username_taken", message: "Username is already taken" });
      return;
    }

    const cleanDisplayName = displayName ? sanitize(displayName.trim()) : null;

    const [updated] = await db
      .update(usersTable)
      .set({
        username,
        displayName: cleanDisplayName,
        birthdate,
        isOnboarded: true,
        agreedToTermsAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId))
      .returning();

    const profile = await buildUserProfile(updated, userId);

    // Discord notification (fire-and-forget)
    const [totalRow] = await db.select({ total: count() }).from(usersTable);
    sendDiscordWebhook("", [{
      title: "🆕 ผู้ใช้ใหม่ลงทะเบียนสำเร็จ!",
      color: 0x57f287,
      fields: [
        { name: "ชื่อ", value: cleanDisplayName || username, inline: true },
        { name: "Username", value: `@${username}`, inline: true },
        { name: "ผู้ใช้ทั้งหมด", value: `${totalRow?.total ?? "?"} บัญชี`, inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: "Ticker — ผู้ใช้ใหม่" },
    }]);

    res.json(profile);
  } catch (err) {
    req.log.error({ err }, "Onboarding failed");
    res.status(500).json({ error: "internal_error", message: "Internal server error" });
  }
});

export default router;
