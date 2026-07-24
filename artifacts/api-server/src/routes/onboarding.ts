import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, and, ne, count } from "drizzle-orm";
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
    // Idempotency guard: if this account was already onboarded (e.g. this is
    // a client retry after a request that appeared to fail — a cold-start
    // timeout on Render is the common case — but actually committed on the
    // server), just return the existing profile instead of re-validating
    // and potentially erroring on a username that is "taken" by this same
    // user. Without this, a false-negative on the client leads the user to
    // resubmit and get a confusing failure even though they're fully signed up.
    const [currentUserRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (currentUserRow?.isOnboarded) {
      const profile = await buildUserProfile(currentUserRow, userId);
      res.json(profile);
      return;
    }

    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.username, username), ne(usersTable.id, userId)))
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
