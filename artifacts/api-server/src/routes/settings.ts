import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { siteSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /api/settings/promptpay-qr
 * Public — returns the stored PromptPay QR image path (objectPath).
 */
router.get("/promptpay-qr", async (_req, res) => {
  const rows = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.key, "promptpay_qr_url"))
    .limit(1);
  const value = rows[0]?.value ?? null;
  res.json({ objectPath: value });
});

export default router;
