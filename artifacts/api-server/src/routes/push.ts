import { Router, type IRouter } from "express";
import { nanoid } from "nanoid";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { getVapidPublicKey, sendPushToUser } from "../services/push.service";

const router: IRouter = Router();

router.get("/vapid-public-key", (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) { res.status(503).json({ error: "push_not_configured" }); return; }
  res.json({ publicKey: key });
});

router.post("/subscribe", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { endpoint, keys } = req.body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "invalid_subscription" });
    return;
  }
  const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;

  // Upsert by endpoint
  const [existing] = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint)).limit(1);
  if (existing) {
    await db.update(pushSubscriptionsTable).set({
      userId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      enabled: true,
      userAgent,
    }).where(eq(pushSubscriptionsTable.id, existing.id));
  } else {
    await db.insert(pushSubscriptionsTable).values({
      id: nanoid(),
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      enabled: true,
      userAgent,
    });
  }

  // Garbage-collect stale endpoints for this same browser/device.
  // When Chrome rotates the FCM endpoint silently, the previous row
  // belongs to the same userAgent for the same user but a different
  // endpoint — those will start returning 410 Gone forever. Drop them
  // now so push.service.ts doesn't waste calls (and so it doesn't
  // accidentally read the stale row instead of the fresh one).
  if (userAgent) {
    const stale = await db.select({ id: pushSubscriptionsTable.id })
      .from(pushSubscriptionsTable)
      .where(and(
        eq(pushSubscriptionsTable.userId, userId),
        eq(pushSubscriptionsTable.userAgent, userAgent),
      ));
    const staleIds = stale.map((r) => r.id);
    if (staleIds.length > 0) {
      for (const id of staleIds) {
        const [row] = await db.select({ endpoint: pushSubscriptionsTable.endpoint })
          .from(pushSubscriptionsTable)
          .where(eq(pushSubscriptionsTable.id, id)).limit(1);
        if (row && row.endpoint !== endpoint) {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, id));
        }
      }
    }
  }

  res.json({ ok: true });
});

// Called by the Service Worker (no user session) when the browser rotates
// the FCM endpoint behind a PushSubscription. We identify the row by the
// OLD endpoint and swap it over to the NEW one so future pushes land.
router.post("/refresh", async (req, res) => {
  const { oldEndpoint, endpoint, keys } = req.body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "invalid_subscription" });
    return;
  }
  if (oldEndpoint && oldEndpoint !== endpoint) {
    const [existing] = await db.select().from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.endpoint, oldEndpoint)).limit(1);
    if (existing) {
      await db.update(pushSubscriptionsTable).set({
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        enabled: true,
      }).where(eq(pushSubscriptionsTable.id, existing.id));
      res.json({ ok: true, rebound: true });
      return;
    }
  }
  // Fallback: refresh keys for the current endpoint if it already exists.
  const [existing] = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint)).limit(1);
  if (existing) {
    await db.update(pushSubscriptionsTable).set({
      p256dh: keys.p256dh,
      auth: keys.auth,
      enabled: true,
    }).where(eq(pushSubscriptionsTable.id, existing.id));
  }
  res.json({ ok: true });
});

router.post("/unsubscribe", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { endpoint } = req.body ?? {};
  if (endpoint) {
    await db.delete(pushSubscriptionsTable)
      .where(and(eq(pushSubscriptionsTable.endpoint, endpoint), eq(pushSubscriptionsTable.userId, userId)));
  } else {
    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId));
  }
  res.json({ ok: true });
});

router.get("/status", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.enabled, true)));
  res.json({ enabled: subs.length > 0, count: subs.length });
});

// Called right after a successful login. Removes any push subscription rows
// for the SAME endpoint that belong to a *different* user — i.e. an account
// previously logged in on this same browser/device. Without this, the prior
// user's push events would keep landing on this device until they explicitly
// unsubscribed in their own settings.
router.post("/release-others", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const { endpoint } = req.body ?? {};
  if (!endpoint || typeof endpoint !== "string") {
    res.status(400).json({ error: "invalid_endpoint" });
    return;
  }
  await db.delete(pushSubscriptionsTable).where(
    and(
      eq(pushSubscriptionsTable.endpoint, endpoint),
      ne(pushSubscriptionsTable.userId, userId),
    ),
  );
  res.json({ ok: true });
});

// Send a test notification to the current user — handy for verifying setup.
router.post("/test", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) { res.status(401).json({ error: "unauthorized" }); return; }
  await sendPushToUser(userId, {
    title: "Ticker — ทดสอบแจ้งเตือน",
    body: "ถ้าเห็นข้อความนี้แสดงว่าการแจ้งเตือนทำงานปกติ ✓",
    url: "/notifications",
    tag: "ticker-test",
  });
  res.json({ ok: true });
});

export default router;
